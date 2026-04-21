const OpenAI = require('openai');
const { Subject } = require('../models/pgModels');
const { getSubjectClassificationInsight } = require('./assessmentController');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

/**
 * Build a safe fallback email template for professor requests.
 *
 * @param {Object} subject - Subject metadata used for greeting and context.
 * @param {string} openQuestion - The user-provided question to embed into the email.
 * @returns {Object} Template fragments plus the combined full text.
 */
const buildFallbackProfessorTemplate = (subject, openQuestion) => {
  const greeting = subject.lecturer_name
    ? `Sehr geehrte/r ${subject.lecturer_name},`
    : 'Sehr geehrte Damen und Herren,';

  const intro = `ich bereite mich aktuell auf die Prüfung im Fach "${subject.name}" vor und möchte mein Lernen gezielt ausrichten.`;
  const openQuestionSection = `Meine Frage: ${openQuestion}`;
  const contextSection = subject.exam_notes
    ? `Als Kontext habe ich mir bisher notiert: ${subject.exam_notes}`
    : 'Als Kontext: Ich möchte die Prüfungsschwerpunkte besser verstehen, um meinen Lernplan sinnvoll zu priorisieren.';
  const closing = 'Vielen Dank für Ihre Zeit und Rückmeldung.\n\nMit freundlichen Grüßen';

  const fullText = [
    greeting,
    '',
    intro,
    '',
    openQuestionSection,
    '',
    contextSection,
    '',
    closing,
  ].join('\n');

  return {
    greeting,
    intro,
    open_question_section: openQuestionSection,
    context_section: contextSection,
    closing,
    full_text: fullText,
  };
};

/**
 * Parse a JSON object from raw model output, even if extra text is present.
 *
 * @param {string} content - Raw text returned by the LLM.
 * @returns {Object|null} Parsed JSON object or null when parsing fails.
 */
const tryParseJsonObject = (content) => {
  if (!content || typeof content !== 'string') return null;

  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

/**
 * Normalize an LLM-generated professor request template.
 *
 * @param {Object} parsed - Parsed JSON response from the model.
 * @param {Object} fallbackTemplate - Safe fallback template values.
 * @returns {Object} Sanitized template with the expected structure.
 */
const normalizeTemplate = (parsed, fallbackTemplate) => {
  if (!parsed || typeof parsed !== 'object') {
    return fallbackTemplate;
  }

  const greeting = typeof parsed.greeting === 'string' && parsed.greeting.trim()
    ? parsed.greeting.trim()
    : fallbackTemplate.greeting;
  const intro = typeof parsed.intro === 'string' && parsed.intro.trim()
    ? parsed.intro.trim()
    : fallbackTemplate.intro;
  const openQuestionSection = typeof parsed.open_question_section === 'string' && parsed.open_question_section.trim()
    ? parsed.open_question_section.trim()
    : fallbackTemplate.open_question_section;
  const contextSection = typeof parsed.context_section === 'string' && parsed.context_section.trim()
    ? parsed.context_section.trim()
    : fallbackTemplate.context_section;
  const closing = typeof parsed.closing === 'string' && parsed.closing.trim()
    ? parsed.closing.trim()
    : fallbackTemplate.closing;

  const fullText = [
    greeting,
    '',
    intro,
    '',
    openQuestionSection,
    '',
    contextSection,
    '',
    closing,
  ].join('\n');

  return {
    greeting,
    intro,
    open_question_section: openQuestionSection,
    context_section: contextSection,
    closing,
    full_text: fullText,
  };
};

/**
 * Get subjects visible to the current user.
 *
 * Supports filter modes `own`, `subscribed`, and `all`.
 *
 * @param {import('express').Request} req - Express request with optional `filter` query.
 * @param {import('express').Response} res - Express response.
 */
exports.getSubjects = async (req, res) => {
  try {
    const allowedFilters = ['own', 'subscribed', 'all'];
    const requestedFilter = typeof req.query.filter === 'string' ? req.query.filter : 'own';
    const filter = allowedFilters.includes(requestedFilter) ? requestedFilter : 'own';

    const subjects = await Subject.findAll('created_at', 'DESC', req.session.userId, filter);
    res.status(200).json({
      success: true,
      count: subjects.length,
      filter,
      data: subjects
    });
  } catch (error) {
    console.error('Error getting subjects:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Get one subject including ownership context and document metadata.
 *
 * Allows access for the owner or subscribed users. Document content is removed
 * from the response to keep payload size small in the detail view.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.getSubject = async (req, res) => {
  try {
    console.log(`Getting subject with ID: ${req.params.id}`);
    
    // Validate the ID parameter
    if (!req.params.id || req.params.id === 'undefined') {
      console.log('Invalid subject ID: undefined or missing');
      return res.status(400).json({
        success: false,
        error: 'Invalid subject ID',
        message: 'Subject ID is required and must be a valid integer'
      });
    }
    
    // Find the subject
    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      console.log(`Subject not found with ID: ${req.params.id}`);
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const userId = req.session.userId;
    const isOwner = String(subject.user_id) === String(userId);
    
    // Check access: owner or subscriber
    let isSubscriber = false;
    if (!isOwner) {
      const subscription = await Subject.checkSubscription(req.params.id, userId);
      isSubscriber = !!subscription;
      
      if (!isSubscriber) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const ownership = isOwner ? 'owner' : 'subscriber';
    console.log(`Subject found: ${subject.name}, attempting to get documents`);
    
    try {
      // Get documents for this subject
      const documents = await Subject.getDocuments(subject.id);
      
      // Create a response object with documents but without content
      const documentsWithoutContent = documents.map(doc => {
        const { content, ...docWithoutContent } = doc;
        return docWithoutContent;
      });
      
      // Add documents to subject response
      const responseData = {
        ...subject,
        ownership,
        documents: documentsWithoutContent
      };
      
      console.log(`Successfully retrieved ${documentsWithoutContent.length} documents for subject ${subject.name}`);
      
      res.status(200).json({
        success: true,
        data: responseData
      });
    } catch (documentsError) {
      console.error(`Error getting documents for subject ${subject.name}:`, documentsError);
      console.error('Error details:', {
        name: documentsError.name,
        message: documentsError.message,
        stack: documentsError.stack
      });
      
      // Return the subject without documents as a fallback
      console.log('Returning subject without documents as fallback');
      const responseData = {
        ...subject,
        ownership
      };
      res.status(200).json({
        success: true,
        data: responseData,
        warning: 'Documents could not be loaded'
      });
    }
  } catch (error) {
    console.error(`Error getting subject with ID ${req.params.id}:`, error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Create a new subject for the current user.
 *
 * Validates required fields and prevents duplicates by subject name.
 *
 * @param {import('express').Request} req - Express request with subject payload in `body`.
 * @param {import('express').Response} res - Express response.
 */
exports.createSubject = async (req, res) => {
  try {
    const { name, description, lecturer_name, difficulty, exam_notes, is_public } = req.body;

    // Validate input
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name and description'
      });
    }

    // Check if subject with same name already exists
    const existingSubject = await Subject.findByName(name);
    if (existingSubject) {
      return res.status(400).json({
        success: false,
        error: 'Subject with this name already exists'
      });
    }

    const subject = await Subject.create({ 
      name, 
      description, 
      lecturer_name, 
      difficulty, 
      exam_notes, 
      is_public: is_public === true,
      user_id: req.session.userId 
    });

    res.status(201).json({
      success: true,
      data: subject
    });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Update an existing subject owned by the current user.
 *
 * Applies partial updates while preserving existing values for omitted fields.
 *
 * @param {import('express').Request} req - Express request with `id` route param and update payload.
 * @param {import('express').Response} res - Express response.
 */
exports.updateSubject = async (req, res) => {
  try {
    const { name, description, lecturer_name, difficulty, exam_notes, is_public } = req.body;

    // Validate input
    if (!name && !description && is_public === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, description, or is_public to update'
      });
    }

    // Check if subject exists
    let subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    if (String(subject.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if updating to an existing name
    if (name && name !== subject.name) {
      const existingSubject = await Subject.findByName(name);
      
      if (existingSubject && existingSubject.id !== subject.id) {
        return res.status(400).json({
          success: false,
          error: 'Subject with this name already exists'
        });
      }
    }

    // Update the subject
    subject = await Subject.update(
      req.params.id,
      {
        name: name || subject.name,
        description: description || subject.description,
        lecturer_name: lecturer_name !== undefined ? lecturer_name : subject.lecturer_name,
        difficulty: difficulty !== undefined ? difficulty : subject.difficulty,
        exam_notes: exam_notes !== undefined ? exam_notes : subject.exam_notes,
        is_public: is_public !== undefined ? is_public : subject.is_public,
      }
    );

    res.status(200).json({
      success: true,
      data: subject
    });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Delete one subject owned by the current user.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    if (String(subject.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await Subject.delete(req.params.id);

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Classify a subject into learning profile buckets (`1day` or `deep`).
 *
 * Returns factor explanations used by the frontend for transparent guidance.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.classifySubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const userId = req.session.userId;
    const isOwner = String(subject.user_id) === String(userId);

    if (!isOwner) {
      const subscription = await Subject.checkSubscription(req.params.id, userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const insight = await getSubjectClassificationInsight(req.params.id, subject);

    return res.status(200).json({
      success: true,
      data: {
        subject_id: req.params.id,
        classification: insight?.classification || 'deep',
        factors: insight?.factors || [],
      },
    });
  } catch (error) {
    console.error('Error classifying subject:', error);
    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
};

/**
 * Generate a structured professor-request email template for a subject.
 *
 * Uses a deterministic fallback template when no model key is configured.
 *
 * @param {import('express').Request} req - Express request with `id` route param and `openQuestion` in `body`.
 * @param {import('express').Response} res - Express response.
 */
exports.generateProfessorRequestTemplate = async (req, res) => {
  try {
    const { openQuestion } = req.body || {};
    const trimmedQuestion = typeof openQuestion === 'string' ? openQuestion.trim() : '';

    if (!trimmedQuestion) {
      return res.status(400).json({
        success: false,
        error: 'Bitte gib eine konkrete Frage an (openQuestion).',
      });
    }

    if (trimmedQuestion.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Die Frage ist zu lang. Bitte maximal 1000 Zeichen verwenden.',
      });
    }

    const subject = await Subject.findById(req.params.id);

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }

    const userId = req.session.userId;
    const isOwner = String(subject.user_id) === String(userId);

    if (!isOwner) {
      const subscription = await Subject.checkSubscription(req.params.id, userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const fallbackTemplate = buildFallbackProfessorTemplate(subject, trimmedQuestion);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        success: true,
        data: {
          subject_id: String(subject.id),
          ...fallbackTemplate,
          metadata: {
            model: 'fallback-rule-template',
            generated_at: new Date().toISOString(),
            used_fallback: true,
          },
        },
      });
    }

    const prompt = [
      'Du bist ein Assistenzsystem für akademische Kommunikation.',
      'Erstelle eine kurze, höfliche E-Mail-Vorlage auf Deutsch für eine Anfrage an einen Dozenten.',
      'Wichtig: Verwende nur die gelieferten Fakten und erfinde keine Details.',
      'Gib ausschliesslich ein valides JSON-Objekt ohne Markdown zurueck.',
      'Das JSON MUSS genau diese Felder enthalten: greeting, intro, open_question_section, context_section, closing.',
      '',
      `Fach: ${subject.name}`,
      `Dozent: ${subject.lecturer_name || 'unbekannt'}`,
      `Prüfungsnotizen: ${subject.exam_notes || 'keine'}`,
      `Offene Frage des Nutzers: ${trimmedQuestion}`,
      '',
      'Anforderungen:',
      '- greeting: Anrede, falls Dozent unbekannt dann generisch.',
      '- intro: 1 bis 2 Sätze zur Prüfungsvorbereitung im genannten Fach.',
      '- open_question_section: Der Nutzer-Input klar und korrekt eingebettet.',
      '- context_section: Falls Prüfungsnotizen vorhanden, knapp darauf Bezug nehmen.',
      '- closing: Höflicher Abschluss mit Grußformel.',
    ].join('\n');

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 450,
    });

    const raw = completion?.choices?.[0]?.message?.content || '';
    const parsed = tryParseJsonObject(raw);
    const normalized = normalizeTemplate(parsed, fallbackTemplate);

    return res.status(200).json({
      success: true,
      data: {
        subject_id: String(subject.id),
        ...normalized,
        metadata: {
          model: CHAT_MODEL,
          generated_at: new Date().toISOString(),
          used_fallback: false,
        },
      },
    });
  } catch (error) {
    console.error('Error generating professor request template:', error);

    if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
      return res.status(429).json({
        success: false,
        error: 'Model limit reached. Bitte in wenigen Sekunden erneut versuchen.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// SUBJECT SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get all globally visible public subjects with search, pagination, and sorting.
 *
 * @param {import('express').Request} req - Express request with list options in query params.
 * @param {import('express').Response} res - Express response.
 */
exports.getPublicSubjects = async (req, res) => {
  try {
    const { search, limit = 20, offset = 0, sort = 'name', order = 'ASC' } = req.query;
    
    // Validate limit and offset
    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    
    // Validate sort field
    const allowedSortFields = ['name', 'created_at', 'subscriber_count', 'difficulty'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'name';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const result = await Subject.findPublic({
      search,
      limit: parsedLimit,
      offset: parsedOffset,
      sort: sortField,
      order: sortOrder,
    });

    res.status(200).json({
      success: true,
      count: result.subjects.length,
      total: result.total,
      data: result.subjects,
    });
  } catch (error) {
    console.error('Error getting public subjects:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};

/**
 * Subscribe the current user to a subject.
 *
 * Rejects self-subscription and duplicate subscriptions.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.subscribeToSubject = async (req, res) => {
  try {
    const { id: subjectId } = req.params;
    const userId = req.session.userId;

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        error: 'Subject ID is required',
      });
    }

    // Check if subject exists
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found',
      });
    }

    // Prevent self-subscribe
    if (String(subject.user_id) === String(userId)) {
      return res.status(400).json({
        success: false,
        error: 'You cannot subscribe to your own subject',
      });
    }

    // Check if already subscribed
    const existingSubscription = await Subject.checkSubscription(subjectId, userId);
    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: 'You have already subscribed to this subject',
      });
    }

    // Create subscription
    const subscription = await Subject.subscribe(subjectId, userId);

    res.status(201).json({
      success: true,
      data: {
        subscription_id: subscription.id,
        subscribed_at: subscription.subscribed_at,
      },
    });
  } catch (error) {
    console.error('Error subscribing to subject:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};

/**
 * Unsubscribe the current user from a subject.
 *
 * Only the subscription link is removed; subject data and history stay intact.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.unsubscribeFromSubject = async (req, res) => {
  try {
    const { id: subjectId } = req.params;
    const userId = req.session.userId;

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        error: 'Subject ID is required',
      });
    }

    // Check if subscription exists
    const subscription = await Subject.checkSubscription(subjectId, userId);
    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found',
      });
    }

    // Remove only the subscription link so subject data and history remain intact.
    await Subject.unsubscribe(subjectId, userId);

    res.status(200).json({
      success: true,
      message: 'Unsubscribed successfully',
    });
  } catch (error) {
    console.error('Error unsubscribing from subject:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};

/**
 * Get all subjects the current user is subscribed to.
 *
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 */
exports.getMySubscriptions = async (req, res) => {
  try {
    const userId = req.session.userId;

    const subjects = await Subject.getMySubscriptions(userId);

    res.status(200).json({
      success: true,
      count: subjects.length,
      data: subjects,
    });
  } catch (error) {
    console.error('Error getting my subscriptions:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};

/**
 * Get all subscribers for one subject.
 *
 * Access is restricted to the subject owner.
 *
 * @param {import('express').Request} req - Express request with `id` route param.
 * @param {import('express').Response} res - Express response.
 */
exports.getSubjectSubscribers = async (req, res) => {
  try {
    const { id: subjectId } = req.params;
    const userId = req.session.userId;

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        error: 'Subject ID is required',
      });
    }

    // Check if subject exists
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found',
      });
    }

    // Only owner can see subscribers
    if (String(subject.user_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        error: 'Only the subject owner can view subscribers',
      });
    }

    // Get subscribers
    const subscribers = await Subject.getSubscribers(subjectId);

    res.status(200).json({
      success: true,
      count: subscribers.length,
      data: subscribers,
    });
  } catch (error) {
    console.error('Error getting subject subscribers:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message,
    });
  }
};