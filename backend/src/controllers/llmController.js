const OpenAI = require('openai');
const { searchSimilarDocuments } = require('../utils/vectorDb');
const { Document, Subject, LearningProfile } = require('../models/pgModels');
const { normalizeLearningStyle, getLearningStylePromptBlock } = require('../utils/learningStyle');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const MAX_CONTEXT_CHARS = parseInt(process.env.RAG_MAX_CONTEXT_CHARS || '12000', 10);
const MAX_DOC_SNIPPET_CHARS = parseInt(process.env.RAG_MAX_DOC_SNIPPET_CHARS || '3500', 10);

const scoreDocumentByQuery = (doc, query) => {
  const haystack = `${doc.name || ''} ${doc.content || ''}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2);

  if (tokens.length === 0) return 0;

  return tokens.reduce((score, token) => {
    const occurrences = haystack.split(token).length - 1;
    return score + occurrences;
  }, 0);
};

const mergeHybridResults = ({ vectorResults, vectorDocs, keywordDocs, limit }) => {
  const byId = new Map();

  // Seed with vector results
  for (const result of vectorResults) {
    const id = result?.payload?.document_id;
    if (!id) continue;

    const doc = vectorDocs.find(d => d.id === id);
    if (!doc) continue;

    const vectorScore = Math.max(0, Number(result.score) || 0);
    byId.set(id, { doc, vectorScore, keywordScore: 0 });
  }

  // Merge keyword-ranked docs (strong boost for exact filename/topic matches)
  for (const item of keywordDocs) {
    const id = item.doc.id;
    const existing = byId.get(id);
    if (existing) {
      existing.keywordScore = Math.max(existing.keywordScore, item.score);
      continue;
    }
    byId.set(id, { doc: item.doc, vectorScore: 0, keywordScore: item.score });
  }

  return Array.from(byId.values())
    .map(entry => ({
      ...entry,
      combinedScore: entry.vectorScore * 2 + entry.keywordScore,
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
    .map(entry => entry.doc);
};

const getQueryTokens = (query) => query
  .toLowerCase()
  .split(/\s+/)
  .map(t => t.trim())
  .filter(t => t.length > 2);

const buildQueryAwareSnippet = (content, query, maxChars) => {
  if (!content) return '';
  if (content.length <= maxChars) return content;

  const tokens = getQueryTokens(query);
  const chunkSize = Math.min(1800, maxChars);
  const stride = 1200;
  const chunks = [];

  for (let start = 0; start < content.length; start += stride) {
    const end = Math.min(content.length, start + chunkSize);
    const chunk = content.slice(start, end);
    const lowerChunk = chunk.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (lowerChunk.split(token).length - 1), 0);
    chunks.push({ start, chunk, score });
    if (end === content.length) break;
  }

  const ranked = chunks.sort((a, b) => b.score - a.score);
  const bestChunks = ranked.slice(0, 2);

  // Fallback: if nothing matches tokens, keep the beginning for definitions/context.
  if (bestChunks.length === 0 || bestChunks[0].score === 0) {
    return content.slice(0, maxChars);
  }

  let combined = '';
  for (const item of bestChunks) {
    const separator = combined ? '\n\n...\n\n' : '';
    const next = `${combined}${separator}${item.chunk}`;
    if (next.length > maxChars) break;
    combined = next;
  }

  return combined || bestChunks[0].chunk.slice(0, maxChars);
};

const buildBoundedContext = (documents, query, maxContextChars, maxDocSnippetChars) => {
  const parts = [];
  let used = 0;

  for (const doc of documents) {
    const snippet = buildQueryAwareSnippet(doc.content || '', query, maxDocSnippetChars);
    if (!snippet) continue;

    const part = `[Source: ${doc.name}]\n${snippet}`;
    const extra = parts.length > 0 ? '\n\n---\n\n' : '';
    if (used + extra.length + part.length > maxContextChars) {
      const remaining = maxContextChars - used - extra.length;
      if (remaining <= 0) break;
      parts.push(`${extra}[Source: ${doc.name}]\n${snippet.slice(0, remaining)}`);
      break;
    }

    parts.push(`${extra}${part}`);
    used += extra.length + part.length;
  }

  return parts.join('');
};

// @desc    Answer a question using RAG
// @route   POST /api/llm/query
// @access  Public
exports.queryLlm = async (req, res) => {
  try {
    const { query, subjectId, limit = 3 } = req.body;
    const parsedLimit = Number.isFinite(parseInt(limit, 10)) ? parseInt(limit, 10) : 3;
    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a query'
      });
    }

    // Determine accessible subjects: own + subscribed
    const accessibleSubjects = await Subject.findAll('created_at', 'DESC', req.session.userId, 'all');
    const accessibleSubjectIds = new Set(accessibleSubjects.map(s => String(s.id)));

    // Enforce access if a specific subject filter is provided
    if (subjectId && !accessibleSubjectIds.has(String(subjectId))) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    // 1. Retrieve relevant documents from the vector database
    const searchResults = await searchSimilarDocuments(
      query,
      subjectId || null,
      parsedLimit
    );

    // 2. Build hybrid retrieval set (vector + keyword ranking).
    const documentIds = (searchResults || []).map(result => result.payload.document_id);
    const vectorDocs = [];
    for (const id of documentIds) {
      const doc = await Document.findById(id);
      if (!doc) continue;
      if (!accessibleSubjectIds.has(String(doc.subject_id))) continue;
      vectorDocs.push(doc);
    }

    // Candidate docs for keyword retrieval: all docs from accessible subjects
    const candidateDocs = [];
    for (const s of accessibleSubjects) {
      const docs = await Document.find({ subject: s.id });
      for (const doc of docs) {
        candidateDocs.push(doc);
      }
    }

    const filteredCandidateDocs = subjectId
      ? candidateDocs.filter(doc => String(doc.subject_id) === String(subjectId))
      : candidateDocs;

    const keywordDocs = filteredCandidateDocs
      .map(doc => ({ doc, score: scoreDocumentByQuery(doc, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, parsedLimit * 2);

    const documents = mergeHybridResults({
      vectorResults: searchResults || [],
      vectorDocs,
      keywordDocs,
      limit: parsedLimit,
    });

    if (documents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No relevant documents found to answer the question.',
        answer: 'I could not find any relevant information to answer your question.',
        applied_learning_style: activeLearningStyle,
      });
    }
    
    const context = buildBoundedContext(
      documents,
      query,
      MAX_CONTEXT_CHARS,
      MAX_DOC_SNIPPET_CHARS
    );

    if (!context) {
      return res.status(200).json({
        success: true,
        message: 'No relevant documents found to answer the question.',
        answer: 'I could not find any relevant information to answer your question.',
        applied_learning_style: activeLearningStyle,
      });
    }

    // 3. Construct the prompt for the LLM
    const prompt = `You are a precise study assistant. Answer ONLY from the provided context.\n\nRules:\n- Respond in the same language as the question.\n- If the context contains an explicit definition, provide that definition succinctly.\n- Prefer a direct answer first, then optionally 1 short clarifying sentence.\n- Only say you don't know if the information is truly missing from context.\n\n${getLearningStylePromptBlock(activeLearningStyle)}\n\nContext:\n${context}\n\nQuestion: ${query}\n\nAnswer:`;

    // 4. Call the OpenAI API to get the answer
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });

    const answer = completion.choices[0].message.content;

    res.status(200).json({
      success: true,
      answer: answer,
      applied_learning_style: activeLearningStyle,
      retrieval_mode: 'hybrid',
      sourceDocuments: documents.map(doc => ({ id: doc.id, name: doc.name }))
    });

  } catch (error) {
    console.error('Error in RAG query:', error);

    if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
      return res.status(200).json({
        success: true,
        message: 'Temporary model limit reached.',
        answer: 'Ich konnte die Anfrage gerade nicht verarbeiten, weil das Modell-Limit erreicht wurde. Bitte versuche es in 10-20 Sekunden erneut oder nutze einen engeren Fachfilter.',
        sourceDocuments: [],
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};
