const { pool, generateId } = require('../utils/pgDb');
const { normalizeLearningStyle } = require('../utils/learningStyle');

// Subject model
const Subject = {
  // Find subjects for a user with filter modes: own | subscribed | all
  findAll: async (sortBy = 'created_at', order = 'DESC', userId, filter = 'own') => {
    if (filter === 'subscribed') {
      const result = await pool.query(
        `SELECT s.*, u.username AS owner_username, COUNT(d.id)::int AS document_count, 'subscriber'::text AS ownership
         FROM subject_subscriptions sub
         JOIN subjects s ON s.id = sub.subject_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN documents d ON d.subject_id = s.id
         WHERE sub.subscriber_user_id = $1
         GROUP BY s.id, u.username
         ORDER BY s.${sortBy} ${order}`,
        [userId]
      );
      return result.rows;
    }

    if (filter === 'all') {
      const result = await pool.query(
        `SELECT x.*, COUNT(d.id)::int AS document_count
         FROM (
           SELECT s.*, NULL::text AS owner_username, 'owner'::text AS ownership
           FROM subjects s
           WHERE s.user_id = $1
           UNION
           SELECT s.*, u.username AS owner_username, 'subscriber'::text AS ownership
           FROM subject_subscriptions sub
           JOIN subjects s ON s.id = sub.subject_id
           JOIN users u ON u.id = s.user_id
           WHERE sub.subscriber_user_id = $1
         ) x
         LEFT JOIN documents d ON d.subject_id = x.id
         GROUP BY x.id, x.name, x.description, x.lecturer_name, x.difficulty, x.exam_notes, x.created_at, x.updated_at, x.user_id, x.is_public, x.owner_username, x.ownership
         ORDER BY x.${sortBy} ${order}`,
        [userId]
      );
      return result.rows;
    }

    const result = await pool.query(
      `SELECT s.*, NULL::text AS owner_username, COUNT(d.id)::int AS document_count, 'owner'::text AS ownership
       FROM subjects s
       LEFT JOIN documents d ON d.subject_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.${sortBy} ${order}`,
      [userId]
    );
    return result.rows;
  },

  // Find subject by ID
  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM subjects WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  // Find subject by name
  findByName: async (name) => {
    const result = await pool.query(
      'SELECT * FROM subjects WHERE name = $1',
      [name]
    );
    return result.rows[0];
  },

  // Create new subject
  create: async (data) => {
    const { name, description, lecturer_name, difficulty, exam_notes, user_id, is_public } = data;
    const id = generateId();
    const result = await pool.query(
      'INSERT INTO subjects (id, name, description, lecturer_name, difficulty, exam_notes, user_id, is_public) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [id, name, description, lecturer_name || null, difficulty || null, exam_notes || null, user_id || null, is_public || false]
    );
    return result.rows[0];
  },

  // Update subject
  update: async (id, data) => {
    const { name, description, lecturer_name, difficulty, exam_notes, is_public } = data;
    const result = await pool.query(
      'UPDATE subjects SET name = $1, description = $2, lecturer_name = $3, difficulty = $4, exam_notes = $5, is_public = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
      [name, description, lecturer_name ?? null, difficulty ?? null, exam_notes ?? null, is_public ?? false, id]
    );
    return result.rows[0];
  },

  // Delete subject
  delete: async (id) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Legacy databases may still have user_answers.question_id without
      // ON DELETE CASCADE. Remove dependent answers explicitly first.
      await client.query(
        `DELETE FROM user_answers ua
         USING assessment_questions aq
         WHERE ua.question_id = aq.id
           AND aq.subject_id = $1`,
        [id]
      );

      await client.query('DELETE FROM subjects WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { id };
  },

  // Get documents for a subject
  getDocuments: async (subjectId) => {
    const result = await pool.query(
      'SELECT * FROM documents WHERE subject_id = $1',
      [subjectId]
    );
    return result.rows;
  },

  // Add document to subject (not needed with PostgreSQL foreign keys)
  addDocument: async (subjectId, documentId) => {
    // This is a no-op in PostgreSQL since we use foreign keys
    // But we keep it for API compatibility
    return { subjectId, documentId };
  },

  // Remove document from subject (not needed with PostgreSQL foreign keys)
  removeDocument: async (subjectId, documentId) => {
    // This is a no-op in PostgreSQL since we use foreign keys
    // But we keep it for API compatibility
    return { subjectId, documentId };
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTION FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════════

  // Find all public subjects (globally visible) with pagination and search
  findPublic: async (options = {}) => {
    const { search = '', limit = 20, offset = 0, sort = 'name', order = 'ASC' } = options;
    const searchTerm = `%${search}%`;
    const orderBy = sort === 'subscriber_count' ? 'subscriber_count' : `s.${sort}`;

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total FROM subjects WHERE is_public = true AND (name ILIKE $1 OR description ILIKE $1)`,
      [searchTerm]
    );
    const total = countResult.rows[0].total;

    // Get paginated results
    const result = await pool.query(
      `SELECT s.*, 
              u.username AS owner_username,
              COUNT(DISTINCT d.id)::int AS document_count,
              COUNT(DISTINCT ss.subscriber_user_id)::int AS subscriber_count
       FROM subjects s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN documents d ON s.id = d.subject_id
       LEFT JOIN subject_subscriptions ss ON s.id = ss.subject_id
       WHERE s.is_public = true AND (s.name ILIKE $1 OR s.description ILIKE $1)
       GROUP BY s.id, u.username
       ORDER BY ${orderBy} ${order}
       LIMIT $2 OFFSET $3`,
      [searchTerm, limit, offset]
    );

    return {
      subjects: result.rows,
      total,
    };
  },

  // Check if user is subscribed to a subject
  checkSubscription: async (subjectId, userId) => {
    const result = await pool.query(
      `SELECT * FROM subject_subscriptions 
       WHERE subject_id = $1 AND subscriber_user_id = $2`,
      [subjectId, userId]
    );
    return result.rows[0] || null;
  },

  // Subscribe user to a subject
  subscribe: async (subjectId, userId) => {
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO subject_subscriptions (id, subject_id, subscriber_user_id, permission, subscribed_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, subjectId, userId, 'read_only']
    );
    return result.rows[0];
  },

  // Unsubscribe user from a subject
  unsubscribe: async (subjectId, userId) => {
    await pool.query(
      `DELETE FROM subject_subscriptions 
       WHERE subject_id = $1 AND subscriber_user_id = $2`,
      [subjectId, userId]
    );
    return { success: true };
  },

  // Get all subjects user is subscribed to
  getMySubscriptions: async (userId) => {
    const result = await pool.query(
      `SELECT s.*, 
              u.username AS owner_username,
              COUNT(DISTINCT d.id)::int AS document_count,
              MAX(ss.subscribed_at) AS subscribed_at
       FROM subjects s
       JOIN users u ON s.user_id = u.id
       JOIN subject_subscriptions ss ON s.id = ss.subject_id
       LEFT JOIN documents d ON s.id = d.subject_id
       WHERE ss.subscriber_user_id = $1
       GROUP BY s.id, u.username
       ORDER BY subscribed_at DESC`,
      [userId]
    );
    return result.rows;
  },

  // Get all subscribers of a subject
  getSubscribers: async (subjectId) => {
    const result = await pool.query(
      `SELECT u.id, u.username, ss.subscribed_at
       FROM subject_subscriptions ss
       JOIN users u ON ss.subscriber_user_id = u.id
       WHERE ss.subject_id = $1
       ORDER BY ss.subscribed_at DESC`,
      [subjectId]
    );
    return result.rows;
  }
};

// Document model
const Document = {
  // Find all documents
  findAll: async () => {
    const result = await pool.query('SELECT * FROM documents');
    return result.rows;
  },

  // Find document by ID
  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM documents WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  // Find documents belonging to subjects owned by a user
  findByUser: async (userId) => {
    const result = await pool.query(
      `SELECT d.* FROM documents d
       JOIN subjects s ON s.id = d.subject_id
       WHERE s.user_id = $1`,
      [userId]
    );
    return result.rows;
  },

  // Find documents for a subject, verifying user ownership
  findBySubjectAndUser: async (subjectId, userId) => {
    const result = await pool.query(
      `SELECT d.* FROM documents d
       JOIN subjects s ON s.id = d.subject_id
       WHERE d.subject_id = $1 AND s.user_id = $2`,
      [subjectId, userId]
    );
    return result.rows;
  },

  // Find documents by subject ID
  find: async (criteria = {}) => {
    if (criteria.subject) {
      const result = await pool.query(
        'SELECT * FROM documents WHERE subject_id = $1',
        [criteria.subject]
      );
      return result.rows;
    }
    
    // If no criteria, return all documents
    return Document.findAll();
  },

  // Create new document
  create: async (data) => {
    const {
      name,
      originalFilename,
      fileType,
      filePath,
      content,
      subject,
      vectorId
    } = data;
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO documents 
       (id, name, original_filename, file_type, file_path, content, subject_id, vector_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [id, name, originalFilename, fileType, filePath, content, subject, vectorId || null]
    );
    return result.rows[0];
  },

  // Update document
  update: async (id, data) => {
    // Build dynamic query based on provided fields
    const fields = [];
    const values = [];
    let paramIndex = 1;

    // Process each field if it exists in the data
    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.originalFilename !== undefined) {
      fields.push(`original_filename = $${paramIndex++}`);
      values.push(data.originalFilename);
    }
    if (data.fileType !== undefined) {
      fields.push(`file_type = $${paramIndex++}`);
      values.push(data.fileType);
    }
    if (data.filePath !== undefined) {
      fields.push(`file_path = $${paramIndex++}`);
      values.push(data.filePath);
    }
    if (data.content !== undefined) {
      fields.push(`content = $${paramIndex++}`);
      values.push(data.content);
    }
    if (data.subject !== undefined) {
      fields.push(`subject_id = $${paramIndex++}`);
      values.push(data.subject);
    }
    if (data.vectorId !== undefined) {
      fields.push(`vector_id = $${paramIndex++}`);
      values.push(data.vectorId);
    }

    // Add updated_at timestamp
    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    // Add ID to values array
    values.push(id);

    // Execute query if there are fields to update
    if (fields.length > 0) {
      const query = `
        UPDATE documents 
        SET ${fields.join(', ')} 
        WHERE id = $${paramIndex} 
        RETURNING *
      `;
      const result = await pool.query(query, values);
      return result.rows[0];
    }

    // If no fields to update, just return the document
    return Document.findById(id);
  },

  // Delete document
  delete: async (id) => {
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    return { id };
  },

  // Save document (for compatibility with Mongoose)
  save: async (document) => {
    if (document.id) {
      // Update existing document
      return Document.update(document.id, document);
    } else {
      // Create new document
      return Document.create(document);
    }
  },

  // Delete one document (for compatibility with Mongoose)
  deleteOne: async (document) => {
    return Document.delete(document.id);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// ASSESSMENT MODELS
// ══════════════════════════════════════════════════════════════════════════════

// AssessmentQuestion model
const AssessmentQuestion = {
  // Find all questions for a subject (no time filter) – used by question manager
  findBySubject: async (subjectId, userId) => {
    const result = await pool.query(
      'SELECT * FROM assessment_questions WHERE subject_id = $1 AND user_id = $2 ORDER BY is_manual DESC, generated_at DESC',
      [subjectId, userId]
    );
    return result.rows;
  },

  // Returns all questions (generated and manual) without a time filter.
  findAllBySubject: async (subjectId, userId) => {
    const result = await pool.query(
      `SELECT * FROM assessment_questions WHERE subject_id = $1 AND user_id = $2 ORDER BY is_manual DESC, generated_at ASC`,
      [subjectId, userId]
    );
    return result.rows;
  },

  // Returns recent generated questions plus all manual questions.
  findCachedBySubject: async (subjectId, userId) => {
    const result = await pool.query(
      `SELECT * FROM assessment_questions
       WHERE subject_id = $1
         AND user_id = $2
         AND (is_manual = TRUE OR generated_at > NOW() - INTERVAL '24 hours')
       ORDER BY is_manual DESC, generated_at DESC`,
      [subjectId, userId]
    );
    return result.rows;
  },

  // Find question by ID
  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM assessment_questions WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  // Creates multiple generated questions in one transaction.
  createMany: async (questions) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const createdQuestions = [];

      for (const q of questions) {
        const id = generateId();
        const result = await client.query(
          `INSERT INTO assessment_questions
           (id, subject_id, user_id, question, options, correct_index, topic, explanation, is_manual)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, q.subject_id, q.user_id, q.question, JSON.stringify(q.options), q.correct_index, q.topic, q.explanation, q.is_manual ?? false]
        );
        createdQuestions.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdQuestions;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Create a single manual question (is_manual = TRUE)
  create: async (data) => {
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO assessment_questions
       (id, subject_id, user_id, question, options, correct_index, topic, explanation, is_manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [id, data.subject_id, data.user_id, data.question, JSON.stringify(data.options), data.correct_index, data.topic, data.explanation]
    );
    return result.rows[0];
  },

  // Update a question (text, options, correct_index, topic, explanation)
  update: async (id, data) => {
    const result = await pool.query(
      `UPDATE assessment_questions
       SET question = $1, options = $2, correct_index = $3, topic = $4, explanation = $5
       WHERE id = $6 RETURNING *`,
      [data.question, JSON.stringify(data.options), data.correct_index, data.topic, data.explanation, id]
    );
    return result.rows[0];
  },

  // Delete a single question by id
  deleteOne: async (id) => {
    await pool.query('DELETE FROM assessment_questions WHERE id = $1', [id]);
    return { id };
  },

  // Cache invalidation: only removes KI-generated questions, manual ones survive
  deleteBySubject: async (subjectId, userId) => {
    await pool.query('DELETE FROM assessment_questions WHERE subject_id = $1 AND user_id = $2 AND is_manual = FALSE', [subjectId, userId]);
    return { subjectId, userId };
  }
};

// AssessmentSession model
const AssessmentSession = {
  // Find all sessions for a subject
  findBySubject: async (subjectId, userId = null) => {
    const params = [subjectId];
    let query = `SELECT s.*
                 FROM assessment_sessions s
                 WHERE s.subject_id = $1
                   AND NOT EXISTS (
                     SELECT 1 FROM post_exam_reviews pr
                     WHERE pr.session_id = s.id
                   )`;

    if (userId !== null && userId !== undefined) {
      params.push(String(userId));
      query += ' AND s.user_id = $2';
    }

    query += ' ORDER BY s.created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  },

  // Find last session for a subject
  findLastBySubject: async (subjectId, userId = null) => {
    const params = [subjectId];
    let query = `SELECT s.*
                 FROM assessment_sessions s
                 WHERE s.subject_id = $1
                   AND NOT EXISTS (
                     SELECT 1 FROM post_exam_reviews pr
                     WHERE pr.session_id = s.id
                   )`;

    if (userId !== null && userId !== undefined) {
      params.push(String(userId));
      query += ' AND s.user_id = $2';
    }

    query += ' ORDER BY s.created_at DESC LIMIT 1';

    const result = await pool.query(query, params);
    return result.rows[0];
  },

  // Find the latest session for each subject (returns a map: subject_id -> session)
  findLatestForAllSubjects: async (userId = null) => {
    const params = [];
    let query = `SELECT DISTINCT ON (s.subject_id) s.*
       FROM assessment_sessions s
       WHERE NOT EXISTS (
         SELECT 1 FROM post_exam_reviews pr
         WHERE pr.session_id = s.id
       )`;

    if (userId !== null && userId !== undefined) {
      params.push(String(userId));
      query += ' AND s.user_id = $1';
    }

    query += ' ORDER BY s.subject_id, s.created_at DESC';

    const result = await pool.query(query, params);
    const map = {};
    for (const row of result.rows) {
      map[row.subject_id] = row;
    }
    return map;
  },

  // Find session by ID
  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM assessment_sessions WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  // Find latest sessions for a user
  findByUser: async (userId, limit = 20) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 20;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 100));

    const result = await pool.query(
      `SELECT s.*
       FROM assessment_sessions s
       WHERE s.user_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM post_exam_reviews pr
           WHERE pr.session_id = s.id
         )
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [String(userId), safeLimit]
    );
    return result.rows;
  },

  // Create new session
  create: async (data) => {
    const { subject_id, user_id, score, total, score_pct, grade_prognosis, duration_seconds } = data;
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO assessment_sessions 
       (id, subject_id, user_id, score, total, score_pct, grade_prognosis, duration_seconds) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [id, subject_id, user_id || null, score, total, score_pct, grade_prognosis, duration_seconds ?? null]
    );
    return result.rows[0];
  }
};

// UserAnswer model
const UserAnswer = {
  // Find all answers for a session
  findBySession: async (sessionId) => {
    const result = await pool.query(
      'SELECT * FROM user_answers WHERE session_id = $1',
      [sessionId]
    );
    return result.rows;
  },

  // Create multiple answers at once
  createMany: async (answers) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const createdAnswers = [];

      for (const a of answers) {
        const id = generateId();
        const result = await client.query(
          `INSERT INTO user_answers 
           (id, session_id, question_id, selected_index, is_correct, topic, response_time_ms, error_type) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           RETURNING *`,
          [
            id,
            a.session_id,
            a.question_id,
            a.selected_index,
            a.is_correct,
            a.topic,
            a.response_time_ms ?? null,
            a.error_type ?? null,
          ]
        );
        createdAnswers.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdAnswers;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  getRecentResponseTimesByUser: async (userId, limit = 200) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 200;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 1000));

    const result = await pool.query(
      `SELECT ua.response_time_ms
       FROM user_answers ua
       INNER JOIN assessment_sessions s ON s.id = ua.session_id
       WHERE s.user_id = $1
         AND ua.response_time_ms IS NOT NULL
         AND ua.response_time_ms > 0
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [String(userId), safeLimit]
    );
    return result.rows;
  },

  getRecentWrongTopicsByUser: async (userId, limit = 80) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 80;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 500));

    const result = await pool.query(
      `SELECT ua.topic
       FROM user_answers ua
       INNER JOIN assessment_sessions s ON s.id = ua.session_id
       WHERE s.user_id = $1
         AND ua.is_correct = FALSE
         AND ua.topic IS NOT NULL
         AND TRIM(ua.topic) <> ''
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [String(userId), safeLimit]
    );
    return result.rows;
  },

  getRecentRelevantAnswersByUserAndSubject: async (userId, subjectId, limit = 5) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 5;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 20));

    const result = await pool.query(
      `SELECT
         ua.topic,
         ua.error_type,
         ua.is_correct,
         s.created_at,
         aq.question AS question_text,
         aq.explanation AS question_explanation
       FROM user_answers ua
       INNER JOIN assessment_sessions s ON s.id = ua.session_id
       LEFT JOIN assessment_questions aq ON aq.id = ua.question_id
       WHERE s.user_id = $1
         AND s.subject_id = $2
         AND ua.is_correct = FALSE
         AND ua.topic IS NOT NULL
         AND TRIM(ua.topic) <> ''
         AND ua.error_type IS NOT NULL
         AND TRIM(ua.error_type) <> ''
       ORDER BY s.created_at DESC
       LIMIT $3`,
      [String(userId), String(subjectId), safeLimit]
    );
    return result.rows;
  }
};

// ErrorPattern model
const ErrorPattern = {
  // Find all error patterns for a subject
  findBySubject: async (subjectId) => {
    const result = await pool.query(
      'SELECT * FROM error_patterns WHERE subject_id = $1',
      [subjectId]
    );
    return result.rows;
  },

  // Find error pattern by subject and topic
  findBySubjectAndTopic: async (subjectId, topic) => {
    const result = await pool.query(
      'SELECT * FROM error_patterns WHERE subject_id = $1 AND topic = $2',
      [subjectId, topic]
    );
    return result.rows[0];
  },

  // Increment error count for a topic
  incrementError: async (subjectId, topic) => {
    const existing = await ErrorPattern.findBySubjectAndTopic(subjectId, topic);
    
    if (existing) {
      const result = await pool.query(
        `UPDATE error_patterns 
         SET error_count = error_count + 1, last_seen = CURRENT_TIMESTAMP 
         WHERE id = $1 
         RETURNING *`,
        [existing.id]
      );
      return result.rows[0];
    } else {
      const id = generateId();
      const result = await pool.query(
        `INSERT INTO error_patterns 
         (id, subject_id, user_id, topic, error_count) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [id, subjectId, null, topic, 1]
      );
      return result.rows[0];
    }
  },

  // Decrement error count for a topic (minimum 0)
  decrementError: async (subjectId, topic) => {
    const existing = await ErrorPattern.findBySubjectAndTopic(subjectId, topic);
    
    if (existing && existing.error_count > 0) {
      const result = await pool.query(
        `UPDATE error_patterns 
         SET error_count = GREATEST(error_count - 1, 0), last_seen = CURRENT_TIMESTAMP 
         WHERE id = $1 
         RETURNING *`,
        [existing.id]
      );
      return result.rows[0];
    }
    
    return existing;
  }
};

// PostExamReview model
const PostExamReview = {
  // Create a completed post-exam review
  create: async (data) => {
    const { subject_id, session_id, score, total, score_pct, grade_prognosis } = data;
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO post_exam_reviews
       (id, subject_id, session_id, score, total, score_pct, grade_prognosis)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, subject_id, session_id || null, score, total, score_pct, grade_prognosis]
    );
    return result.rows[0];
  },

  // History for one subject (latest first)
  findBySubject: async (subjectId, limit = 10, userId = null) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 10;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 50));
    const params = [subjectId, safeLimit];
    let query = `SELECT r.*
       FROM post_exam_reviews r`;

    if (userId !== null && userId !== undefined) {
      params.push(String(userId));
      query += ' INNER JOIN assessment_sessions s ON s.id = r.session_id';
    }

    query += ' WHERE r.subject_id = $1';

    if (userId !== null && userId !== undefined) {
      query += ' AND s.user_id = $3';
    }

    query += ' ORDER BY r.created_at DESC LIMIT $2';

    const result = await pool.query(query, params);
    return result.rows;
  },

  // Latest review for one subject
  findLatestBySubject: async (subjectId) => {
    const result = await pool.query(
      `SELECT * FROM post_exam_reviews
       WHERE subject_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [subjectId]
    );
    return result.rows[0];
  },

  // Find the review that belongs to a specific assessment session.
  findBySession: async (sessionId) => {
    const result = await pool.query(
      `SELECT * FROM post_exam_reviews
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );
    return result.rows[0];
  },

  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM post_exam_reviews WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }
};

const PostExamReviewItem = {
  // Batch insert review items
  createMany: async (reviewId, items) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const createdItems = [];

      for (const item of items) {
        const id = generateId();
        const result = await client.query(
          `INSERT INTO post_exam_review_items
           (id, review_id, topic, question_text, expected_answer, came_up_in_exam, was_correct, confidence, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            id,
            reviewId,
            item.topic,
            item.question_text,
            item.expected_answer,
            item.came_up_in_exam,
            item.was_correct,
            item.confidence,
            item.source || 'standard'
          ]
        );
        createdItems.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdItems;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  findByReview: async (reviewId) => {
    const result = await pool.query(
      `SELECT * FROM post_exam_review_items
       WHERE review_id = $1
       ORDER BY created_at ASC`,
      [reviewId]
    );
    return result.rows;
  }
};

// Flashcard model
const Flashcard = {
  findById: async (id) => {
    const result = await pool.query(
      'SELECT * FROM flashcards WHERE id = $1',
      [id]
    );
    return result.rows[0];
  },

  findBySubject: async (subjectId, userId, { dueOnly = false, includeArchived = false, limit = 100, guidedStep = null } = {}) => {
    const parsedLimit = Number.isFinite(limit) ? Number(limit) : 100;
    const safeLimit = Math.max(1, Math.min(parsedLimit, 500));

    const conditions = ['f.subject_id = $1', 'f.user_id = $2'];
    const params = [subjectId, userId];
    let index = 2;

    if (!includeArchived) {
      conditions.push('f.is_archived = FALSE');
    }

    if (guidedStep !== null && guidedStep !== undefined) {
      index += 1;
      conditions.push(`f.guided_step = $${index}`);
      params.push(Number(guidedStep));
    }

    if (dueOnly) {
      conditions.push('f.due_at <= NOW()');
    }

    index += 1;
    params.push(safeLimit);

    const result = await pool.query(
      `SELECT f.*,
              (SELECT rating FROM flashcard_reviews 
               WHERE flashcard_id = f.id 
               ORDER BY reviewed_at DESC 
               LIMIT 1) AS last_review_rating
       FROM flashcards f
       WHERE ${conditions.join(' AND ')}
       ORDER BY f.due_at ASC, f.created_at ASC
       LIMIT $${index}`,
      params
    );
    return result.rows;
  },

  findBySubjectAsMap: async (subjectId, userId) => {
    const rows = await Flashcard.findBySubject(subjectId, userId, { dueOnly: false, includeArchived: false, limit: 1000 });
    const map = new Map();
    for (const card of rows) {
      const key = `${String(card.term || '').trim().toLowerCase()}::${String(card.answer || '').trim().toLowerCase()}`;
      map.set(key, card);
    }
    return map;
  },

  create: async (data) => {
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO flashcards
       (id, subject_id, user_id, term, answer, hint, topic, source, guided_step, repetition, interval_days, ease_factor, due_at, is_archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0), COALESCE($11, 0), COALESCE($12, 2.5), COALESCE($13, CURRENT_TIMESTAMP), COALESCE($14, FALSE))
       RETURNING *`,
      [
        id,
        data.subject_id,
        data.user_id,
        data.term,
        data.answer,
        data.hint || null,
        data.topic || null,
        data.source || 'manual',
        data.guided_step ?? null,
        data.repetition,
        data.interval_days,
        data.ease_factor,
        data.due_at,
        data.is_archived,
      ]
    );
    return result.rows[0];
  },

  createMany: async (cards) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const createdCards = [];

      for (const card of cards) {
        const id = generateId();
        const result = await client.query(
          `INSERT INTO flashcards
               (id, subject_id, user_id, term, answer, hint, topic, source, guided_step, repetition, interval_days, ease_factor, due_at, is_archived)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0), COALESCE($11, 0), COALESCE($12, 2.5), COALESCE($13, CURRENT_TIMESTAMP), COALESCE($14, FALSE))
           RETURNING *`,
          [
            id,
            card.subject_id,
            card.user_id,
            card.term,
            card.answer,
            card.hint || null,
            card.topic || null,
            card.source || 'manual',
                card.guided_step ?? null,
                card.repetition,
                card.interval_days,
                card.ease_factor,
                card.due_at,
                card.is_archived,
          ]
        );
        createdCards.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdCards;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  update: async (id, data) => {
    const result = await pool.query(
      `UPDATE flashcards
       SET term = $1,
           answer = $2,
           hint = $3,
           topic = $4,
           source = $5,
           guided_step = COALESCE($6, guided_step),
           repetition = $7,
           interval_days = $8,
           ease_factor = $9,
           due_at = $10,
           last_reviewed_at = $11,
           is_archived = $12,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [
        data.term,
        data.answer,
        data.hint || null,
        data.topic || null,
        data.source || 'manual',
        data.guided_step ?? null,
        data.repetition ?? 0,
        data.interval_days ?? 0,
        data.ease_factor ?? 2.5,
        data.due_at || new Date(),
        data.last_reviewed_at || null,
        data.is_archived ?? false,
        id,
      ]
    );
    return result.rows[0];
  },

  archive: async (id) => {
    const result = await pool.query(
      `UPDATE flashcards
       SET is_archived = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0];
  },

  getStatsBySubject: async (subjectId, userId, guidedStep = null) => {
    const params = [subjectId, userId];
    let guidedClause = '';
    if (guidedStep !== null && guidedStep !== undefined) {
      params.push(Number(guidedStep));
      guidedClause = ' AND guided_step = $3';
    }

    const result = await pool.query(
      `SELECT
         SUM(CASE WHEN is_archived = FALSE THEN 1 ELSE 0 END)::int AS total_active,
         SUM(CASE WHEN is_archived = FALSE AND due_at <= NOW() THEN 1 ELSE 0 END)::int AS due_now,
         SUM(CASE WHEN is_archived = FALSE AND repetition = 0 THEN 1 ELSE 0 END)::int AS new_cards,
         SUM(CASE WHEN is_archived = FALSE AND repetition > 0 THEN 1 ELSE 0 END)::int AS learning_cards,
         SUM(CASE WHEN is_archived = TRUE THEN 1 ELSE 0 END)::int AS archived
       FROM flashcards
       WHERE subject_id = $1 AND user_id = $2${guidedClause}`,
      params
    );
    return result.rows[0] || {
      total_active: 0,
      due_now: 0,
      new_cards: 0,
      learning_cards: 0,
      archived: 0,
    };
  },
};

const FlashcardReview = {
  createMany: async (reviews) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = [];
      for (const review of reviews) {
        const id = generateId();
        const result = await client.query(
          `INSERT INTO flashcard_reviews
           (id, flashcard_id, subject_id, rating, was_correct)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [id, review.flashcard_id, review.subject_id, review.rating, review.was_correct]
        );
        created.push(result.rows[0]);
      }
      await client.query('COMMIT');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

// LearningProfile model
const LearningProfile = {
  // Returns the single global profile (user_id IS NULL), creates one if missing
  getGlobal: async () => {
    const existing = await pool.query(
      `SELECT * FROM learning_profile
       WHERE user_id IS NULL
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const id = generateId();
    const created = await pool.query(
      `INSERT INTO learning_profile (id, user_id, style, onboarding_completed)
       VALUES ($1, NULL, 'mixed', FALSE)
       RETURNING *`,
      [id]
    );
    return created.rows[0];
  },

  updateGlobal: async ({ style, onboarding_completed }) => {
    const profile = await LearningProfile.getGlobal();
    const nextStyle = normalizeLearningStyle(style);
    const nextOnboardingCompleted = Boolean(onboarding_completed);

    const updated = await pool.query(
      `UPDATE learning_profile
       SET style = $1,
           onboarding_completed = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [nextStyle, nextOnboardingCompleted, profile.id]
    );
    return updated.rows[0];
  }
};

const CognitiveProfile = {
  getByUserId: async (userId) => {
    const result = await pool.query(
      `SELECT * FROM cognitive_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [String(userId)]
    );
    return result.rows[0] || null;
  },

  upsertByUserId: async (userId, data) => {
    const id = generateId();
    const result = await pool.query(
      `INSERT INTO cognitive_profiles (id, user_id, tempo_score, abstraction_score, error_pattern_bias)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         tempo_score = EXCLUDED.tempo_score,
         abstraction_score = EXCLUDED.abstraction_score,
         error_pattern_bias = EXCLUDED.error_pattern_bias,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        id,
        String(userId),
        data.tempo_score || 'medium',
        data.abstraction_score || 'medium',
        JSON.stringify(data.error_pattern_bias || {}),
      ]
    );
    return result.rows[0];
  },

  getOrCreateByUserId: async (userId) => {
    const existing = await CognitiveProfile.getByUserId(userId);
    if (existing) return existing;

    return CognitiveProfile.upsertByUserId(userId, {
      tempo_score: 'medium',
      abstraction_score: 'medium',
      error_pattern_bias: {},
    });
  },
};

const GuidedLearningProgress = {
  getByUserAndSubject: async (userId, subjectId) => {
    const result = await pool.query(
      `SELECT * FROM guided_learning_progress
       WHERE user_id = $1 AND subject_id = $2
       LIMIT 1`,
      [String(userId), subjectId]
    );
    return result.rows[0] || null;
  },

  upsert: async ({ user_id, subject_id, current_step, completed_steps = [], is_completed = false, completed_at = null }) => {
    const id = generateId();
    const normalizedCurrentStep = Math.max(1, Math.min(4, Number(current_step) || 1));
    const normalizedCompletedSteps = Array.isArray(completed_steps)
      ? [...new Set(completed_steps.map((step) => Math.max(1, Math.min(4, Number(step) || 1))))].sort((a, b) => a - b)
      : [];

    const result = await pool.query(
      `INSERT INTO guided_learning_progress
       (id, user_id, subject_id, current_step, completed_steps, is_completed, completed_at, last_accessed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, subject_id)
       DO UPDATE SET
         current_step = EXCLUDED.current_step,
         completed_steps = EXCLUDED.completed_steps,
         is_completed = guided_learning_progress.is_completed OR EXCLUDED.is_completed,
         completed_at = COALESCE(guided_learning_progress.completed_at, EXCLUDED.completed_at),
         last_accessed = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        id,
        String(user_id),
        subject_id,
        normalizedCurrentStep,
        normalizedCompletedSteps,
        Boolean(is_completed),
        completed_at,
      ]
    );
    return result.rows[0];
  }
};

module.exports = {
  Subject,
  Document,
  AssessmentQuestion,
  AssessmentSession,
  UserAnswer,
  ErrorPattern,
  PostExamReview,
  PostExamReviewItem,
  Flashcard,
  FlashcardReview,
  LearningProfile,
  CognitiveProfile,
  GuidedLearningProgress
};