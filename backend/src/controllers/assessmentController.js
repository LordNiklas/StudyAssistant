const OpenAI = require('openai');
const { pool, generateId } = require('../utils/pgDb');
const {
  AssessmentQuestion,
  AssessmentSession,
  UserAnswer,
  ErrorPattern,
  Subject,
  LearningProfile,
  CognitiveProfile,
  GuidedLearningProgress,
  PostExamReview,
  PostExamReviewItem,
  Flashcard,
  FlashcardReview
} = require('../models/pgModels');
const { normalizeLearningStyle, getLearningStylePromptBlock } = require('../utils/learningStyle');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const calculateGradeFromPct = (scorePct) => {
  if (scorePct >= 90) return 1;
  if (scorePct >= 75) return 2;
  if (scorePct >= 60) return 3;
  if (scorePct >= 50) return 4;
  return 5;
};

const GRADE_BUCKETS = [1, 2, 3, 4, 5];
const GAUSSIAN_BANDWIDTH = 0.9;
const COGNITIVE_LLM_ENABLED = process.env.COGNITIVE_PROFILE_LLM_CLASSIFIER !== 'false';
const REPEATED_HINT_LLM_FALLBACK_ENABLED = process.env.REPEATED_HINT_LLM_FALLBACK !== 'false';

const GUIDED_LEARNING_STEPS = [
  {
    step: 1,
    phase: 'VERSTEHEN',
    title: 'Grundkonzepte klären',
    budget_hours: 4,
    estimated_certainty_gain: '0–60%',
  },
  {
    step: 2,
    phase: 'ÜBEN',
    title: 'Einstiegs-Aufgaben',
    budget_hours: 3,
    estimated_certainty_gain: '60–75%',
  },
  {
    step: 3,
    phase: 'TRANSFER',
    title: 'Komplexe Beziehungen erkennen',
    budget_hours: 4,
    estimated_certainty_gain: '75–90%',
  },
  {
    step: 4,
    phase: 'CHECK',
    title: 'Einstufungstest',
    budget_hours: 1,
    estimated_certainty_gain: '75–100%',
  },
];

const GUIDED_LEARNING_EXIT_CRITERIA = 'Wenn Score ≥ 75% bei Schritt 4, gilt das Fach als gelernt und kann als abgeschlossen markiert werden.';
const GUIDED_LEARNING_DEFAULT_TOTAL_HOURS = 12;
const GUIDED_LEARNING_MIN_HOURS = 4;
const GUIDED_LEARNING_MAX_HOURS = 30;
const GUIDED_LEARNING_WORDS_PER_HOUR = 850;
const GUIDED_LEARNING_STEP_WEIGHTS = [0.35, 0.25, 0.30, 0.10];

const normalizedGuidedStepWeights = (() => {
  const sum = GUIDED_LEARNING_STEP_WEIGHTS.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return [0.35, 0.25, 0.30, 0.10];
  return GUIDED_LEARNING_STEP_WEIGHTS.map((value) => value / sum);
})();

const guidedClamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Estimate the total number of guided-learning hours for a subject.
 *
 * @param {Object} options - Estimation inputs.
 * @param {Array} options.documents - Subject documents used to estimate scope.
 * @param {Object} options.subject - Subject metadata such as difficulty and lecturer name.
 * @param {Array} options.errorPatterns - User error history used to raise effort estimates.
 * @returns {number} Rounded hour estimate constrained to the guided-learning limits.
 */
const estimateGuidedLearningTotalHours = ({ documents = [], subject, errorPatterns = [] }) => {
  const totalWords = documents.reduce((sum, document) => {
    const content = String(document?.content || '').trim();
    if (!content) return sum;
    const words = content.split(/\s+/).filter(Boolean).length;
    return sum + words;
  }, 0);

  if (totalWords === 0) {
    return GUIDED_LEARNING_DEFAULT_TOTAL_HOURS;
  }

  const weakTopicCount = (errorPatterns || []).filter((pattern) => Number(pattern.error_count) >= 2).length;

  let complexityFactor = 1;
  const difficulty = String(subject?.difficulty || '').trim().toLowerCase();
  if (difficulty === 'killer') complexityFactor += 0.35;
  else if (difficulty === 'hard') complexityFactor += 0.2;
  else if (difficulty === 'medium') complexityFactor += 0.1;

  if (!subject?.lecturer_name) {
    complexityFactor += 0.1;
  }

  complexityFactor += guidedClamp(weakTopicCount * 0.03, 0, 0.2);

  const rawHours = (totalWords / GUIDED_LEARNING_WORDS_PER_HOUR) * complexityFactor;
  const roundedHours = Math.round(rawHours);
  return guidedClamp(roundedHours, GUIDED_LEARNING_MIN_HOURS, GUIDED_LEARNING_MAX_HOURS);
};

/**
 * Split the guided-learning budget across the four learning steps.
 *
 * @param {number} totalHours - Total available hours for the route.
 * @param {Array<number>} weights - Relative weights for each route step.
 * @returns {number[]} Four hour allocations that sum to the total budget.
 */
const distributeGuidedLearningHours = (totalHours, weights = normalizedGuidedStepWeights) => {
  const safeTotal = Math.max(GUIDED_LEARNING_MIN_HOURS, Math.round(Number(totalHours) || GUIDED_LEARNING_DEFAULT_TOTAL_HOURS));
  const normalizedWeights = Array.isArray(weights) && weights.length === 4 ? weights : normalizedGuidedStepWeights;

  const rawAllocations = normalizedWeights.map((weight) => safeTotal * weight);
  const floors = rawAllocations.map((value) => Math.floor(value));
  let remainder = safeTotal - floors.reduce((sum, value) => sum + value, 0);

  const order = rawAllocations
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction);

  const allocated = [...floors];
  let cursor = 0;
  while (remainder > 0) {
    const target = order[cursor % order.length]?.index ?? 0;
    allocated[target] += 1;
    remainder -= 1;
    cursor += 1;
  }

  return allocated;
};

/**
 * Build a short learning-style summary for the guided route.
 *
 * @param {string} style - Normalized or raw learning-style value.
 * @returns {string} A short instruction string that matches the style.
 */
const getLearningStyleGuidedSummary = (style) => {
  switch (normalizeLearningStyle(style)) {
    case 'visual':
      return 'Arbeite mit Skizzen, Übersichten und farbigen Markierungen.';
    case 'analytical':
      return 'Arbeite mit Definitionen, Regeln und klaren logischen Schritten.';
    case 'practical':
      return 'Starte mit Beispielen und übertrage das Wissen sofort in Aufgaben.';
    default:
      return 'Kombiniere kurze Erklärungen mit Beispielen und Wiederholungen.';
  }
};

/**
 * Clamp an arbitrary step value to the valid guided-learning range.
 *
 * @param {number|string} value - Incoming step value from the client.
 * @returns {1|2|3|4} A safe guided-learning step number.
 */
const normalizeStepNumber = (value) => {
  const step = Number(value);
  if (!Number.isFinite(step)) return 1;
  return Math.max(1, Math.min(4, Math.round(step)));
};

/**
 * Extract likely topic names from uploaded documents.
 *
 * @param {Array} documents - Subject documents with names and content.
 * @returns {string[]} Unique topic candidates limited to the strongest matches.
 */
const extractTopicCandidatesFromDocuments = (documents = []) => {
  const candidates = [];

  for (const document of documents) {
    const name = String(document?.name || '')
      .replace(/\.[^.]+$/, '')
      .trim();
    if (name) candidates.push(name);

    const lines = String(document?.content || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.length <= 90 && !line.startsWith('['));

    for (const line of lines.slice(0, 3)) {
      if (/^(#|[-*]|\d+\.)\s*/.test(line)) {
        candidates.push(line.replace(/^(#|[-*]|\d+\.)\s*/, '').trim());
      } else if (/[A-ZÄÖÜ]/.test(line[0] || '')) {
        candidates.push(line.replace(/[:.;]+$/, ''));
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))].slice(0, 6);
};

/**
 * Build the full four-step guided-learning route for one subject.
 *
 * @param {Object} options - Route inputs.
 * @param {Object} options.subject - Subject metadata used for topic selection.
 * @param {Array} options.documents - Uploaded documents used to derive topics.
 * @param {Object|null} options.latestSession - Most recent assessment session.
 * @param {Array} options.errorPatterns - Historical error patterns for weak-topic focus.
 * @param {string} options.activeLearningStyle - Current learning style of the user.
 * @returns {Object} A guided-learning route with steps, total hours, and exit criteria.
 */
const buildGuidedLearningRoute = ({
  subject,
  documents,
  latestSession,
  errorPatterns,
  activeLearningStyle,
}) => {
  const weakTopics = [...new Set((errorPatterns || [])
    .filter((pattern) => Number(pattern.error_count) >= 2)
    .map((pattern) => pattern.topic)
    .filter(Boolean))].slice(0, 4);

  const documentTopics = extractTopicCandidatesFromDocuments(documents);
  const subjectTopics = [...new Set([
    subject?.name,
    ...(subject?.description ? [subject.description.split(/[.!?]/)[0]] : []),
  ].filter(Boolean))].slice(0, 2);

  const combinedTopics = [...new Set([...weakTopics, ...documentTopics, ...subjectTopics])].slice(0, 6);
  const styleSummary = getLearningStyleGuidedSummary(activeLearningStyle);
  const latestScoreText = latestSession
    ? `Letzter Einstufungstest: ${latestSession.score_pct}% korrekt, Prognose: Note ${latestSession.grade_prognosis}.`
    : 'Noch kein abgeschlossener Einstufungstest vorhanden.';
  const totalHours = estimateGuidedLearningTotalHours({ documents, subject, errorPatterns });
  const stepBudgets = distributeGuidedLearningHours(totalHours);

  const routeSteps = GUIDED_LEARNING_STEPS.map((baseStep, index) => {
    if (baseStep.step === 1) {
      return {
        ...baseStep,
        budget_hours: stepBudgets[index],
        description: 'Starte ruhig mit den Kernbegriffen, damit die nächsten Schritte leichter fallen.',
        linked_topics: combinedTopics.slice(0, 3),
        action: `Zeige die wichtigsten Dokumente und fasse die Kernidee in ruhiger Sprache zusammen. ${styleSummary}`,
        action_type: 'review',
      };
    }

    if (baseStep.step === 2) {
      return {
        ...baseStep,
        budget_hours: stepBudgets[index],
        description: 'Sichere die Grundidee mit einfachen Aufgaben und kurzen Feedbackschleifen.',
        linked_topics: weakTopics.length > 0 ? weakTopics.slice(0, 3) : combinedTopics.slice(0, 3),
        action: 'Starte kurze Übungsaufgaben mit leichtem Schwierigkeitsgrad und direktem Feedback.',
        action_type: 'practice',
      };
    }

    if (baseStep.step === 3) {
      return {
        ...baseStep,
        budget_hours: stepBudgets[index],
        description: 'Verbinde einzelne Themen zu einem zusammenhängenden Verständnis.',
        linked_topics: [...new Set([...weakTopics.slice(0, 2), ...documentTopics.slice(0, 3)])].slice(0, 3),
        action: 'Arbeite mit gemischten Aufgaben, die mehrere Themen miteinander verbinden.',
        action_type: 'practice',
      };
    }

    return {
      ...baseStep,
      budget_hours: stepBudgets[index],
      description: latestScoreText,
      linked_topics: [...new Set([subject?.name, ...combinedTopics.slice(0, 2)])].slice(0, 3),
      action: 'Öffne den Einstufungstest und nutze das Ergebnis als Abschlussprüfung für den Guided Mode.',
      action_type: 'assessment',
    };
  });

  return {
    steps: routeSteps,
    total_hours: totalHours,
    exit_criteria: GUIDED_LEARNING_EXIT_CRITERIA,
  };
};

const ERROR_TYPE_LABELS = {
  concept: 'Konzeptverständnis',
  formula_mixup: 'Formel-/Regelverwechslung',
  careless: 'Unaufmerksamkeitsfehler',
  definition_gap: 'Definitionslücke',
  calculation: 'Rechenfehler',
  unknown: 'Unklarer Fehlertyp',
};

const TOPIC_SPECIFIC_HINTS = [
  {
    key: 'consulting',
    matcher: /(consulting|stakeholder|kpi|business case|prozess|strategie|roadmap|change management|it-beratung)/i,
    tips: {
      concept: 'Nutze ein 3-Schritte-Schema: Problem, Ursache, Wirkung auf KPI und wähle dann die passende Option.',
      formula_mixup: 'Lege vor der Antwort fest, ob es um Priorisierung, Governance oder Umsetzung geht und prüfe dann die Option dagegen.',
      careless: 'Prüfe jede Option gegen ein konkretes Stakeholder-Ziel (Kosten, Risiko, Time-to-Market), bevor du klickst.',
      definition_gap: 'Formuliere den Kernbegriff in einem Satz (z. B. KPI, SLA, Scope), dann eliminiere unpassende Optionen.',
      calculation: 'Markiere in der Aufgabe die Kennzahl und rechne den KPI-Schritt separat vor, bevor du die Endoption wählst.',
      unknown: 'Leite die Antwort aus Problem, Stakeholder und messbarem Ergebnis ab statt aus Bauchgefühl.',
    },
  },
  {
    key: 'math',
    matcher: /(mathe|analysis|algebra|stochastik|ableitung|integral|gleichung|matrix|vektor|wahrscheinlichkeit)/i,
    tips: {
      concept: 'Skizziere zuerst, welches mathematische Prinzip gilt, und erst dann den Rechenweg.',
      formula_mixup: 'Notiere die Zielgröße und die passende Formel mit Variablenbelegung vor dem Einsetzen.',
      careless: 'Führe am Ende einen Vorzeichen- und Einheitencheck in 10 Sekunden durch.',
      definition_gap: 'Schreibe die Definition des zentralen Begriffs (z. B. Grenzwert, Unabhängigkeit) in 1 Satz auf.',
      calculation: 'Teile die Rechnung in nummerierte Zwischenschritte und verifiziere jeden Schritt kurz.',
      unknown: 'Arbeite von gegebener Größe -> gesuchte Größe und streiche unpassende Optionen systematisch.',
    },
  },
  {
    key: 'programming',
    matcher: /(programmierung|algorithm|datenstruktur|runtime|komplexitaet|javascript|typescript|java|python|sql|api)/i,
    tips: {
      concept: 'Bestimme zuerst das zugrunde liegende Konzept (z. B. Laufzeit, Datenfluss, Zustandsänderung).',
      formula_mixup: 'Lege fest, ob die Frage auf Syntax, Semantik oder Architektur zielt und mappe die Option darauf.',
      careless: 'Prüfe Grenzfälle (null/empty/off-by-one) kurz gegen die ausgewählte Antwort.',
      definition_gap: 'Formuliere den Fachbegriff (z. B. idempotent, immutable, ACID) in eigenen Worten vor der Wahl.',
      calculation: 'Simuliere den Ablauf mit einem Mini-Beispiel und vergleiche erst dann die Optionen.',
      unknown: 'Nutze Input -> Verarbeitung -> Output als Checkliste für die richtige Option.',
    },
  },
];

const normalizeErrorType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (Object.prototype.hasOwnProperty.call(ERROR_TYPE_LABELS, normalized)) {
    return normalized;
  }
  return 'unknown';
};

const inferAnswerErrorType = (question) => {
  const blob = [question?.question, question?.topic, question?.explanation]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(kettenregel|produktregel|quotientenregel|regel|formel|ableitung|integral|satz)/.test(blob)) {
    return 'formula_mixup';
  }
  if (/(rechnen|rechnung|berechnen|gleichung|matrix|vektor|term|umformen|arithmetik|zahl)/.test(blob)) {
    return 'calculation';
  }
  if (/(definition|begriff|terminus|fakt|vokabel|auswendig)/.test(blob)) {
    return 'definition_gap';
  }
  if (/(konzept|prinzip|warum|beweis|theorie|logik|modell|zusammenhang|abstrakt)/.test(blob)) {
    return 'concept';
  }
  return 'careless';
};

const getTopicSpecificHint = (errorType, topic, contextText) => {
  const blob = `${String(topic || '')} ${String(contextText || '')}`;
  const strategy = TOPIC_SPECIFIC_HINTS.find((entry) => entry.matcher.test(blob));
  if (!strategy) return '';

  const normalizedType = normalizeErrorType(errorType);
  return strategy.tips[normalizedType] || strategy.tips.unknown || '';
};

const getRuleBasedActionTip = (errorType, topic, contextText = '') => {
  const safeTopic = String(topic || 'diesem Thema').trim() || 'diesem Thema';
  const topicSpecific = getTopicSpecificHint(errorType, topic, contextText);
  if (topicSpecific) {
    return `Bei ${safeTopic}: ${topicSpecific}`;
  }

  switch (normalizeErrorType(errorType)) {
    case 'formula_mixup':
      return `Schreibe bei ${safeTopic} die verwendete Regel vor dem Rechnen als ersten Schritt aus.`;
    case 'calculation':
      return `Rechne bei ${safeTopic} den kritischen Zwischenschritt separat und prüfe Einheiten/Vorzeichen.`;
    case 'definition_gap':
      return `Formuliere bei ${safeTopic} die Kern-Definition in einem Satz, bevor du die Antwort wählst.`;
    case 'concept':
      return `Skizziere bei ${safeTopic} kurz Ursache-Wirkung in 2 Stichpunkten, dann entscheide dich.`;
    case 'careless':
      return `Nutze bei ${safeTopic} eine 10-Sekunden-Endkontrolle auf Vorzeichen, Fragestellung und Antwortoption.`;
    default:
      return '';
  }
};

const buildActionTipWithOptionalLlm = async (errorType, topic, contextText = '') => {
  const ruleBasedTip = getRuleBasedActionTip(errorType, topic, contextText);
  if (ruleBasedTip) return ruleBasedTip;

  if (!REPEATED_HINT_LLM_FALLBACK_ENABLED || !process.env.OPENAI_API_KEY) {
    return `Notiere bei ${topic || 'diesem Thema'} zuerst den nächsten konkreten Lösungsschritt und prüfe ihn vor der Antwort.`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Erzeuge genau einen kurzen, konkreten Lerntipp (1 Satz) auf Deutsch. Kein Markdown.',
        },
        {
          role: 'user',
          content: `Fehlertyp: ${errorType}; Thema: ${topic}; Kontext: ${contextText || 'kein zusätzlicher Kontext'}; Gib eine direkte, sofort umsetzbare Aktion.`,
        },
      ],
    });

    const tip = String(completion.choices?.[0]?.message?.content || '').trim();
    if (tip) return tip;
  } catch (error) {
    console.error('LLM fallback for repeated error hint failed:', error.message);
  }

  return `Notiere bei ${topic || 'diesem Thema'} zuerst den nächsten konkreten Lösungsschritt und prüfe ihn vor der Antwort.`;
};

const buildRepeatedErrorHintMap = async ({ userId, subjectId }) => {
  if (!userId || !subjectId) return new Map();

  const rows = await UserAnswer.getRecentRelevantAnswersByUserAndSubject(userId, subjectId, 5);
  if (!rows || rows.length === 0) return new Map();

  const grouped = new Map();
  for (const row of rows) {
    const topic = String(row.topic || '').trim();
    if (!topic) continue;

    const key = topic.toLowerCase();
    const errorType = normalizeErrorType(row.error_type);

    if (!grouped.has(key)) {
      grouped.set(key, { topic, counts: {}, contextSnippets: [] });
    }
    const entry = grouped.get(key);
    entry.counts[errorType] = (entry.counts[errorType] || 0) + 1;

    const snippet = [row.question_text, row.question_explanation]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (snippet) {
      entry.contextSnippets.push(snippet);
    }
  }

  const hints = new Map();
  for (const [key, value] of grouped.entries()) {
    const entries = Object.entries(value.counts);
    if (entries.length === 0) continue;

    let best = entries[0];
    for (const item of entries) {
      if (item[1] > best[1]) best = item;
    }

    const [errorType, count] = best;
    if (count < 3) continue;

    const contextText = (value.contextSnippets || []).slice(0, 2).join(' ');
    const actionTip = await buildActionTipWithOptionalLlm(errorType, value.topic, contextText);
    const errorTypeLabel = ERROR_TYPE_LABELS[errorType] || ERROR_TYPE_LABELS.unknown;
    const message = `⚠️ Achtung: Du hast ${errorTypeLabel} bereits ${count}-mal bei ${value.topic} gemacht. Tipp: ${actionTip}`;

    hints.set(key, {
      error_type: errorType,
      error_type_label: errorTypeLabel,
      topic: value.topic,
      count,
      action_tip: actionTip,
      message,
    });
  }

  return hints;
};

const attachRepeatedErrorHintsToQuestions = async ({ questions, userId, subjectId }) => {
  const hintMap = await buildRepeatedErrorHintMap({ userId, subjectId });
  if (hintMap.size === 0) return questions;

  return questions.map((question) => {
    const topicKey = String(question.topic || '').trim().toLowerCase();
    if (!topicKey || !hintMap.has(topicKey)) {
      return { ...question, repeatedErrorHint: null };
    }

    return {
      ...question,
      repeatedErrorHint: hintMap.get(topicKey),
    };
  });
};

const classifyTempoScore = (responseTimes) => {
  if (!Array.isArray(responseTimes) || responseTimes.length < 3) {
    return {
      tempo_score: 'medium',
      average_response_time_ms: null,
      sample_size: Array.isArray(responseTimes) ? responseTimes.length : 0,
    };
  }

  const sum = responseTimes.reduce((acc, value) => acc + Number(value || 0), 0);
  const avg = Math.round(sum / responseTimes.length);

  if (avg <= 25000) {
    return { tempo_score: 'fast', average_response_time_ms: avg, sample_size: responseTimes.length };
  }
  if (avg >= 50000) {
    return { tempo_score: 'slow', average_response_time_ms: avg, sample_size: responseTimes.length };
  }
  return { tempo_score: 'medium', average_response_time_ms: avg, sample_size: responseTimes.length };
};

const classifyTopicHeuristic = (topic) => {
  const normalized = String(topic || '').toLowerCase();

  if (/(beweis|formal|logik|axiom|abstrakt|theorie|herleitung)/.test(normalized)) {
    return { abstraction: 'abstract', error_type: 'conceptual' };
  }

  if (/(anwendung|beispiel|praxis|rechnung|rechen|aufgabe|schritt)/.test(normalized)) {
    return { abstraction: 'concrete', error_type: 'procedural' };
  }

  if (/(definition|merk|vokabel|fakt|wissen|begriff)/.test(normalized)) {
    return { abstraction: 'medium', error_type: 'memory' };
  }

  return { abstraction: 'medium', error_type: 'mixed' };
};

const resolveAbstractionScore = (counts) => {
  const abstractCount = Number(counts.abstract || 0);
  const concreteCount = Number(counts.concrete || 0);

  if (abstractCount >= concreteCount + 2) return 'abstract';
  if (concreteCount >= abstractCount + 2) return 'concrete';
  return 'medium';
};

const mergeTopicClassifications = (baseMap, llmClassifications) => {
  const merged = { ...baseMap };
  for (const item of llmClassifications) {
    if (!item || !item.topic || !merged[item.topic]) continue;

    const abstraction = ['concrete', 'medium', 'abstract'].includes(item.abstraction)
      ? item.abstraction
      : merged[item.topic].abstraction;

    const errorType = ['conceptual', 'procedural', 'memory', 'mixed'].includes(item.error_type)
      ? item.error_type
      : merged[item.topic].error_type;

    merged[item.topic] = {
      abstraction,
      error_type: errorType,
    };
  }
  return merged;
};

const classifyTopicsWithLlm = async (topics) => {
  if (!COGNITIVE_LLM_ENABLED || !process.env.OPENAI_API_KEY) return [];
  if (!Array.isArray(topics) || topics.length === 0) return [];

  const limited = topics.slice(0, 12);
  const systemPrompt = [
    'Du klassifizierst Fehlerthemen für ein Lernprofil.',
    'Gib ausschliesslich JSON als Array zurueck.',
    'Format pro Element: {"topic":"...","abstraction":"concrete|medium|abstract","error_type":"conceptual|procedural|memory|mixed"}.',
  ].join(' ');

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Themen: ${JSON.stringify(limited)}` },
      ],
    });

    const responseText = completion.choices?.[0]?.message?.content?.trim() || '[]';
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Cognitive profile LLM classification fallback to heuristics:', error.message);
    return [];
  }
};

const buildCognitiveProfileForUser = async (userId) => {
  const [responseRows, wrongTopicRows] = await Promise.all([
    UserAnswer.getRecentResponseTimesByUser(userId, 240),
    UserAnswer.getRecentWrongTopicsByUser(userId, 120),
  ]);

  const responseTimes = responseRows.map((row) => Number(row.response_time_ms)).filter((value) => value > 0);
  const tempo = classifyTempoScore(responseTimes);

  const topicCounts = {};
  for (const row of wrongTopicRows) {
    const topic = String(row.topic || '').trim();
    if (!topic) continue;
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }

  const perTopicClassifications = {};
  const uncertainTopics = [];
  for (const topic of Object.keys(topicCounts)) {
    const heuristic = classifyTopicHeuristic(topic);
    perTopicClassifications[topic] = heuristic;
    if (heuristic.abstraction === 'medium' || heuristic.error_type === 'mixed') {
      uncertainTopics.push(topic);
    }
  }

  const llmClassifications = await classifyTopicsWithLlm(uncertainTopics);
  const mergedClassifications = mergeTopicClassifications(perTopicClassifications, llmClassifications);

  const abstractionCounts = { concrete: 0, medium: 0, abstract: 0 };
  const errorTypeCounts = { conceptual: 0, procedural: 0, memory: 0, mixed: 0 };

  for (const [topic, count] of Object.entries(topicCounts)) {
    const classified = mergedClassifications[topic] || { abstraction: 'medium', error_type: 'mixed' };
    abstractionCounts[classified.abstraction] += count;
    errorTypeCounts[classified.error_type] += count;
  }

  const abstraction_score = resolveAbstractionScore(abstractionCounts);

  return {
    tempo_score: tempo.tempo_score,
    abstraction_score,
    error_pattern_bias: {
      by_topic: topicCounts,
      by_error_type: errorTypeCounts,
      sample_size: wrongTopicRows.length,
      avg_response_time_ms: tempo.average_response_time_ms,
      response_time_samples: tempo.sample_size,
      llm_assisted: llmClassifications.length > 0,
    },
  };
};

const buildCognitiveProfileExplanations = (profile) => {
  const tempoText = profile.tempo_score === 'slow'
    ? 'Antwortzeiten liegen über dem Referenzbereich.'
    : profile.tempo_score === 'fast'
      ? 'Antwortzeiten liegen unter dem Referenzbereich.'
      : 'Antwortzeiten liegen im mittleren Referenzbereich.';

  const abstractionText = profile.abstraction_score === 'abstract'
    ? 'Fehler häuften sich in abstrakten/formalen Themen.'
    : profile.abstraction_score === 'concrete'
    ? 'Fehler häuften sich in anwendungsnahen, konkreten Themen.'
      : 'Fehler verteilen sich ausgeglichen auf verschiedene Abstraktionsniveaus.';

  return {
    tempo: tempoText,
    abstraction: abstractionText,
  };
};

const resolveCognitiveConfidence = ({ sessionCount, responseSamples, wrongTopicSamples }) => {
  const cappedSessions = clamp(Number(sessionCount || 0), 0, 12);
  const cappedResponses = clamp(Number(responseSamples || 0), 0, 160);
  const cappedWrongTopics = clamp(Number(wrongTopicSamples || 0), 0, 60);

  const score = Math.round((
    (cappedSessions / 12) * 45 +
    (cappedResponses / 160) * 35 +
    (cappedWrongTopics / 60) * 20
  ));

  let confidenceClass = 'low';
  if (score >= 70) confidenceClass = 'high';
  else if (score >= 40) confidenceClass = 'medium';

  const reasons = [
    `Bewertete Sessions: ${sessionCount}`,
    `Antwortzeit-Samples: ${responseSamples}`,
    `Fehler-Themensamples: ${wrongTopicSamples}`,
  ];

  return {
    class: confidenceClass,
    score,
    reasons,
  };
};

const HOUR_TEMPLATES = {
  one_day: {
    1: { min: 14, max: 20 },
    2: { min: 10, max: 15 },
    3: { min: 6, max: 10 },
    4: { min: 3, max: 6 },
    5: { min: 1, max: 3 },
  },
  balanced: {
    1: { min: 24, max: 36 },
    2: { min: 16, max: 25 },
    3: { min: 10, max: 16 },
    4: { min: 5, max: 10 },
    5: { min: 2, max: 5 },
  },
  deep: {
    1: { min: 45, max: 65 },
    2: { min: 32, max: 48 },
    3: { min: 20, max: 32 },
    4: { min: 10, max: 20 },
    5: { min: 4, max: 10 },
  },
};

const ABSTRACT_NOTE_KEYWORDS = [
  'beweis',
  'formale logik',
  'formal',
  'axiom',
  'theorem',
  'abstrakt',
  'komplex',
  'herleitung',
  'modellbildung',
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeSubjectClassification = (difficulty) => {
  const value = String(difficulty || '').toLowerCase();

  if (value.includes('1day') || value.includes('one') || value.includes('leicht') || value.includes('easy')) {
    return 'one_day';
  }

  if (value.includes('deep') || value.includes('konzept') || value.includes('hard') || value.includes('schwer')) {
    return 'deep';
  }

  return 'balanced';
};

const toEffortTemplateClassification = (classification) => {
  if (classification === '1day') return 'one_day';
  if (classification === 'deep') return 'deep';
  return 'balanced';
};

const roundTo2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const hasAbstractSignals = (subject) => {
  const difficulty = String(subject?.difficulty || '').toLowerCase();
  const notes = String(subject?.exam_notes || '').toLowerCase();

  const difficultyAbstract = difficulty === 'killer' || difficulty === 'high';
  const keywordHits = ABSTRACT_NOTE_KEYWORDS.filter((keyword) => notes.includes(keyword));

  return {
    isAbstract: difficultyAbstract || keywordHits.length > 0,
    keywordHits,
    difficultySignal: difficulty,
  };
};

const getSubjectTopicBreadth = async (subjectId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS topic_count
     FROM (
       SELECT LOWER(TRIM(topic)) AS topic
       FROM assessment_questions
       WHERE subject_id = $1
         AND topic IS NOT NULL
         AND TRIM(topic) <> ''
       UNION
       SELECT LOWER(TRIM(topic)) AS topic
       FROM error_patterns
       WHERE subject_id = $1
         AND topic IS NOT NULL
         AND TRIM(topic) <> ''
     ) topic_union`,
    [subjectId]
  );

  return Number(result.rows?.[0]?.topic_count || 0);
};

const getAverageErrorCount = async (subjectId) => {
  const result = await pool.query(
    `SELECT
       COALESCE(AVG(error_count), 0)::numeric AS avg_error_count,
       COUNT(*)::int AS rows_count
     FROM error_patterns
     WHERE subject_id = $1`,
    [subjectId]
  );

  return {
    avgErrorCount: roundTo2(result.rows?.[0]?.avg_error_count || 0),
    rowsCount: Number(result.rows?.[0]?.rows_count || 0),
  };
};

const buildClassificationFactors = ({
  topicBreadth,
  avgErrorCount,
  abstraction,
  classification,
}) => {
  const breadthContribution = topicBreadth <= 5 ? -30 : 35;
  const errorContribution = avgErrorCount <= 2 ? -30 : 35;
  const abstractionContribution = abstraction.isAbstract ? 35 : -30;

  return [
    {
      name: 'Themenbreite',
      value: topicBreadth,
      contribution: breadthContribution,
      rationale: topicBreadth <= 5
        ? 'Wenige verschiedene Themen sprechen für eine schnellere Lernbarkeit.'
        : 'Viele verschiedene Themen erhöhen den Lernaufwand.',
    },
    {
      name: 'Fehlerrate',
      value: avgErrorCount,
      contribution: errorContribution,
      rationale: avgErrorCount <= 2
        ? 'Eine niedrige durchschnittliche Fehlerhäufigkeit ist positiv für 1day.'
        : 'Eine hohe durchschnittliche Fehlerhäufigkeit spricht für deep.',
    },
    {
      name: 'Abstraktionsgrad',
      value: abstraction.isAbstract ? 1 : 0,
      contribution: abstractionContribution,
      rationale: abstraction.isAbstract
        ? `Abstrakt-Signal erkannt (${[abstraction.difficultySignal, ...abstraction.keywordHits].filter(Boolean).join(', ') || 'exam_notes'}).`
        : 'Keine starken formalen/abstrakten Signale erkannt.',
    },
    {
      name: 'Klassifizierungsregel',
      value: classification,
      contribution: classification === '1day' ? -100 : 100,
      rationale: 'Regel: 1day nur bei Themenbreite <= 5 UND Fehlerrate <= 2 UND nicht abstrakt.',
    },
  ];
};

const classifySubject = async (subjectId, subject) => {
  const [topicBreadth, errorStats] = await Promise.all([
    getSubjectTopicBreadth(subjectId),
    getAverageErrorCount(subjectId),
  ]);

  const abstraction = hasAbstractSignals(subject);
  const isOneDay = topicBreadth <= 5 && errorStats.avgErrorCount <= 2 && !abstraction.isAbstract;
  const classification = isOneDay ? '1day' : 'deep';

  return {
    classification,
    factors: buildClassificationFactors({
      topicBreadth,
      avgErrorCount: errorStats.avgErrorCount,
      abstraction,
      classification,
    }),
    metrics: {
      topic_breadth: topicBreadth,
      avg_error_count: errorStats.avgErrorCount,
      abstract_signal: abstraction.isAbstract,
    },
  };
};

const inferLecturerDifficultyFactor = (subject) => {
  const notes = String(subject.exam_notes || '').toLowerCase();
  const difficulty = String(subject.difficulty || '').toLowerCase();

  if (
    notes.includes('sehr schwer') ||
    notes.includes('anspruchsvoll') ||
    notes.includes('tricky') ||
    difficulty.includes('hard') ||
    difficulty.includes('schwer')
  ) {
    return 1.18;
  }

  if (
    notes.includes('einfach') ||
    notes.includes('fair') ||
    notes.includes('leicht') ||
    difficulty.includes('easy')
  ) {
    return 0.9;
  }

  return 1;
};

const averageScorePct = (sessions) => {
  if (!sessions || sessions.length === 0) return null;
  const total = sessions.reduce((sum, session) => sum + Number(session.score_pct || 0), 0);
  return total / sessions.length;
};

const buildGradeHistogram = (sessions) => {
  const counts = [0, 0, 0, 0, 0];
  for (const session of sessions) {
    const grade = Number(session.grade_prognosis) || calculateGradeFromPct(Number(session.score_pct || 0));
    const idx = clamp(grade, 1, 5) - 1;
    counts[idx] += 1;
  }
  return counts;
};

const gaussian = (distance, bandwidth) => Math.exp(-0.5 * (distance / bandwidth) ** 2);

const smoothHistogram = (counts, bandwidth) => {
  return GRADE_BUCKETS.map((grade) => {
    let value = 0;
    for (let k = 0; k < counts.length; k += 1) {
      const sourceGrade = k + 1;
      value += counts[k] * gaussian(grade - sourceGrade, bandwidth);
    }
    return value;
  });
};

const buildPriorDistribution = (expectedGrade) => {
  const sigma = 1.15;
  return GRADE_BUCKETS.map((grade) => Math.exp(-0.5 * ((grade - expectedGrade) / sigma) ** 2));
};

const normalizeDistribution = (values) => {
  const sum = values.reduce((acc, current) => acc + current, 0);
  if (sum <= 0) return values.map(() => 1 / values.length);
  return values.map((value) => value / sum);
};

const toPercentWithLargestRemainder = (distribution) => {
  const raw = distribution.map((p) => p * 100);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = 100 - floored.reduce((sum, value) => sum + value, 0);

  const orderedRemainders = raw
    .map((value, index) => ({ index, remainder: value - floored[index] }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.index - b.index;
    });

  for (let i = 0; i < orderedRemainders.length && remainder > 0; i += 1) {
    floored[orderedRemainders[i].index] += 1;
    remainder -= 1;
  }

  return floored;
};

const inferExpectedGrade = (avgScore, classification, lecturerFactor) => {
  if (avgScore !== null) {
    return calculateGradeFromPct(avgScore);
  }

  const classificationBase = classification === 'deep'
    ? 3.6
    : classification === 'one_day'
      ? 2.5
      : 3.1;
  return clamp(classificationBase + (lecturerFactor - 1) * 1.2, 1, 5);
};

const resolveConfidenceClass = (historyCount, gradeSupport) => {
  if (historyCount >= 10 && gradeSupport >= 3) return 'high';
  if (historyCount >= 4 && gradeSupport >= 1.5) return 'medium';
  return 'low';
};

const deriveHourRange = (classification, grade, hourFactor) => {
  const template = HOUR_TEMPLATES[classification][grade];
  const hoursMin = Math.max(1, Math.round(template.min * hourFactor));
  const hoursMax = Math.max(hoursMin + 1, Math.round(template.max * hourFactor));

  return {
    hours_min: hoursMin,
    hours_max: hoursMax,
  };
};

const buildEffortProbabilityResults = (subject, sessions, options = {}) => {
  const historyCount = sessions.length;
  const derivedClassification = options.classification || null;
  const effortClassification = derivedClassification
    ? toEffortTemplateClassification(derivedClassification)
    : normalizeSubjectClassification(subject.difficulty);
  const lecturerFactor = inferLecturerDifficultyFactor(subject);
  const avgScore = averageScorePct(sessions);
  const tempoScore = options.tempo_score || 'medium';

  const tempoFactor = tempoScore === 'slow' ? 1.2 : tempoScore === 'fast' ? 0.9 : 1;

  const performanceFactor = avgScore === null
    ? 1
    : clamp(1 + (70 - avgScore) / 200, 0.82, 1.28);

  const hourFactor = clamp(lecturerFactor * performanceFactor * tempoFactor, 0.75, 1.65);
  const expectedGrade = inferExpectedGrade(avgScore, effortClassification, lecturerFactor);
  const prior = normalizeDistribution(buildPriorDistribution(expectedGrade));

  const counts = buildGradeHistogram(sessions);
  const supportByGrade = counts.map((_, idx) => {
    const left = idx > 0 ? counts[idx - 1] : 0;
    const right = idx < counts.length - 1 ? counts[idx + 1] : 0;
    return counts[idx] + 0.5 * (left + right);
  });

  let combinedDistribution = prior;
  if (historyCount > 0) {
    const smoothed = normalizeDistribution(smoothHistogram(counts, GAUSSIAN_BANDWIDTH));
    const historyWeight = clamp(0.35 + historyCount * 0.08, 0.35, 0.85);
    const priorWeight = 1 - historyWeight;
    combinedDistribution = normalizeDistribution(
      smoothed.map((value, idx) => value * historyWeight + prior[idx] * priorWeight)
    );
  }

  const probabilityPercents = toPercentWithLargestRemainder(combinedDistribution);

  const results = GRADE_BUCKETS.map((grade, idx) => {
    const confidenceClass = resolveConfidenceClass(historyCount, supportByGrade[idx]);
    return {
      grade,
      ...deriveHourRange(effortClassification, grade, hourFactor),
      probability_percent: probabilityPercents[idx],
      confidence_class: confidenceClass,
    };
  });

  return {
    history_count: historyCount,
    classification: derivedClassification || (effortClassification === 'one_day' ? '1day' : 'deep'),
    tempo_adjustment_factor: Number(tempoFactor.toFixed(2)),
    applied_tempo_score: tempoScore,
    results,
  };
};

exports.getSubjectClassificationInsight = async (subjectId, subject = null) => {
  const resolvedSubject = subject || await Subject.findById(subjectId);
  if (!resolvedSubject) {
    return null;
  }

  return classifySubject(subjectId, resolvedSubject);
};

const buildDefaultPostExamCatalog = (subject, weakTopics = []) => {
  const topWeakTopics = weakTopics.slice(0, 3);
  const fallbackTopics = topWeakTopics.length > 0
    ? topWeakTopics
    : ['Grundlagen', 'Anwendungsaufgaben', 'Transferfragen'];

  return [
    {
      topic: fallbackTopics[0] || 'Grundlagen',
      question_text: 'Welche Kernaufgabe zu diesem Thema kam in der Klausur vor?',
      expected_answer: 'Kurz benennen, welchen Aufgabentyp und welche Loesungslogik du angewendet hast.',
      source: 'standard'
    },
    {
      topic: fallbackTopics[1] || 'Anwendungsaufgaben',
      question_text: 'An welcher Stelle warst du bei der Bearbeitung unsicher?',
      expected_answer: 'Notiere den konkreten Schritt (z. B. Formelwahl, Interpretation, Schlussfolgerung).',
      source: 'standard'
    },
    {
      topic: fallbackTopics[2] || 'Transferfragen',
      question_text: 'Welche typische Falle oder Verwechslung ist bei diesem Thema moeglich?',
      expected_answer: 'Benenne einen Fehler und wie du ihn beim nächsten Mal vermeidest.',
      source: 'standard'
    },
    {
      topic: subject.name,
      question_text: 'Welche 2 Themen waren am ehesten klausurrelevant, gemessen an der echten Klausur?',
      expected_answer: 'Nenne zwei Themen mit kurzer Begruendung, warum sie besonders wichtig waren.',
      source: 'standard'
    }
  ];
};

const sanitizeCatalogItem = (item, fallbackSource = 'ai') => ({
  topic: String(item.topic || 'Allgemein').trim().slice(0, 255),
  question_text: String(item.question_text || '').trim(),
  expected_answer: String(item.expected_answer || '').trim(),
  source: item.source === 'standard' ? 'standard' : fallbackSource
});

const findCachedPostExamCatalog = async (subjectId) => {
  const result = await pool.query(
    `SELECT items
     FROM post_exam_catalog_cache
     WHERE subject_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 1`,
    [subjectId]
  );
  return result.rows[0] || null;
};

const storePostExamCatalog = async (subjectId, items) => {
  await pool.query(
    `INSERT INTO post_exam_catalog_cache (id, subject_id, items)
     VALUES ($1, $2, $3)`,
    [generateId(), subjectId, JSON.stringify(items)]
  );
};

const FLASHCARD_AI_COUNT = 20;
const GUIDED_FLASHCARD_AI_COUNT = 8;
const FLASHCARD_RATING_QUALITY = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

const sanitizeFlashcard = (item, fallbackSource = 'manual') => {
  const source = item.source === 'ai' ? 'ai' : fallbackSource;
  return {
    term: String(item.term || '').trim().slice(0, 500),
    answer: String(item.answer || '').trim().slice(0, 2000),
    hint: item.hint ? String(item.hint).trim().slice(0, 1000) : null,
    topic: item.topic ? String(item.topic).trim().slice(0, 255) : null,
    source,
  };
};

const buildFlashcardPrompt = (subject, activeLearningStyle) => {
  let prompt = `Du bist ein Lerncoach und erstellst Karteikarten für Prüfungsvorbereitung. Erstelle exakt ${FLASHCARD_AI_COUNT} Karteikarten als valides JSON-Array ohne Markdown.`;
  prompt += '\nJede Karte muss die Felder term, answer, hint, topic enthalten.';
  prompt += '\nterm ist kurz und präzise. answer ist konkret und korrekt. hint ist ein kurzer Lernhinweis.';
  prompt += '\nVermeide Duplikate und formuliere auf Deutsch.';
  prompt += `\n\n${getLearningStylePromptBlock(activeLearningStyle)}`;

  if (subject.exam_notes) {
    prompt += `\n\nPrüfungsstil-Hinweise: ${subject.exam_notes}`;
  }

  prompt += '\n\nFormat:\n[\n  {\n    "term": "...",\n    "answer": "...",\n    "hint": "...",\n    "topic": "..."\n  }\n]';
  return prompt;
};

const buildGuidedFlashcardPrompt = ({ subject, activeLearningStyle, step, guidedStepContext }) => {
  let prompt = `Du bist ein Lerncoach und erstellst Karteikarten für einen Guided-Learning-Schritt. Erstelle exakt ${GUIDED_FLASHCARD_AI_COUNT} Karteikarten als valides JSON-Array ohne Markdown.`;
  prompt += '\nDie Karten sollen genau auf den angegebenen Schritt fokussieren, motivierend formuliert sein und die Nutzer langsam in den Stoff hineinführen.';
  prompt += '\nJede Karte muss die Felder term, answer, hint, topic enthalten.';
  prompt += '\nterm ist kurz und präzise. answer ist konkret und korrekt. hint ist ein kurzer Lernhinweis.';
  prompt += `\n\nGuided-Step: ${guidedStepContext.step}. Phase: ${guidedStepContext.phase}. Titel: ${guidedStepContext.title}.`;
  prompt += `\nWichtige Themen für diesen Schritt: ${guidedStepContext.linked_topics.join(', ') || 'keine'}.`;
  prompt += `\nAktion des Schritts: ${guidedStepContext.action}`;
  prompt += '\nErzeuge eher Definitionen, Mini-Beispiele und kleine Transferfragen als reine Faktenwiederholung.';
  prompt += '\nVermeide Duplikate und formuliere auf Deutsch.';
  prompt += `\n\n${getLearningStylePromptBlock(activeLearningStyle)}`;

  if (subject.exam_notes) {
    prompt += `\n\nPrüfungsstil-Hinweise: ${subject.exam_notes}`;
  }

  prompt += `\n\nFormat:\n[\n  {\n    "term": "...",\n    "answer": "...",\n    "hint": "...",\n    "topic": "..."\n  }\n]`;
  return prompt;
};

const applySpacedRepetition = (card, rating) => {
  const quality = FLASHCARD_RATING_QUALITY[rating];
  const currentRepetition = Number(card.repetition || 0);
  const currentInterval = Number(card.interval_days || 0);
  const currentEase = Number(card.ease_factor || 2.5);

  let repetition = currentRepetition;
  let intervalDays = currentInterval;
  let easeFactor = currentEase;

  if (quality < 3) {
    repetition = 0;
    intervalDays = 1;
  } else {
    repetition += 1;

    if (repetition === 1) {
      intervalDays = 1;
    } else if (repetition === 2) {
      intervalDays = 3;
    } else {
      intervalDays = Math.max(1, Math.round(currentInterval * currentEase));
    }

    if (rating === 'hard') {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    }

    if (rating === 'easy') {
      intervalDays = Math.max(1, Math.round(intervalDays * 1.3));
    }
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = Math.max(1.3, Math.min(3, easeFactor));

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + intervalDays);

  return {
    repetition,
    interval_days: intervalDays,
    ease_factor: Number(easeFactor.toFixed(2)),
    due_at: dueAt,
    last_reviewed_at: new Date(),
  };
};

const buildAiCatalogPrompt = (subject, weakTopics, activeLearningStyle) => {
  let prompt = `Du bist ein Lerncoach für eine Post-Klausur-Analyse. Antworte immer auf Deutsch. Erstelle genau 4 zusätzliche Re-Check-Fragen als JSON-Array.`;
  prompt += `\n\nZiel: Fragen sollen konkret, kurz und nachbearbeitbar sein. Jede Frage muss topic, question_text, expected_answer enthalten.`;
  prompt += `\n\n${getLearningStylePromptBlock(activeLearningStyle)}`;

  if (subject.exam_notes) {
    prompt += `\n\nPrüfungsstil-Hinweise: ${subject.exam_notes}`;
  }

  if (weakTopics.length > 0) {
    prompt += `\n\nSchwachstellen-Themen priorisieren: ${weakTopics.join(', ')}`;
  }

  prompt += `\n\nFormat:\n[\n  {\n    "topic": "...",\n    "question_text": "...",\n    "expected_answer": "..."\n  }\n]`;
  return prompt;
};

// @desc    Get global learning profile
// @route   GET /api/assessment/learning-profile
// @access  Public
exports.getLearningProfile = async (req, res) => {
  try {
    const profile = await LearningProfile.getGlobal();
    res.status(200).json({
      success: true,
      data: {
        style: profile.style,
        onboarding_completed: profile.onboarding_completed
      }
    });
  } catch (error) {
    console.error('Error loading learning profile:', error);
    res.status(500).json({ success: false, error: 'Failed to load learning profile' });
  }
};

// @desc    Update global learning profile
// @route   PUT /api/assessment/learning-profile
// @access  Public
exports.updateLearningProfile = async (req, res) => {
  try {
    const { style, onboarding_completed } = req.body;
    const normalizedStyle = normalizeLearningStyle(style);

    const updated = await LearningProfile.updateGlobal({
      style: normalizedStyle,
      onboarding_completed: onboarding_completed ?? true
    });

    res.status(200).json({
      success: true,
      data: {
        style: updated.style,
        onboarding_completed: updated.onboarding_completed
      }
    });
  } catch (error) {
    console.error('Error updating learning profile:', error);
    res.status(500).json({ success: false, error: 'Failed to update learning profile' });
  }
};

// @desc    Generate assessment questions for a subject
// @route   GET /api/assessment/generate/:subjectId
// @access  Public
exports.generateQuestions = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.session.userId;
    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    // Check if subject exists and belongs to the user
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: 'Subject not found'
      });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Check if subject has documents
    const documents = await Subject.getDocuments(subjectId);
    if (!documents || documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Bitte lade zuerst Dokumente hoch'
      });
    }

    // Hybrid cache: manual questions are always valid; KI questions are valid for 24 h.
    // If there are fresh KI questions (or only manual ones), skip generation.
    const cachedQuestions = await AssessmentQuestion.findCachedBySubject(subjectId, userId);
    const cachedKI = cachedQuestions.filter(q => !q.is_manual);
    if (cachedKI.length > 0) {
      console.log(`Returning cached questions for subject ${subjectId}`);

      const cachedPayload = cachedQuestions.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        topic: q.topic,
        explanation: q.explanation,
        is_manual: q.is_manual
      }));

      const payloadWithHints = await attachRepeatedErrorHintsToQuestions({
        questions: cachedPayload,
        userId,
        subjectId,
      });

      return res.status(200).json({
        success: true,
        data: payloadWithHints,
        cached: true,
        applied_learning_style: activeLearningStyle
      });
    }

    // Merge content from all documents
    const mergedContent = documents.map(doc => doc.content).join('\n\n---\n\n');

    // Get error patterns for this subject (topics with error_count >= 2)
    const errorPatterns = await ErrorPattern.findBySubject(subjectId);
    const weakTopics = errorPatterns
      .filter(ep => ep.error_count >= 2)
      .map(ep => ep.topic);

    // Build the prompt
    let systemPrompt = `Du bist ein Prüfungsassistent. Generiere genau 5 Multiple-Choice-Fragen auf Basis des folgenden Dokumenteninhalts. Jede Frage hat exakt 4 Antwortmöglichkeiten (A, B, C, D), von denen exakt 1 korrekt ist. Antworte ausschließlich als valides JSON-Array ohne Markdown-Formatierung.`;

    if (weakTopics.length > 0) {
      systemPrompt += `\n\nFokussiere mindestens 2 Fragen auf folgende Schwachstellen-Themen: ${weakTopics.join(', ')}`;
    }

    if (subject.exam_notes) {
      systemPrompt += `\n\nZusätzliche Hinweise zum Prüfungsstil des Dozenten: ${subject.exam_notes}`;
    }

    const cognitiveProfile = userId ? await CognitiveProfile.getByUserId(userId) : null;
    if (cognitiveProfile) {
      systemPrompt += `\n\nKognitives Profil des Nutzers: Tempo=${cognitiveProfile.tempo_score}, Abstraktionsgrad=${cognitiveProfile.abstraction_score}.`;
      if (cognitiveProfile.tempo_score === 'slow') {
        systemPrompt += '\nNutze kurze Sätze, klare Zwischenschritte und konkrete Beispiele.';
      }
      if (cognitiveProfile.abstraction_score === 'concrete') {
        systemPrompt += '\nBevorzuge praxisnahe Fragestellungen gegenüber rein theoretischer Formulierung.';
      }
    }

    systemPrompt += `\n\n${getLearningStylePromptBlock(activeLearningStyle)}`;

    systemPrompt += `\n\nFormat:\n[\n  {\n    "question": "...",\n    "options": ["A: ...", "B: ...", "C: ...", "D: ..."],\n    "correct_index": 0,\n    "topic": "...",\n    "explanation": "..."\n  }\n]`;

    console.log('Generating questions with OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Kontext:\n${mergedContent.substring(0, 12000)}` } // Limit context to avoid token limits
      ],
      temperature: 0.7,
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log('OpenAI response received:', responseText.substring(0, 200));

    // Parse the response
    let questions;
    try {
      // Remove markdown code blocks if present
      const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      questions = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', parseError);
      return res.status(500).json({
        success: false,
        error: 'Failed to parse generated questions'
      });
    }

    // Validate questions
    if (!Array.isArray(questions) || questions.length !== 5) {
      return res.status(500).json({
        success: false,
        error: 'Invalid questions format from AI'
      });
    }

    // Store questions in database
    const questionsToStore = questions.map(q => ({
      subject_id: subjectId,
      user_id: userId,
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
      topic: q.topic,
      explanation: q.explanation
    }));

    const storedQuestions = await AssessmentQuestion.createMany(questionsToStore);
    console.log(`Stored ${storedQuestions.length} questions in database`);

    // Combine newly generated KI questions with existing manual questions
    const manualQuestions = cachedQuestions.filter(q => q.is_manual);
    const allQuestions = [...manualQuestions, ...storedQuestions];

    const questionPayload = allQuestions.map(q => ({
      id: q.id,
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
      topic: q.topic,
      explanation: q.explanation,
      is_manual: q.is_manual
    }));

    const payloadWithHints = await attachRepeatedErrorHintsToQuestions({
      questions: questionPayload,
      userId,
      subjectId,
    });

    res.status(200).json({
      success: true,
      data: payloadWithHints,
      cached: false,
      applied_learning_style: activeLearningStyle
    });
  } catch (error) {
    console.error('Error generating questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate questions',
      details: error.message
    });
  }
};

// @desc    Submit assessment answers
// @route   POST /api/assessment/submit
// @access  Public
exports.submitAssessment = async (req, res) => {
  try {
    const { subject_id, answers, total_duration_seconds } = req.body;
    const userId = req.session.userId;

    if (!subject_id || !answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: subject_id and answers array required'
      });
    }

    const subject = await Subject.findById(subject_id);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(userId)) {
      const subscription = await Subject.checkSubscription(subject.id, userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const durationSeconds = Number.isFinite(Number(total_duration_seconds))
      ? Math.max(0, Math.round(Number(total_duration_seconds)))
      : null;

    // Calculate score
    let correctCount = 0;
    const answerDetails = [];

    for (const answer of answers) {
      const question = await AssessmentQuestion.findById(answer.question_id);
      if (!question) continue;
      if (String(question.user_id) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const isCorrect = answer.selected_index === question.correct_index;
      if (isCorrect) correctCount++;

      const errorType = isCorrect ? null : inferAnswerErrorType(question);

      answerDetails.push({
        question_id: answer.question_id,
        selected_index: answer.selected_index,
        is_correct: isCorrect,
        topic: question.topic,
        error_type: errorType,
        response_time_ms: Number.isFinite(Number(answer.response_time_ms))
          ? Math.max(0, Math.round(Number(answer.response_time_ms)))
          : null,
      });

      // Update error patterns
      if (isCorrect) {
        await ErrorPattern.decrementError(subject_id, question.topic);
      } else {
        await ErrorPattern.incrementError(subject_id, question.topic);
      }
    }

    const total = answers.length;
    const score_pct = Math.round((correctCount / total) * 100);

    // Calculate grade prognosis (German grading system)
    const grade_prognosis = calculateGradeFromPct(score_pct);

    // Create session
    const session = await AssessmentSession.create({
      subject_id,
      user_id: String(userId),
      score: correctCount,
      total,
      score_pct,
      grade_prognosis,
      duration_seconds: durationSeconds,
    });

    // Store user answers
    const answersToStore = answerDetails.map(a => ({
      session_id: session.id,
      question_id: a.question_id,
      selected_index: a.selected_index,
      is_correct: a.is_correct,
      topic: a.topic,
      error_type: a.error_type,
      response_time_ms: a.response_time_ms,
    }));

    await UserAnswer.createMany(answersToStore);

    let cognitiveProfile = null;
    if (userId) {
      const computedProfile = await buildCognitiveProfileForUser(userId);
      cognitiveProfile = await CognitiveProfile.upsertByUserId(userId, computedProfile);
    }

    res.status(200).json({
      success: true,
      data: {
        session_id: session.id,
        score: correctCount,
        total,
        score_pct,
        grade_prognosis,
        answers: answerDetails,
        cognitive_profile: cognitiveProfile
          ? {
            tempo_score: cognitiveProfile.tempo_score,
            abstraction_score: cognitiveProfile.abstraction_score,
            error_pattern_bias: cognitiveProfile.error_pattern_bias,
            updated_at: cognitiveProfile.updated_at,
          }
          : null,
      }
    });
  } catch (error) {
    console.error('Error submitting assessment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit assessment',
      details: error.message
    });
  }
};

// @desc    Get assessment history for a subject
// @route   GET /api/assessment/history/:subjectId
// @access  Public
exports.getHistory = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const sessions = await AssessmentSession.findBySubject(subjectId, userId);

    res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    console.error('Error fetching assessment history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessment history'
    });
  }
};

// @desc    Get error patterns for a subject
// @route   GET /api/assessment/errors/:subjectId
// @access  Public
exports.getErrorPatterns = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const patterns = await ErrorPattern.findBySubject(subjectId);

    res.status(200).json({
      success: true,
      data: patterns
    });
  } catch (error) {
    console.error('Error fetching error patterns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error patterns'
    });
  }
};

// @desc    Get full session detail (with question texts and selected answers)
// @route   GET /api/assessment/session/:sessionId
// @access  Public
exports.getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await AssessmentSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    if (String(session.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const answers = await UserAnswer.findBySession(sessionId);

    const questionResults = [];
    for (const answer of answers) {
      const question = await AssessmentQuestion.findById(answer.question_id);
      if (!question) continue;
      questionResults.push({
        question: {
          id: question.id,
          question: question.question,
          options: question.options,
          correct_index: question.correct_index,
          topic: question.topic,
          explanation: question.explanation
        },
        selectedIndex: answer.selected_index,
        isCorrect: answer.is_correct
      });
    }

    res.status(200).json({
      success: true,
      data: {
        session,
        questionResults
      }
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
  }
};

// @desc    Get the latest assessment session for every subject
// @route   GET /api/assessment/latest-sessions
// @access  Public
exports.getLatestSessions = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const map = await AssessmentSession.findLatestForAllSubjects(userId);
    res.status(200).json({ success: true, data: map });
  } catch (error) {
    console.error('Error fetching latest sessions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch latest sessions' });
  }
};

// @desc    Generate a personalised learning plan for a subject
// @route   POST /api/assessment/learning-plan/:subjectId
// @access  Public
exports.generateLearningPlan = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { available_hours, target_grade } = req.body;
    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    if (!available_hours || typeof available_hours !== 'number' || available_hours <= 0) {
      return res.status(400).json({
        success: false,
        error: 'available_hours muss eine positive Zahl sein'
      });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Gather context: latest session + error patterns
    const [sessions, errorPatterns] = await Promise.all([
      AssessmentSession.findBySubject(subjectId, req.session.userId),
      ErrorPattern.findBySubject(subjectId)
    ]);

    const latestSession = sessions.length > 0 ? sessions[0] : null;

    // Build context block for the prompt
    let contextBlock = `Fachname: ${subject.name}`;
    if (subject.difficulty) contextBlock += `\nSchwierigkeitsgrad: ${subject.difficulty}`;
    if (subject.lecturer_name) contextBlock += `\nDozent: ${subject.lecturer_name}`;
    if (subject.exam_notes) contextBlock += `\nPrüfungshinweise: ${subject.exam_notes}`;

    if (latestSession) {
      contextBlock += `\n\nLetzter Teststand: ${latestSession.score_pct}% korrekt, Notenprognose: ${latestSession.grade_prognosis}`;
    } else {
      contextBlock += '\n\nBisher kein Einstufungstest durchgeführt. Erstelle einen allgemeinen Lernplan.';
    }

    if (errorPatterns.length > 0) {
      const sorted = [...errorPatterns].sort((a, b) => b.error_count - a.error_count);
      contextBlock += '\n\nFehlermuster (Topic => Fehleranzahl):\n';
      contextBlock += sorted.map(ep => `- ${ep.topic}: ${ep.error_count}x falsch`).join('\n');
    }

    const targetGradeText = target_grade ? `Ziel-Note: ${target_grade}` : 'Ziel: bestmögliche Note erreichen';

    const systemPrompt = `Du bist ein erfahrener Lerncoach. Erstelle einen konkreten, priorisierten Lernplan.\n\nRahmenbedingungen:\n- Verfügbare Lernzeit: ${available_hours} Stunden\n- ${targetGradeText}\n\n${getLearningStylePromptBlock(activeLearningStyle)}\n\nBeachte das deutsche Notensystem:\n- 90-100% → Note 1\n- 75-89% → Note 2\n- 60-74% → Note 3\n- 50-59% → Note 4\n- <50% → Note 5\n\nAntworte AUSSCHLIESSLICH als valides JSON-Objekt ohne Markdown-Formatierung:\n{\n  "achievable_grade": <number 1-5>,\n  "achievable_pct": <number 0-100>,\n  "topic_plan": [\n    {\n      "topic": "...",\n      "hours": <number>,\n      "priority": "high" | "medium" | "low",\n      "tip": "Ein konkreter Lerntipp für dieses Thema (1-2 Sätze)"\n    }\n  ],\n  "general_advice": "Allgemeiner Rat für diese Prüfung (2-3 Sätze)"\n}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextBlock }
      ],
      temperature: 0.5,
    });

    const responseText = completion.choices[0].message.content.trim();

    let plan;
    try {
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      plan = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse learning plan response:', parseError);
      return res.status(500).json({ success: false, error: 'Failed to parse learning plan' });
    }

    res.status(200).json({ success: true, data: { ...plan, applied_learning_style: activeLearningStyle } });
  } catch (error) {
    console.error('Error generating learning plan:', error);
    res.status(500).json({ success: false, error: 'Failed to generate learning plan', details: error.message });
  }
};

// @desc    Generate a guided learning route for a subject
// @route   GET /api/guided-learning/:subjectId
// @access  Public
exports.getGuidedLearningRoute = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const requestedDifficulty = String(req.query.forDifficulty || '').trim().toLowerCase();
    const userId = req.session.userId;
    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }

    if (String(subject.user_id) !== String(userId)) {
      const subscription = await Subject.checkSubscription(subject.id, userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const [documents, latestSession, errorPatterns, progress] = await Promise.all([
      Subject.getDocuments(subjectId),
      AssessmentSession.findLastBySubject(subjectId, userId),
      ErrorPattern.findBySubject(subjectId),
      GuidedLearningProgress.getByUserAndSubject(userId, subjectId),
    ]);

    const route = buildGuidedLearningRoute({
      subject,
      documents,
      latestSession,
      errorPatterns,
      activeLearningStyle,
    });

    const autoEnabled = requestedDifficulty === 'killer' || subject.difficulty === 'killer' || !subject.lecturer_name;
    const safeProgress = progress || {
      current_step: 1,
      completed_steps: [],
      is_completed: false,
      completed_at: null,
      last_accessed: null,
    };

    res.status(200).json({
      success: true,
      data: {
        subject_id: subjectId,
        auto_enabled: autoEnabled,
        requested_difficulty: requestedDifficulty || null,
        route,
        progress: safeProgress,
        resume_step: safeProgress.current_step || 1,
        applied_learning_style: activeLearningStyle,
      },
    });
  } catch (error) {
    console.error('Error generating guided learning route:', error);
    res.status(500).json({ success: false, error: 'Failed to generate guided learning route', details: error.message });
  }
};

// @desc    Persist guided learning progress for a subject
// @route   POST /api/guided-learning/:subjectId/progress
// @access  Public
exports.updateGuidedLearningProgress = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.session.userId;
    const { current_step, completed_steps = [], score_pct } = req.body;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }

    if (String(subject.user_id) !== String(userId)) {
      const subscription = await Subject.checkSubscription(subject.id, userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const normalizedCurrentStep = normalizeStepNumber(current_step);
    const normalizedCompletedSteps = Array.isArray(completed_steps)
      ? [...new Set(completed_steps.map((step) => normalizeStepNumber(step)))].sort((a, b) => a - b)
      : [];
    const numericScore = Number(score_pct);
    const isCompleted = normalizedCurrentStep >= 4 && Number.isFinite(numericScore) && numericScore >= 75;

    const savedProgress = await GuidedLearningProgress.upsert({
      user_id: userId,
      subject_id: subjectId,
      current_step: normalizedCurrentStep,
      completed_steps: normalizedCompletedSteps,
      is_completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : null,
    });

    res.status(200).json({
      success: true,
      data: savedProgress,
    });
  } catch (error) {
    console.error('Error updating guided learning progress:', error);
    res.status(500).json({ success: false, error: 'Failed to update guided learning progress', details: error.message });
  }
};

// @desc    Calculate deterministic effort probability model by subject
// @route   POST /api/planning/effort-probability/:subjectId
// @access  Public
exports.getEffortProbability = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const userId = req.session.userId;

    const [subject, sessions] = await Promise.all([
      Subject.findById(subjectId),
      AssessmentSession.findBySubject(subjectId, userId)
    ]);

    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const cognitiveProfile = userId ? await CognitiveProfile.getByUserId(userId) : null;
    const classificationInsight = await exports.getSubjectClassificationInsight(subjectId, subject);
    const payload = buildEffortProbabilityResults(subject, sessions || [], {
      tempo_score: cognitiveProfile?.tempo_score || 'medium',
      classification: classificationInsight?.classification || null,
    });

    res.status(200).json({
      success: true,
      data: {
        subject_id: subjectId,
        model: 'histogram-kernel-v1',
        tempo_explanation: payload.applied_tempo_score === 'slow'
          ? 'Tempo-Profil slow: Stundenrange wurde um 20% erhöht.'
          : payload.applied_tempo_score === 'fast'
            ? 'Tempo-Profil fast: Stundenrange wurde um 10% reduziert.'
            : 'Tempo-Profil medium: keine Anpassung der Stundenrange.',
        classification_factors: classificationInsight?.factors || [],
        ...payload,
      }
    });
  } catch (error) {
    console.error('Error calculating effort probability:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate effort probability' });
  }
};

// @desc    Get cognitive profile for current user
// @route   GET /api/profile/cognitive
// @access  Private
exports.getCognitiveProfile = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const profile = await CognitiveProfile.getOrCreateByUserId(userId);
    const recentSessions = await AssessmentSession.findByUser(userId, 20);
    const explanations = buildCognitiveProfileExplanations(profile);
    const confidence = resolveCognitiveConfidence({
      sessionCount: recentSessions.length,
      responseSamples: Number(profile.error_pattern_bias?.response_time_samples || 0),
      wrongTopicSamples: Number(profile.error_pattern_bias?.sample_size || 0),
    });

    res.status(200).json({
      success: true,
      data: {
        tempo_score: profile.tempo_score,
        abstraction_score: profile.abstraction_score,
        error_pattern_bias: profile.error_pattern_bias,
        updated_at: profile.updated_at,
        explanations,
        confidence,
      },
    });
  } catch (error) {
    console.error('Error loading cognitive profile:', error);
    res.status(500).json({ success: false, error: 'Failed to load cognitive profile' });
  }
};

// @desc    Generate an editable post-exam re-check catalog (standard + AI)
// @route   GET /api/assessment/post-exam/catalog/:subjectId
// @access  Public
exports.getPostExamCatalog = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    const cachedCatalog = await findCachedPostExamCatalog(subjectId);
    if (cachedCatalog && Array.isArray(cachedCatalog.items) && cachedCatalog.items.length > 0) {
      const cachedItems = cachedCatalog.items
        .map((item) => sanitizeCatalogItem(item, item.source || 'standard'))
        .map((item) => ({
          ...item,
          came_up_in_exam: null,
          was_correct: null,
          confidence: null
        }));

      return res.status(200).json({
        success: true,
        data: {
          items: cachedItems,
          applied_learning_style: activeLearningStyle
        },
        cached: true
      });
    }

    const [errorPatterns, documents, sessions] = await Promise.all([
      ErrorPattern.findBySubject(subjectId),
      Subject.getDocuments(subjectId),
      AssessmentSession.findBySubject(subjectId, req.session.userId)
    ]);

    const weakTopics = errorPatterns
      .filter((pattern) => pattern.error_count >= 2)
      .sort((a, b) => b.error_count - a.error_count)
      .map((pattern) => pattern.topic);

    const latestSession = sessions.length > 0 ? sessions[0] : null;

    const baseCatalog = buildDefaultPostExamCatalog(subject, weakTopics);
    let aiCatalog = [];

    if (documents.length > 0) {
      const mergedContent = documents.map((doc) => doc.content).join('\n\n---\n\n').slice(0, 10000);
      const systemPrompt = buildAiCatalogPrompt(subject, weakTopics, activeLearningStyle);

      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Kontext fuer das Fach ${subject.name}:\n${mergedContent}` }
          ],
          temperature: 0.4
        });

        const responseText = completion.choices[0].message.content.trim();
        const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          aiCatalog = parsed
            .map((item) => sanitizeCatalogItem(item, 'ai'))
            .filter((item) => item.question_text && item.expected_answer)
            .slice(0, 4);
        }
      } catch (aiError) {
        console.error('Post-exam catalog AI generation failed, using standard-only catalog:', aiError.message);
      }
    }

    const combined = [...baseCatalog, ...aiCatalog].map((item) => ({
      ...sanitizeCatalogItem(item, item.source || 'standard'),
      came_up_in_exam: null,
      was_correct: null,
      confidence: null
    }));

    await storePostExamCatalog(
      subjectId,
      combined.map((item) => ({
        topic: item.topic,
        question_text: item.question_text,
        expected_answer: item.expected_answer,
        source: item.source
      }))
    );

    res.status(200).json({
      success: true,
      data: {
        items: combined,
        applied_learning_style: activeLearningStyle
      },
      cached: false
    });
  } catch (error) {
    console.error('Error generating post-exam catalog:', error);
    res.status(500).json({ success: false, error: 'Failed to generate post-exam catalog' });
  }
};

// @desc    Submit completed post-exam re-check and update score/error-memory
// @route   POST /api/assessment/post-exam/submit
// @access  Public
exports.submitPostExamReview = async (req, res) => {
  try {
    const { subject_id, items } = req.body;

    if (!subject_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'subject_id und items sind erforderlich'
      });
    }

    const subject = await Subject.findById(subject_id);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const allowedConfidence = new Set(['low', 'medium', 'high']);
    const normalizedItems = items.map((item) => ({
      topic: String(item.topic || '').trim().slice(0, 255),
      question_text: String(item.question_text || '').trim(),
      expected_answer: String(item.expected_answer || '').trim(),
      came_up_in_exam: item.came_up_in_exam,
      was_correct: item.was_correct,
      confidence: String(item.confidence || '').trim(),
      source: item.source === 'ai' ? 'ai' : 'standard'
    }));

    for (const item of normalizedItems) {
      if (!item.topic || !item.question_text || !item.expected_answer) {
        return res.status(400).json({ success: false, error: 'topic, question_text und expected_answer sind erforderlich' });
      }
      if (typeof item.came_up_in_exam !== 'boolean' || typeof item.was_correct !== 'boolean') {
        return res.status(400).json({ success: false, error: 'came_up_in_exam und was_correct muessen boolean sein' });
      }
      if (!allowedConfidence.has(item.confidence)) {
        return res.status(400).json({ success: false, error: 'confidence muss low, medium oder high sein' });
      }
    }

    const evaluatedItems = normalizedItems.filter((item) => item.came_up_in_exam);
    const scoringBase = evaluatedItems.length > 0 ? evaluatedItems : normalizedItems;
    const total = scoringBase.length;
    const score = scoringBase.filter((item) => item.was_correct).length;
    const score_pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const grade_prognosis = calculateGradeFromPct(score_pct);

    // Explicit transaction: wrap all 4 DB operations (session, review, items, error patterns)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Create assessment session
      const sessionId = generateId();
      const sessionResult = await client.query(
        `INSERT INTO assessment_sessions 
         (id, subject_id, user_id, score, total, score_pct, grade_prognosis) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [sessionId, subject_id, req.session.userId || null, score, total, score_pct, grade_prognosis]
      );
      const session = sessionResult.rows[0];

      // 2. Create post-exam review
      const reviewId = generateId();
      const reviewResult = await client.query(
        `INSERT INTO post_exam_reviews 
         (id, subject_id, session_id, score, total, score_pct, grade_prognosis) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [reviewId, subject_id, session.id, score, total, score_pct, grade_prognosis]
      );
      const review = reviewResult.rows[0];

      // 3. Create post-exam review items (batch insert within transaction)
      for (const item of normalizedItems) {
        const itemId = generateId();
        await client.query(
          `INSERT INTO post_exam_review_items
           (id, review_id, topic, question_text, expected_answer, came_up_in_exam, was_correct, confidence, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            itemId,
            review.id,
            item.topic,
            item.question_text,
            item.expected_answer,
            item.came_up_in_exam,
            item.was_correct,
            item.confidence,
            item.source || 'standard'
          ]
        );
      }

      // 4. Update error patterns using only questions that actually appeared in the exam
      for (const item of evaluatedItems) {
        const shouldIncrease = !item.was_correct || item.confidence === 'low';
        const shouldDecrease = item.was_correct && item.confidence === 'high';

        if (shouldIncrease) {
          // Find existing error pattern
          const existingResult = await client.query(
            'SELECT * FROM error_patterns WHERE subject_id = $1 AND topic = $2',
            [subject_id, item.topic]
          );
          const existing = existingResult.rows[0];

          if (existing) {
            // Update existing
            await client.query(
              `UPDATE error_patterns 
               SET error_count = error_count + 1, last_seen = CURRENT_TIMESTAMP 
               WHERE id = $1`,
              [existing.id]
            );
          } else {
            // Insert new
            const epId = generateId();
            await client.query(
              `INSERT INTO error_patterns 
               (id, subject_id, user_id, topic, error_count) 
               VALUES ($1, $2, $3, $4, $5)`,
              [epId, subject_id, null, item.topic, 1]
            );
          }
        } else if (shouldDecrease) {
          // Find existing error pattern
          const existingResult = await client.query(
            'SELECT * FROM error_patterns WHERE subject_id = $1 AND topic = $2',
            [subject_id, item.topic]
          );
          const existing = existingResult.rows[0];

          if (existing && existing.error_count > 0) {
            // Decrement (minimum 0)
            await client.query(
              `UPDATE error_patterns 
               SET error_count = GREATEST(error_count - 1, 0), last_seen = CURRENT_TIMESTAMP 
               WHERE id = $1`,
              [existing.id]
            );
          }
        }
      }

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        data: {
          review_id: review.id,
          session_id: session.id,
          score,
          total,
          score_pct,
          grade_prognosis
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error submitting post-exam review:', error);
    res.status(500).json({ success: false, error: 'Failed to submit post-exam review', details: error.message });
  }
};

// @desc    Get post-exam review history for a subject
// @route   GET /api/assessment/post-exam/history/:subjectId
// @access  Public
exports.getPostExamHistory = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const history = await PostExamReview.findBySubject(subjectId, limit, userId);
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error('Error loading post-exam history:', error);
    res.status(500).json({ success: false, error: 'Failed to load post-exam history' });
  }
};

// @desc    Get post-exam review details for a session
// @route   GET /api/assessment/post-exam/session/:sessionId
// @access  Public
exports.getPostExamReviewBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.session.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const session = await AssessmentSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    if (String(session.user_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const review = await PostExamReview.findBySession(sessionId);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Post-exam review not found' });
    }

    const items = await PostExamReviewItem.findByReview(review.id);

    res.status(200).json({
      success: true,
      data: {
        review,
        items,
      },
    });
  } catch (error) {
    console.error('Error loading post-exam review details:', error);
    res.status(500).json({ success: false, error: 'Failed to load post-exam review details' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// FLASHCARDS
// ══════════════════════════════════════════════════════════════════════════════

// @desc    Get flashcards for a subject
// @route   GET /api/assessment/flashcards/:subjectId
// @access  Public
exports.getFlashcards = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const mode = String(req.query.mode || 'due');
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const includeArchived = String(req.query.includeArchived || 'false') === 'true';
    const guidedStep = req.query.guidedStep !== undefined ? Number(req.query.guidedStep) : null;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const dueOnly = mode === 'due';

    const [cards, stats] = await Promise.all([
      Flashcard.findBySubject(subjectId, req.session.userId, { dueOnly, includeArchived, limit, guidedStep }),
      Flashcard.getStatsBySubject(subjectId, req.session.userId, guidedStep),
    ]);

    res.status(200).json({ success: true, data: { cards, stats } });
  } catch (error) {
    console.error('Error fetching flashcards:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch flashcards' });
  }
};

// @desc    Get flashcard stats for a subject
// @route   GET /api/assessment/flashcards/stats/:subjectId
// @access  Public
exports.getFlashcardStats = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const stats = await Flashcard.getStatsBySubject(subjectId, req.session.userId);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Error loading flashcard stats:', error);
    res.status(500).json({ success: false, error: 'Failed to load flashcard stats' });
  }
};

// @desc    Create a manual flashcard
// @route   POST /api/assessment/flashcards/:subjectId
// @access  Public
exports.createFlashcard = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const cardInput = sanitizeFlashcard(req.body, 'manual');
    if (!cardInput.term || !cardInput.answer) {
      return res.status(400).json({ success: false, error: 'term und answer sind erforderlich' });
    }

    const created = await Flashcard.create({
      subject_id: subjectId,
      user_id: req.session.userId,
      term: cardInput.term,
      answer: cardInput.answer,
      hint: cardInput.hint,
      topic: cardInput.topic,
      source: 'manual',
      repetition: 0,
      interval_days: 0,
      ease_factor: 2.5,
      due_at: new Date(),
      is_archived: false,
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Error creating flashcard:', error);
    res.status(500).json({ success: false, error: 'Failed to create flashcard', details: error.message });
  }
};

// @desc    Update an existing flashcard
// @route   PUT /api/assessment/flashcards/:cardId
// @access  Public
exports.updateFlashcard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const existing = await Flashcard.findById(cardId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Flashcard not found' });
    }
    if (String(existing.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const cardInput = sanitizeFlashcard(req.body, existing.source || 'manual');
    if (!cardInput.term || !cardInput.answer) {
      return res.status(400).json({ success: false, error: 'term und answer sind erforderlich' });
    }

    const updated = await Flashcard.update(cardId, {
      ...existing,
      term: cardInput.term,
      answer: cardInput.answer,
      hint: cardInput.hint,
      topic: cardInput.topic,
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating flashcard:', error);
    res.status(500).json({ success: false, error: 'Failed to update flashcard', details: error.message });
  }
};

// @desc    Archive a flashcard
// @route   DELETE /api/assessment/flashcards/:cardId
// @access  Public
exports.archiveFlashcard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const existing = await Flashcard.findById(cardId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Flashcard not found' });
    }
    if (String(existing.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const archived = await Flashcard.archive(cardId);
    res.status(200).json({ success: true, data: archived });
  } catch (error) {
    console.error('Error archiving flashcard:', error);
    res.status(500).json({ success: false, error: 'Failed to archive flashcard', details: error.message });
  }
};

// @desc    Generate AI flashcards for one subject
// @route   POST /api/assessment/flashcards/generate/:subjectId
// @access  Public
exports.generateFlashcards = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const documents = await Subject.getDocuments(subjectId);
    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'Bitte lade zuerst Dokumente hoch' });
    }

    const learningProfile = await LearningProfile.getGlobal();
    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);

    const mergedContent = documents.map((doc) => doc.content).join('\n\n---\n\n').slice(0, 12000);
    const prompt = buildFlashcardPrompt(subject, activeLearningStyle);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Kontext fuer ${subject.name}:\n${mergedContent}` }
      ],
      temperature: 0.4,
    });

    const responseText = completion.choices[0].message.content.trim();
    const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    let parsed;
    try {
      parsed = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse AI flashcards:', parseError);
      return res.status(500).json({ success: false, error: 'Failed to parse generated flashcards' });
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(500).json({ success: false, error: 'Invalid flashcard format from AI' });
    }

    const existingMap = await Flashcard.findBySubjectAsMap(subjectId, req.session.userId);

    const candidates = parsed
      .slice(0, FLASHCARD_AI_COUNT)
      .map((item) => sanitizeFlashcard(item, 'ai'))
      .filter((item) => item.term && item.answer);

    const uniqueToInsert = [];
    for (const card of candidates) {
      const key = `${card.term.toLowerCase()}::${card.answer.toLowerCase()}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, card);
        uniqueToInsert.push({
          subject_id: subjectId,
          user_id: req.session.userId,
          term: card.term,
          answer: card.answer,
          hint: card.hint,
          topic: card.topic,
          source: 'ai',
          repetition: 0,
          interval_days: 0,
          ease_factor: 2.5,
          due_at: new Date(),
          is_archived: false,
        });
      }
    }

    const created = uniqueToInsert.length > 0
      ? await Flashcard.createMany(uniqueToInsert)
      : [];

    res.status(200).json({
      success: true,
      data: {
        generated_count: candidates.length,
        inserted_count: created.length,
        skipped_duplicates: Math.max(candidates.length - created.length, 0),
        cards: created,
        applied_learning_style: activeLearningStyle,
      }
    });
  } catch (error) {
    console.error('Error generating flashcards:', error);
    res.status(500).json({ success: false, error: 'Failed to generate flashcards', details: error.message });
  }
};

// @desc    Generate AI flashcards for a guided learning step
// @route   POST /api/assessment/guided-learning/:subjectId/flashcards/:step
// @access  Public
exports.generateGuidedFlashcards = async (req, res) => {
  try {
    const { subjectId, step } = req.params;
    const guidedStep = normalizeStepNumber(step);

    if (guidedStep < 1 || guidedStep > 3) {
      return res.status(400).json({ success: false, error: 'Guided flashcards are only available for steps 1 to 3' });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const [documents, learningProfile, errorPatterns, routeResult] = await Promise.all([
      Subject.getDocuments(subjectId),
      LearningProfile.getGlobal(),
      ErrorPattern.findBySubject(subjectId),
      (async () => {
        const route = buildGuidedLearningRoute({
          subject,
          documents: await Subject.getDocuments(subjectId),
          latestSession: await AssessmentSession.findLastBySubject(subjectId, req.session.userId),
          errorPatterns: await ErrorPattern.findBySubject(subjectId),
          activeLearningStyle: normalizeLearningStyle((await LearningProfile.getGlobal()).style),
        });
        return route.steps.find((item) => item.step === guidedStep) || null;
      })(),
    ]);

    if (!documents || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'Bitte lade zuerst Dokumente hoch' });
    }

    const activeLearningStyle = normalizeLearningStyle(learningProfile.style);
    const guidedStepContext = routeResult;
    if (!guidedStepContext) {
      return res.status(404).json({ success: false, error: 'Guided step not found' });
    }

    const mergedContent = documents.map((doc) => doc.content).join('\n\n---\n\n').slice(0, 12000);
    const prompt = buildGuidedFlashcardPrompt({
      subject,
      activeLearningStyle,
      step: guidedStep,
      guidedStepContext,
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Kontext fuer ${subject.name} (Guided Step ${guidedStep}):\n${mergedContent}`,
        }
      ],
      temperature: 0.35,
    });

    const responseText = completion.choices[0].message.content.trim();
    const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    let parsed;
    try {
      parsed = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse guided AI flashcards:', parseError);
      return res.status(500).json({ success: false, error: 'Failed to parse generated guided flashcards' });
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(500).json({ success: false, error: 'Invalid guided flashcard format from AI' });
    }

    const existingMap = await Flashcard.findBySubjectAsMap(subjectId, req.session.userId);

    const candidates = parsed
      .slice(0, GUIDED_FLASHCARD_AI_COUNT)
      .map((item) => ({ ...sanitizeFlashcard(item, 'guided'), guided_step: guidedStep, source: 'guided' }))
      .filter((item) => item.term && item.answer);

    const uniqueToInsert = [];
    for (const card of candidates) {
      const key = `${card.term.toLowerCase()}::${card.answer.toLowerCase()}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, card);
        uniqueToInsert.push({
          subject_id: subjectId,
          user_id: req.session.userId,
          term: card.term,
          answer: card.answer,
          hint: card.hint,
          topic: card.topic,
          source: 'guided',
          guided_step: guidedStep,
          repetition: 0,
          interval_days: 0,
          ease_factor: 2.5,
          due_at: new Date(),
          is_archived: false,
        });
      }
    }

    const created = uniqueToInsert.length > 0
      ? await Flashcard.createMany(uniqueToInsert)
      : [];

    res.status(200).json({
      success: true,
      data: {
        guided_step: guidedStep,
        step_title: guidedStepContext.title,
        generated_count: candidates.length,
        inserted_count: created.length,
        skipped_duplicates: Math.max(candidates.length - created.length, 0),
        cards: created,
        applied_learning_style: activeLearningStyle,
      }
    });
  } catch (error) {
    console.error('Error generating guided flashcards:', error);
    res.status(500).json({ success: false, error: 'Failed to generate guided flashcards', details: error.message });
  }
};

// @desc    Submit flashcard reviews and update scheduling
// @route   POST /api/assessment/flashcards/review
// @access  Public
exports.submitFlashcardReview = async (req, res) => {
  try {
    const { reviews } = req.body;

    if (!Array.isArray(reviews) || reviews.length === 0) {
      return res.status(400).json({ success: false, error: 'reviews muss ein nicht-leeres Array sein' });
    }

    const allowedRatings = new Set(['again', 'hard', 'good', 'easy']);
    const reviewEvents = [];
    const updatedCards = [];

    for (const review of reviews) {
      const flashcardId = String(review.flashcard_id || '').trim();
      const rating = String(review.rating || '').trim().toLowerCase();

      if (!flashcardId || !allowedRatings.has(rating)) {
        return res.status(400).json({ success: false, error: 'flashcard_id und gueltiges rating sind erforderlich' });
      }

      const card = await Flashcard.findById(flashcardId);
      if (!card || card.is_archived) {
        continue;
      }
      if (String(card.user_id) !== String(req.session.userId)) {
        continue;
      }

      const spacedRep = applySpacedRepetition(card, rating);
      const updatedCard = await Flashcard.update(card.id, {
        ...card,
        repetition: spacedRep.repetition,
        interval_days: spacedRep.interval_days,
        ease_factor: spacedRep.ease_factor,
        due_at: spacedRep.due_at,
        last_reviewed_at: spacedRep.last_reviewed_at,
      });

      updatedCards.push(updatedCard);
      reviewEvents.push({
        flashcard_id: card.id,
        subject_id: card.subject_id,
        rating,
        was_correct: rating !== 'again',
      });
    }

    if (reviewEvents.length > 0) {
      await FlashcardReview.createMany(reviewEvents);
    }

    res.status(200).json({
      success: true,
      data: {
        reviewed_count: reviewEvents.length,
        cards: updatedCards,
      }
    });
  } catch (error) {
    console.error('Error submitting flashcard review:', error);
    res.status(500).json({ success: false, error: 'Failed to submit flashcard review', details: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// HYBRID QUESTION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// @desc    Get all questions for a subject (KI + manual) – for the manager view
// @route   GET /api/assessment/questions/:subjectId
exports.getQuestions = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const questions = await AssessmentQuestion.findAllBySubject(subjectId, req.session.userId);
    res.status(200).json({
      success: true,
      data: questions.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        topic: q.topic,
        explanation: q.explanation,
        is_manual: q.is_manual,
        generated_at: q.generated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch questions' });
  }
};

// @desc    Create a manual question for a subject
// @route   POST /api/assessment/questions/:subjectId
exports.createQuestion = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { question, options, correct_index, topic, explanation } = req.body;

    if (!question || !Array.isArray(options) || options.length !== 4 || correct_index === undefined) {
      return res.status(400).json({
        success: false,
        error: 'question, options (4 items) and correct_index are required'
      });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: 'Subject not found' });
    }
    if (String(subject.user_id) !== String(req.session.userId)) {
      const subscription = await Subject.checkSubscription(subject.id, req.session.userId);
      if (!subscription) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const created = await AssessmentQuestion.create({
      subject_id: subjectId,
      user_id: req.session.userId,
      question,
      options,
      correct_index,
      topic: topic || null,
      explanation: explanation || null
    });

    res.status(201).json({
      success: true,
      data: {
        id: created.id,
        question: created.question,
        options: created.options,
        correct_index: created.correct_index,
        topic: created.topic,
        explanation: created.explanation,
        is_manual: created.is_manual,
        generated_at: created.generated_at
      }
    });
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({ success: false, error: 'Failed to create question', details: error.message });
  }
};

// @desc    Update a question
// @route   PUT /api/assessment/questions/:questionId
exports.updateQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { question, options, correct_index, topic, explanation } = req.body;

    if (!question || !Array.isArray(options) || options.length !== 4 || correct_index === undefined) {
      return res.status(400).json({
        success: false,
        error: 'question, options (4 items) and correct_index are required'
      });
    }

    const existing = await AssessmentQuestion.findById(questionId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }

    if (String(existing.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await AssessmentQuestion.update(questionId, {
      question, options, correct_index, topic: topic || null, explanation: explanation || null
    });

    res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        question: updated.question,
        options: updated.options,
        correct_index: updated.correct_index,
        topic: updated.topic,
        explanation: updated.explanation,
        is_manual: updated.is_manual,
        generated_at: updated.generated_at
      }
    });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ success: false, error: 'Failed to update question', details: error.message });
  }
};

// @desc    Delete a single question
// @route   DELETE /api/assessment/questions/:questionId
exports.deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;

    const existing = await AssessmentQuestion.findById(questionId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }

    if (String(existing.user_id) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await AssessmentQuestion.deleteOne(questionId);
    res.status(200).json({ success: true, data: { id: questionId } });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ success: false, error: 'Failed to delete question', details: error.message });
  }
};
