const { pool, generateId } = require('../utils/pgDb');

const WEIGHTS = {
  errorRate: 0.40,
  repetitionRate: 0.20,
  lecturerFocus: 0.20,
  lastScoreInverted: 0.20,
};

const ERROR_TYPE_LABELS = {
  concept: 'Konzeptverständnis',
  formula_mixup: 'Formel-/Regelverwechslung',
  careless: 'Unaufmerksamkeitsfehler',
  definition_gap: 'Definitionslücke',
  calculation: 'Rechenfehler',
  unknown: 'Unklarer Fehlertyp',
};

/**
 * Compute topic priority explanations for a subject and upsert into DB.
 * Returns array of { topic, priority, composite_score, summary, factors[] }
 */
const getTopicPriority = async (subjectId, userId) => {
  const client = await pool.connect();
  try {
    const userIdInt = Number(userId);
    if (!Number.isInteger(userIdInt)) {
      return 'forbidden';
    }

    // Verify subject exists and is accessible by owner or subscriber
    const subjectResult = await client.query(
      'SELECT id, user_id FROM subjects WHERE id = $1',
      [subjectId]
    );
    if (subjectResult.rows.length === 0) {
      return null; // subject not found
    }

    const subject = subjectResult.rows[0];
    const isOwner = Number(subject.user_id) === userIdInt;

    if (!isOwner) {
      const subscriptionResult = await client.query(
        `SELECT 1
         FROM subject_subscriptions
         WHERE subject_id = $1 AND subscriber_user_id = $2
         LIMIT 1`,
        [subjectId, userIdInt]
      );

      if (subscriptionResult.rows.length === 0) {
        return 'forbidden';
      }
    }

    // Gather all known topics for this subject
    const topicsResult = await client.query(
      `SELECT DISTINCT topic FROM (
         SELECT topic FROM user_answers ua
           JOIN assessment_sessions s ON ua.session_id = s.id
           WHERE s.subject_id = $1 AND s.user_id = $2 AND ua.topic IS NOT NULL AND ua.topic <> ''
         UNION
         SELECT topic FROM error_patterns WHERE subject_id = $1
         UNION
         SELECT topic FROM assessment_questions WHERE subject_id = $1 AND user_id = $2 AND topic IS NOT NULL AND topic <> ''
       ) t`,
      [subjectId, userIdInt]
    );

    const topics = topicsResult.rows.map((r) => r.topic);

    if (topics.length === 0) {
      return [];
    }

    // ── Factor 1: Fehlerquote per topic (weight 0.40) ──────────────────────────
    const errorRateResult = await client.query(
      `SELECT ua.topic,
              COUNT(*) AS total,
              SUM(CASE WHEN ua.is_correct THEN 0 ELSE 1 END) AS wrong
       FROM user_answers ua
         JOIN assessment_sessions s ON ua.session_id = s.id
       WHERE s.subject_id = $1 AND s.user_id = $2 AND ua.topic IS NOT NULL AND ua.topic <> ''
       GROUP BY ua.topic`,
      [subjectId, userIdInt]
    );
    const errorRateMap = {};
    for (const row of errorRateResult.rows) {
      errorRateMap[row.topic] = row.total > 0 ? row.wrong / row.total : 0;
    }

    // ── Factor 2: Wiederholungsrate per topic (weight 0.20) ───────────────────
    const repetitionResult = await client.query(
      `SELECT ua.topic, COUNT(*) AS count
       FROM user_answers ua
         JOIN assessment_sessions s ON ua.session_id = s.id
       WHERE s.subject_id = $1 AND s.user_id = $2 AND ua.topic IS NOT NULL AND ua.topic <> ''
       GROUP BY ua.topic`,
      [subjectId, userIdInt]
    );
    const repetitionMap = {};
    for (const row of repetitionResult.rows) {
      repetitionMap[row.topic] = Math.min(Number(row.count) / 10, 1);
    }

    // ── Factor 3: Dozentenfokus per topic (weight 0.20) ───────────────────────
    // Proxy: share of assessment questions about this topic
    const questionCountResult = await client.query(
      `SELECT topic, COUNT(*) AS count
       FROM assessment_questions
       WHERE subject_id = $1 AND user_id = $2 AND topic IS NOT NULL AND topic <> ''
       GROUP BY topic`,
      [subjectId, userIdInt]
    );
    const totalQuestionsResult = await client.query(
      `SELECT COUNT(*) AS total FROM assessment_questions WHERE subject_id = $1 AND user_id = $2`,
      [subjectId, userIdInt]
    );
    const totalQuestions = Number(totalQuestionsResult.rows[0].total) || 0;
    const lecturerFocusMap = {};
    for (const row of questionCountResult.rows) {
      lecturerFocusMap[row.topic] = totalQuestions > 0
        ? Math.min(Number(row.count) / totalQuestions, 1)
        : 0;
    }

    // ── Factor 4: Letzter Score invertiert (weight 0.20) ─────────────────────
    // Most recent assessment session score for the subject → inverted
    const lastSessionResult = await client.query(
      `SELECT score_pct FROM assessment_sessions
       WHERE subject_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [subjectId, userIdInt]
    );
    const lastScoreInvertedGlobal = lastSessionResult.rows.length > 0
      ? 1 - lastSessionResult.rows[0].score_pct / 100
      : 0.5; // neutral default when no session exists

    const repeatedHintMap = {};
    if (userIdInt !== undefined && userIdInt !== null) {
      const recentHintsResult = await client.query(
        `SELECT r.topic, r.error_type, COUNT(*)::int AS count
         FROM (
           SELECT ua.topic, ua.error_type
           FROM user_answers ua
           INNER JOIN assessment_sessions s ON s.id = ua.session_id
           WHERE s.subject_id = $1
             AND s.user_id = $2
             AND ua.is_correct = FALSE
             AND ua.topic IS NOT NULL
             AND TRIM(ua.topic) <> ''
             AND ua.error_type IS NOT NULL
             AND TRIM(ua.error_type) <> ''
           ORDER BY s.created_at DESC
           LIMIT 5
         ) r
         GROUP BY r.topic, r.error_type`,
        [subjectId, userIdInt]
      );

      for (const row of recentHintsResult.rows) {
        if (Number(row.count) < 3) continue;
        const topic = String(row.topic || '').trim();
        if (!topic) continue;

        if (!repeatedHintMap[topic]) {
          repeatedHintMap[topic] = [];
        }

        const normalizedType = String(row.error_type || '').trim().toLowerCase() || 'unknown';
        repeatedHintMap[topic].push({
          error_type: normalizedType,
          error_type_label: ERROR_TYPE_LABELS[normalizedType] || ERROR_TYPE_LABELS.unknown,
          topic,
          count: Number(row.count),
        });
      }
    }

    // ── Build result per topic ────────────────────────────────────────────────
    const results = [];

    for (const topic of topics) {
      const fErrorRate = errorRateMap[topic] ?? 0;
      const fRepetition = repetitionMap[topic] ?? 0;
      const fLecturerFocus = lecturerFocusMap[topic] ?? 0;
      const fLastScore = lastScoreInvertedGlobal;

      const compositeScore =
        fErrorRate * WEIGHTS.errorRate +
        fRepetition * WEIGHTS.repetitionRate +
        fLecturerFocus * WEIGHTS.lecturerFocus +
        fLastScore * WEIGHTS.lastScoreInverted;

      const priority =
        compositeScore >= 0.6 ? 'high'
        : compositeScore >= 0.3 ? 'medium'
        : 'low';

      const factors = [
        {
          name: 'Fehlerquote',
          value: Math.round(fErrorRate * 100),
          contribution: parseFloat((fErrorRate * WEIGHTS.errorRate).toFixed(3)),
        },
        {
          name: 'Wiederholungsrate',
          value: Math.round(fRepetition * 100),
          contribution: parseFloat((fRepetition * WEIGHTS.repetitionRate).toFixed(3)),
        },
        {
          name: 'Dozentenfokus',
          value: Math.round(fLecturerFocus * 100),
          contribution: parseFloat((fLecturerFocus * WEIGHTS.lecturerFocus).toFixed(3)),
        },
        {
          name: 'Letzter Score invertiert',
          value: Math.round(fLastScore * 100),
          contribution: parseFloat((fLastScore * WEIGHTS.lastScoreInverted).toFixed(3)),
        },
      ];

      // Summary: top 2 dominant factors by contribution
      const sortedFactors = [...factors].sort((a, b) => b.contribution - a.contribution);
      const topFactors = sortedFactors.slice(0, 2);
      const priorityLabel =
        priority === 'high' ? 'Hoch priorisiert'
        : priority === 'medium' ? 'Mittel priorisiert'
        : 'Niedrig priorisiert';
      const factorParts = topFactors.map((f) => {
        if (f.name === 'Fehlerquote') return `Fehlerquote ${f.value}%`;
        if (f.name === 'Wiederholungsrate') return `Wiederholungsrate ${f.value}%`;
        if (f.name === 'Dozentenfokus') return `Dozentenfokus ${f.value}%`;
        if (f.name === 'Letzter Score invertiert') return `zuletzt Score ${100 - f.value}%`;
        return `${f.name} ${f.value}%`;
      });
      const summary = `${priorityLabel}: ${factorParts.join(' + ')}`;

      const repeatedErrorHints = repeatedHintMap[topic] || [];

      // Upsert into topic_priority_explanations
      await client.query(
        `INSERT INTO topic_priority_explanations
           (id, subject_id, topic, priority, composite_score, factors, repeated_error_hints, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (subject_id, topic) DO UPDATE SET
           priority = EXCLUDED.priority,
           composite_score = EXCLUDED.composite_score,
           factors = EXCLUDED.factors,
           repeated_error_hints = EXCLUDED.repeated_error_hints,
           computed_at = EXCLUDED.computed_at`,
        [
          generateId(),
          subjectId,
          topic,
          priority,
          parseFloat(compositeScore.toFixed(3)),
          JSON.stringify(factors),
          JSON.stringify(repeatedErrorHints),
        ]
      );

      results.push({
        topic,
        priority,
        composite_score: parseFloat(compositeScore.toFixed(3)),
        summary,
        factors,
        repeated_error_hints: repeatedErrorHints,
      });
    }

    return results;
  } finally {
    client.release();
  }
};

module.exports = { getTopicPriority };
