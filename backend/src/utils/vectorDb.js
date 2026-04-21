const { Pool } = require('pg');
const pgvector = require('pgvector/pg');
require('dotenv').config();
const OpenAI = require("openai");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// Initialize PostgreSQL client
const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'vectordb',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
});

// Embedding model configuration
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

// Vector dimension for our embeddings
const VECTOR_SIZE = parseInt(process.env.OPENAI_EMBEDDING_DIM || '1536', 10);

// Conservative cap to avoid embedding model context-limit errors on huge docs.
const MAX_EMBEDDING_CHARS = parseInt(process.env.OPENAI_MAX_EMBEDDING_CHARS || '24000', 10);

// Chunk size used when a document is too large for a single embedding request.
const EMBEDDING_CHUNK_CHARS = parseInt(process.env.OPENAI_EMBEDDING_CHUNK_CHARS || '6000', 10);
const EMBEDDING_CHUNK_OVERLAP_CHARS = parseInt(process.env.OPENAI_EMBEDDING_CHUNK_OVERLAP_CHARS || '400', 10);

// Table name for document vectors
const TABLE_NAME = 'document_vectors';

/**
 * Initialize the vector database
 * Creates the table if it doesn't exist and enables the vector extension
 */
const initVectorDb = async () => {
  return new Promise((resolve, reject) => {
    // Set a timeout to prevent hanging indefinitely
    const connectionTimeout = setTimeout(() => {
      reject(new Error('PostgreSQL connection timeout after 10 seconds'));
    }, 10000);

    (async () => {
      const client = await pool.connect();
      try {
        // Enable vector extension FIRST before registering the type
        console.log('Enabling pgvector extension...');
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await pgvector.registerType(client);
        
        // Check if table exists
        console.log(`Checking if table ${TABLE_NAME} exists...`);
        const tableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          );
        `, [TABLE_NAME]);
        
        const tableExists = tableCheck.rows[0].exists;

        if (!tableExists) {
          // Create table
          console.log(`Creating table ${TABLE_NAME}...`);
          await client.query(`
            CREATE TABLE ${TABLE_NAME} (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              subject_id TEXT NOT NULL,
              text_snippet TEXT,
              embedding VECTOR(${VECTOR_SIZE})
            );
          `);
          
          // Create index for faster similarity search
          console.log('Creating index for faster similarity search...');
          await client.query(`
            CREATE INDEX ON ${TABLE_NAME} USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
          `);
          
          console.log(`Table ${TABLE_NAME} created successfully`);
        } else {
          console.log(`Table ${TABLE_NAME} already exists`);
        }

        // Keep referential data clean before adding FK constraints.
        // This avoids startup failures on older instances with stale/orphaned rows.
        await client.query(`
          DELETE FROM ${TABLE_NAME} dv
          WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = dv.document_id)
             OR NOT EXISTS (SELECT 1 FROM subjects s WHERE s.id = dv.subject_id);
        `);

        await client.query(`
          UPDATE documents d
          SET vector_id = NULL
          WHERE d.vector_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${TABLE_NAME} dv WHERE dv.id = d.vector_id);
        `);

        // Add foreign keys idempotently where they are semantically safe.
        // - documents.vector_id uses ON DELETE SET NULL to preserve current delete flow
        //   (vector rows may be deleted before document rows).
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'fk_document_vectors_document_id'
            ) THEN
              ALTER TABLE ${TABLE_NAME}
              ADD CONSTRAINT fk_document_vectors_document_id
              FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'fk_document_vectors_subject_id'
            ) THEN
              ALTER TABLE ${TABLE_NAME}
              ADD CONSTRAINT fk_document_vectors_subject_id
              FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;
            END IF;
          END $$;
        `);

        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_vector_id'
            ) THEN
              ALTER TABLE documents
              ADD CONSTRAINT fk_documents_vector_id
              FOREIGN KEY (vector_id) REFERENCES ${TABLE_NAME}(id) ON DELETE SET NULL;
            END IF;
          END $$;
        `);
        
        clearTimeout(connectionTimeout);
        resolve();
      } catch (error) {
        console.error('Error initializing vector database:', error.message);
        reject(error);
      } finally {
        client.release();
      }
    })();
  });
};

/**
 * Convert text to vector embedding using OpenAI
 * @param {string} text - Text to convert to vector
 * @returns {Promise<number[]>} - Vector embedding
 */
const textToVector = async (text) => {
  try {
    // Replace newlines with spaces, as per OpenAI's recommendation
    const sanitizedText = text.replace(/\s+/g, ' ').trim();
    const boundedText = sanitizedText.length > MAX_EMBEDDING_CHARS
      ? sanitizedText.slice(0, MAX_EMBEDDING_CHARS)
      : sanitizedText;

    // Call OpenAI's embedding API
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: boundedText,
    });

    // Extract the embedding from the response
    const embedding = response.data[0].embedding;
    
    return embedding;
  } catch (error) {
    console.error('Error converting text to vector:', error.message);
    if (error.response) {
      console.error(error.response.data);
    }
    throw error;
  }
};

const splitTextIntoChunks = (text, chunkSize, overlap) => {
  if (!text || typeof text !== 'string') return [];
  if (chunkSize <= 0) return [text];

  const chunks = [];
  const step = Math.max(1, chunkSize - Math.max(0, overlap));

  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + chunkSize).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (start + chunkSize >= text.length) {
      break;
    }
  }

  return chunks;
};

const averageEmbeddings = (embeddings) => {
  if (!embeddings || embeddings.length === 0) {
    throw new Error('Cannot average empty embedding list');
  }

  const dimension = embeddings[0].length;
  const accumulator = new Array(dimension).fill(0);

  for (const embedding of embeddings) {
    if (!Array.isArray(embedding) || embedding.length !== dimension) {
      throw new Error('Inconsistent embedding dimensions while averaging');
    }
    for (let i = 0; i < dimension; i++) {
      accumulator[i] += embedding[i];
    }
  }

  return accumulator.map((value) => value / embeddings.length);
};

const textToDocumentVector = async (text) => {
  const sanitizedText = String(text || '').replace(/\s+/g, ' ').trim();
  const boundedText = sanitizedText.length > MAX_EMBEDDING_CHARS
    ? sanitizedText.slice(0, MAX_EMBEDDING_CHARS)
    : sanitizedText;

  if (boundedText.length === 0) {
    throw new Error('Text content is empty after sanitization');
  }

  if (boundedText.length <= EMBEDDING_CHUNK_CHARS) {
    return textToVector(boundedText);
  }

  const chunks = splitTextIntoChunks(
    boundedText,
    EMBEDDING_CHUNK_CHARS,
    EMBEDDING_CHUNK_OVERLAP_CHARS
  );

  if (chunks.length === 0) {
    throw new Error('Failed to build embedding chunks from document text');
  }

  console.log(`Embedding large document in ${chunks.length} chunks...`);
  const chunkEmbeddings = [];
  for (const chunk of chunks) {
    const embedding = await textToVector(chunk);
    chunkEmbeddings.push(embedding);
  }

  return averageEmbeddings(chunkEmbeddings);
};

/**
 * Store document in vector database
 * @param {string} documentId - MongoDB document ID
 * @param {string} text - Document text content
 * @param {string} subjectId - Subject ID
 * @returns {Promise<string>} - Document ID in PostgreSQL
 */
const storeDocumentVector = async (documentId, text, subjectId) => {
  console.log(`Starting vector storage for document ID: ${documentId}, subject ID: ${subjectId}`);
  
  // Validate inputs
  if (!documentId) {
    const errorMsg = 'Document ID is required for vector storage';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  if (!text) {
    const errorMsg = 'Text content is required for vector storage';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  if (!subjectId) {
    const errorMsg = 'Subject ID is required for vector storage';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const client = await pool.connect();
  await pgvector.registerType(client);
  try {
    // Check if text contains extraction error messages
    if (text.includes('[CONTENT EXTRACTION FAILED') || 
        text.includes('[TXT CONTENT EXTRACTION FAILED') || 
        text.includes('[DOCX CONTENT EXTRACTION FAILED') || 
        text.includes('[PDF CONTENT EXTRACTION FAILED')) {
      console.warn(`Vector being created from potentially failed content extraction: ${text.substring(0, 100)}...`);
    }
    
    console.log(`Converting text to vector (text length: ${text.length} characters)`);
    // Convert text to vector
    const vector = await textToDocumentVector(text);
    console.log(`Vector created successfully (dimension: ${vector.length})`);
    
    // Prepare text snippet
    const textSnippet = text.substring(0, 200);
    console.log(`Text snippet for vector payload: \"${textSnippet.substring(0, 50)}...\"`);
    
    console.log(`Storing vector in PostgreSQL table: ${TABLE_NAME}`);
    // Store vector in PostgreSQL
    const result = await client.query(
      `INSERT INTO ${TABLE_NAME} (id, document_id, subject_id, text_snippet, embedding)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET document_id = $2, subject_id = $3, text_snippet = $4, embedding = $5
       RETURNING id`,
      [documentId, documentId, subjectId, textSnippet, pgvector.toSql(vector)]
    );
    
    console.log(`Vector stored successfully for document ID: ${documentId}`);
    console.log(`PostgreSQL response:`, result.rows[0]);
    
    return documentId;
  } catch (error) {
    console.error('Error storing document vector:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Add more context to the error
    const enhancedError = new Error(`Failed to store vector for document ${documentId}: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.documentId = documentId;
    enhancedError.subjectId = subjectId;
    
    throw enhancedError;
  } finally {
    client.release();
  }
};

/**
 * Search for similar documents
 * @param {string} query - Search query
 * @param {string} subjectId - Optional subject ID to filter by
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Array of similar documents
 */
const searchSimilarDocuments = async (query, subjectId = null, limit = 5) => {
  const client = await pool.connect();
  await pgvector.registerType(client);
  try {
    // Convert query to vector
    const queryVector = await textToVector(query);
    
    // Prepare SQL query with or without subject filter
    let sql;
    let params;
    
    if (subjectId) {
      sql = `
        SELECT id, document_id, subject_id, text_snippet,
               (embedding <-> $1) AS distance
        FROM ${TABLE_NAME}
        WHERE subject_id = $2
        ORDER BY distance
        LIMIT $3
      `;
      params = [pgvector.toSql(queryVector), subjectId, limit];
    } else {
      sql = `
        SELECT id, document_id, subject_id, text_snippet,
               (embedding <-> $1) AS distance
        FROM ${TABLE_NAME}
        ORDER BY distance
        LIMIT $2
      `;
      params = [pgvector.toSql(queryVector), limit];
    }
    
    // Search for similar vectors
    const result = await client.query(sql, params);
    
    // Format results to match the previous structure
    const searchResults = result.rows.map(row => ({
      id: row.id,
      score: 1 - row.distance, // Convert distance to similarity score
      payload: {
        document_id: row.document_id,
        subject_id: row.subject_id,
        text_snippet: row.text_snippet
      }
    }));
    
    return searchResults;
  } catch (error) {
    console.error('Error searching similar documents:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Delete document vector from database
 * @param {string} documentId - Document ID to delete
 */
const deleteDocumentVector = async (documentId) => {
  const client = await pool.connect();
  await pgvector.registerType(client);
  try {
    await client.query(`DELETE FROM ${TABLE_NAME} WHERE id = $1`, [documentId]);
    console.log(`Vector for document ID ${documentId} deleted successfully`);
  } catch (error) {
    console.error('Error deleting document vector:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * [MIGRATION] Regenerate embeddings for all existing documents
 */
const regenerateEmbeddings = async () => {
  console.log('[MIGRATION] Starting embedding regeneration process...');
  const client = await pool.connect();
  try {
    const documentsResult = await client.query('SELECT id, content, subject_id FROM documents');
    const documents = documentsResult.rows;

    const summary = {
      totalDocuments: documents.length,
      embedded: 0,
      skippedEmpty: 0,
      failed: 0,
      failures: [],
    };

    if (documents.length === 0) {
      console.log('[MIGRATION] No documents found to re-embed.');
      return summary;
    }

    console.log(`[MIGRATION] Found ${documents.length} documents. Re-generating embeddings...`);
    for (const doc of documents) {
      if (!doc.content || doc.content.trim() === '') {
        console.warn(`[MIGRATION] Skipping document ID ${doc.id} due to empty content.`);
        summary.skippedEmpty += 1;
        continue;
      }

      try {
        await storeDocumentVector(doc.id.toString(), doc.content, doc.subject_id.toString());
        summary.embedded += 1;
      } catch (error) {
        summary.failed += 1;
        summary.failures.push({
          documentId: doc.id.toString(),
          subjectId: doc.subject_id.toString(),
          message: error?.message || 'Unknown embedding error',
        });
        console.error(`[MIGRATION] Failed to embed document ID ${doc.id}: ${error?.message || error}`);
      }
    }
    console.log(`[MIGRATION] Re-embedding finished. embedded=${summary.embedded}, skippedEmpty=${summary.skippedEmpty}, failed=${summary.failed}`);
    if (summary.failed > 0) {
      console.warn('[MIGRATION] Some documents could not be embedded. See failures for details.');
    }

    return summary;

  } catch (error) {
    console.error('[MIGRATION] An error occurred during embedding regeneration:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  initVectorDb,
  textToVector,
  storeDocumentVector,
  searchSimilarDocuments,
  deleteDocumentVector,
  regenerateEmbeddings
};
