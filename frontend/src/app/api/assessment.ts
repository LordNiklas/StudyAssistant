// API client for /api/assessment
// Assessment endpoints for generating questions and submitting tests

import type { Question } from '../lib/types';

const BASE = '/api';

export interface GenerateQuestionsResponse {
  success: boolean;
  data: Question[];
  cached: boolean;
  applied_learning_style?: LearningStyle;
}

export type LearningStyle = 'visual' | 'analytical' | 'practical' | 'mixed';

export interface LearningProfile {
  style: LearningStyle;
  onboarding_completed: boolean;
}

export interface SubmitAssessmentPayload {
  subject_id: string;
  total_duration_seconds?: number;
  answers: {
    question_id: string;
    selected_index: number;
    response_time_ms?: number;
  }[];
}

export interface SubmitAssessmentResponse {
  success: boolean;
  data: {
    session_id: string;
    score: number;
    total: number;
    score_pct: number;
    grade_prognosis: number;
    answers: {
      question_id: string;
      selected_index: number;
      is_correct: boolean;
      topic: string;
      response_time_ms?: number | null;
    }[];
    cognitive_profile?: {
      tempo_score: CognitiveTempoScore;
      abstraction_score: CognitiveAbstractionScore;
      error_pattern_bias: Record<string, unknown>;
      updated_at: string;
    } | null;
  };
}

export type CognitiveTempoScore = 'fast' | 'medium' | 'slow';
export type CognitiveAbstractionScore = 'concrete' | 'medium' | 'abstract';
export type CognitiveConfidenceClass = 'low' | 'medium' | 'high';

export interface CognitiveProfile {
  tempo_score: CognitiveTempoScore;
  abstraction_score: CognitiveAbstractionScore;
  error_pattern_bias: Record<string, unknown>;
  updated_at: string;
  confidence?: {
    class: CognitiveConfidenceClass;
    score: number;
    reasons: string[];
  };
  explanations?: {
    tempo: string;
    abstraction: string;
  };
}

export interface AssessmentSession {
  id: string;
  subject_id: string;
  user_id: string | null;
  score: number;
  total: number;
  score_pct: number;
  grade_prognosis: number;
  created_at: string;
}

export interface ErrorPattern {
  id: string;
  subject_id: string;
  user_id: string | null;
  topic: string;
  error_count: number;
  last_seen: string;
}

export interface PostExamCatalogItem {
  topic: string;
  question_text: string;
  expected_answer: string;
  came_up_in_exam: boolean | null;
  was_correct: boolean | null;
  confidence: 'low' | 'medium' | 'high' | null;
  source: 'standard' | 'ai';
}

export interface PostExamCatalogResponse {
  items: PostExamCatalogItem[];
  applied_learning_style?: LearningStyle;
}

export interface PostExamSubmitItem {
  topic: string;
  question_text: string;
  expected_answer: string;
  came_up_in_exam: boolean;
  was_correct: boolean;
  confidence: 'low' | 'medium' | 'high';
  source: 'standard' | 'ai';
}

export interface PostExamReview {
  id: string;
  subject_id: string;
  session_id: string | null;
  score: number;
  total: number;
  score_pct: number;
  grade_prognosis: number;
  created_at: string;
}

export interface PostExamReviewDetail {
  review: PostExamReview;
  items: {
    id: string;
    review_id: string;
    topic: string;
    question_text: string;
    expected_answer: string;
    came_up_in_exam: boolean;
    was_correct: boolean;
    confidence: 'low' | 'medium' | 'high';
    source: 'standard' | 'ai';
    created_at: string;
  }[];
}

/**
 * Generate assessment questions for a subject.
 * Questions are cached for 24 hours.
 */
export async function generateQuestions(subjectId: string): Promise<GenerateQuestionsResponse> {
  const res = await fetch(`${BASE}/assessment/generate/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Generieren der Fragen');
  return data;
}

/**
 * Submit assessment answers and get results.
 */
export async function submitAssessment(payload: SubmitAssessmentPayload): Promise<SubmitAssessmentResponse> {
  const res = await fetch(`${BASE}/assessment/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Einreichen des Tests');
  return data;
}

/**
 * Get assessment history for a subject.
 */
export async function getAssessmentHistory(subjectId: string): Promise<AssessmentSession[]> {
  const res = await fetch(`${BASE}/assessment/history/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Test-Historie');
  return data.data;
}

/**
 * Get error patterns for a subject.
 */
export async function getErrorPatterns(subjectId: string): Promise<ErrorPattern[]> {
  const res = await fetch(`${BASE}/assessment/errors/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Fehlermuster');
  return data.data;
}

/**
 * Get the latest assessment session for every subject.
 * Returns a map of subject_id -> AssessmentSession.
 */
export async function getLatestSessionsMap(): Promise<Record<string, AssessmentSession>> {
  const res = await fetch(`${BASE}/assessment/latest-sessions`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der letzten Sessions');
  return data.data;
}

/**
 * Get full session detail (questions + answers) for a past test.
 */
export async function getSession(sessionId: string): Promise<{ session: AssessmentSession; questionResults: { question: Question; selectedIndex: number; isCorrect: boolean }[] }> {
  const res = await fetch(`${BASE}/assessment/session/${sessionId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Session');
  return data.data;
}

export interface LearningPlanTopicItem {
  topic: string;
  hours: number;
  priority: 'high' | 'medium' | 'low';
  tip: string;
}

export interface LearningPlanResponse {
  achievable_grade: number;
  achievable_pct: number;
  topic_plan: LearningPlanTopicItem[];
  general_advice: string;
  applied_learning_style?: LearningStyle;
}

export interface GuidedLearningStep {
  step: 1 | 2 | 3 | 4;
  phase: 'VERSTEHEN' | 'ÜBEN' | 'TRANSFER' | 'CHECK';
  title: string;
  description: string;
  budget_hours: number;
  estimated_certainty_gain: string;
  linked_topics: string[];
  action: string;
  action_type: 'review' | 'practice' | 'assessment';
}

export interface GuidedLearningRoute {
  steps: GuidedLearningStep[];
  total_hours: number;
  exit_criteria: string;
}

export interface GuidedLearningProgress {
  id: string;
  user_id: string;
  subject_id: string;
  current_step: 1 | 2 | 3 | 4;
  completed_steps: number[];
  is_completed: boolean;
  completed_at: string | null;
  last_accessed: string | null;
}

export interface GuidedLearningResponse {
  subject_id: string;
  auto_enabled: boolean;
  requested_difficulty: string | null;
  route: GuidedLearningRoute;
  progress: GuidedLearningProgress;
  resume_step: 1 | 2 | 3 | 4;
  applied_learning_style?: LearningStyle;
}

export interface UpdateGuidedLearningProgressPayload {
  current_step: 1 | 2 | 3 | 4;
  completed_steps: number[];
  score_pct?: number;
}

export type ConfidenceClass = 'low' | 'medium' | 'high';
export type SubjectClassification = '1day' | 'deep';

export interface EffortProbabilityItem {
  grade: 1 | 2 | 3 | 4 | 5;
  hours_min: number;
  hours_max: number;
  probability_percent: number;
  confidence_class: ConfidenceClass;
}

export interface EffortProbabilityResponse {
  subject_id: string;
  model: string;
  history_count: number;
  classification: SubjectClassification;
  applied_tempo_score: CognitiveTempoScore;
  tempo_adjustment_factor: number;
  tempo_explanation?: string;
  results: EffortProbabilityItem[];
}

/** Get the global learning profile (style + onboarding status). */
export async function getLearningProfile(): Promise<LearningProfile> {
  const res = await fetch(`${BASE}/assessment/learning-profile`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden des Lernstils');
  return data.data;
}

/** Update the global learning profile. */
export async function updateLearningProfile(
  style: LearningStyle,
  onboarding_completed = true,
): Promise<LearningProfile> {
  const res = await fetch(`${BASE}/assessment/learning-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style, onboarding_completed }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Speichern des Lernstils');
  return data.data;
}

/**
 * Generate a personalised learning plan for a subject.
 */
export async function generateLearningPlan(
  subjectId: string,
  available_hours: number,
  target_grade?: number,
): Promise<LearningPlanResponse> {
  const res = await fetch(`${BASE}/assessment/learning-plan/${subjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available_hours, target_grade }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Generieren des Lernplans');
  return data.data;
}

/**
 * Get the guided learning route for a subject.
 */
export async function getGuidedLearningRoute(
  subjectId: string,
  forDifficulty?: string,
): Promise<GuidedLearningResponse> {
  const params = new URLSearchParams();
  if (forDifficulty) params.set('forDifficulty', forDifficulty);

  const queryString = params.toString();
  const res = await fetch(`${BASE}/assessment/guided-learning/${subjectId}${queryString ? `?${queryString}` : ''}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Guided-Journey');
  return data.data;
}

/**
 * Persist the current guided learning progress.
 */
export async function updateGuidedLearningProgress(
  subjectId: string,
  payload: UpdateGuidedLearningProgressPayload,
): Promise<GuidedLearningProgress> {
  const res = await fetch(`${BASE}/assessment/guided-learning/${subjectId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Speichern des Guided-Progress');
  return data.data;
}

/**
 * Get deterministic effort probabilities and hour ranges for grade targets.
 */
export async function getEffortProbability(subjectId: string): Promise<EffortProbabilityResponse> {
  const res = await fetch(`${BASE}/planning/effort-probability/${subjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Berechnen der Aufwand-Wahrscheinlichkeit');
  return data.data;
}

/** Get current user's cognitive profile (read-only). */
export async function getCognitiveProfile(): Promise<CognitiveProfile> {
  const res = await fetch(`${BASE}/profile/cognitive`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Laden des kognitiven Profils');
  return data.data;
}

/** Get an editable post-exam re-check catalog (standard + AI). */
export async function getPostExamCatalog(subjectId: string): Promise<PostExamCatalogResponse> {
  const res = await fetch(`${BASE}/assessment/post-exam/catalog/${subjectId}`, {
    credentials: 'include',
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden des Re-Check-Katalogs');
  return data.data;
}

/** Submit a completed post-exam re-check. */
export async function submitPostExamReview(
  subjectId: string,
  items: PostExamSubmitItem[],
): Promise<{ review_id: string; session_id: string; score: number; total: number; score_pct: number; grade_prognosis: number }> {
  const res = await fetch(`${BASE}/assessment/post-exam/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subject_id: subjectId, items }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Speichern des Re-Checks');
  return data.data;
}

/** Get post-exam re-check history for one subject. */
export async function getPostExamHistory(subjectId: string, limit = 10): Promise<PostExamReview[]> {
  const res = await fetch(`${BASE}/assessment/post-exam/history/${subjectId}?limit=${limit}`, {
    credentials: 'include',
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Re-Check-Historie');
  return data.data;
}

/** Get post-exam review details for one session. */
export async function getPostExamReviewBySession(sessionId: string): Promise<PostExamReviewDetail> {
  const res = await fetch(`${BASE}/assessment/post-exam/session/${sessionId}`, {
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Laden der Re-Check-Details');
  return data.data;
}

// ── Hybrid Question Management ───────────────────────────────────────────────

export interface ManagedQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  topic: string | null;
  explanation: string | null;
  is_manual: boolean;
  generated_at: string;
}

export interface QuestionPayload {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  topic?: string;
  explanation?: string;
}

/** Get all questions for a subject (KI + manual) – for the manager view */
export async function getQuestions(subjectId: string): Promise<ManagedQuestion[]> {
  const res = await fetch(`${BASE}/assessment/questions/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Fragen');
  return data.data;
}

/** Create a new manual question for a subject */
export async function createQuestion(subjectId: string, payload: QuestionPayload): Promise<ManagedQuestion> {
  const res = await fetch(`${BASE}/assessment/questions/${subjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Erstellen der Frage');
  return data.data;
}

/** Update an existing question */
export async function updateQuestion(questionId: string, payload: QuestionPayload): Promise<ManagedQuestion> {
  const res = await fetch(`${BASE}/assessment/questions/${questionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Aktualisieren der Frage');
  return data.data;
}

/** Delete a question */
export async function deleteQuestion(questionId: string): Promise<void> {
  const res = await fetch(`${BASE}/assessment/questions/${questionId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Löschen der Frage');
}

// ── Flashcards with Spaced Repetition ───────────────────────────────────────

export type FlashcardSource = 'manual' | 'ai' | 'guided';
export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';

export interface Flashcard {
  id: string;
  subject_id: string;
  term: string;
  answer: string;
  hint: string | null;
  topic: string | null;
  source: FlashcardSource;
  guided_step: number | null;
  repetition: number;
  interval_days: number;
  ease_factor: number;
  due_at: string;
  last_reviewed_at: string | null;
  last_review_rating: FlashcardRating | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlashcardStats {
  total_active: number;
  due_now: number;
  new_cards: number;
  learning_cards: number;
  archived: number;
}

export interface FlashcardPayload {
  term: string;
  answer: string;
  hint?: string | null;
  topic?: string | null;
}

export interface FlashcardReviewPayload {
  flashcard_id: string;
  rating: FlashcardRating;
}

export async function getFlashcards(
  subjectId: string,
  mode: 'due' | 'all' = 'due',
  includeArchived = false,
  limit = 100,
  guidedStep?: number,
): Promise<{ cards: Flashcard[]; stats: FlashcardStats }> {
  const query = new URLSearchParams({
    mode,
    includeArchived: String(includeArchived),
    limit: String(limit),
  });

  if (guidedStep !== undefined) {
    query.set('guidedStep', String(guidedStep));
  }

  const res = await fetch(`${BASE}/assessment/flashcards/${subjectId}?${query.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Karteikarten');
  return data.data;
}

export async function getFlashcardStats(subjectId: string): Promise<FlashcardStats> {
  const res = await fetch(`${BASE}/assessment/flashcards/stats/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Karteikarten-Statistik');
  return data.data;
}

export async function createFlashcard(subjectId: string, payload: FlashcardPayload): Promise<Flashcard> {
  const res = await fetch(`${BASE}/assessment/flashcards/${subjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Erstellen der Karteikarte');
  return data.data;
}

export async function updateFlashcard(cardId: string, payload: FlashcardPayload): Promise<Flashcard> {
  const res = await fetch(`${BASE}/assessment/flashcards/${cardId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Aktualisieren der Karteikarte');
  return data.data;
}

export async function archiveFlashcard(cardId: string): Promise<Flashcard> {
  const res = await fetch(`${BASE}/assessment/flashcards/${cardId}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Archivieren der Karteikarte');
  return data.data;
}

export async function generateFlashcards(subjectId: string): Promise<{
  generated_count: number;
  inserted_count: number;
  skipped_duplicates: number;
  cards: Flashcard[];
  applied_learning_style?: LearningStyle;
}> {
  const res = await fetch(`${BASE}/assessment/flashcards/generate/${subjectId}`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Generieren der Karteikarten');
  return data.data;
}

export async function generateGuidedFlashcards(subjectId: string, step: number): Promise<{
  guided_step: number;
  step_title: string;
  generated_count: number;
  inserted_count: number;
  skipped_duplicates: number;
  cards: Flashcard[];
  applied_learning_style?: LearningStyle;
}> {
  const res = await fetch(`${BASE}/assessment/guided-learning/${subjectId}/flashcards/${step}`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Generieren der Guided-Karteikarten');
  return data.data;
}

export async function submitFlashcardReview(reviews: FlashcardReviewPayload[]): Promise<{
  reviewed_count: number;
  cards: Flashcard[];
}> {
  const res = await fetch(`${BASE}/assessment/flashcards/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviews }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Speichern der Review-Bewertung');
  return data.data;
}
