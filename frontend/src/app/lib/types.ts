// Shared TypeScript types for the Study Assistant frontend

export type Difficulty = 'low' | 'medium' | 'high' | 'killer';

/** Subject as returned by the backend API */
export interface Subject {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at?: string;
  documents?: ApiDocument[];
  // Lecturer and difficulty fields stored in the backend database.
  lecturer_name?: string;
  difficulty?: Difficulty;
  exam_notes?: string;
  // Document count returned by the list API (populated via JOIN in findAll)
  document_count?: number;
  // Public and subscription fields.
  is_public?: boolean;
  ownership?: 'owner' | 'subscriber';
  owner_username?: string;
  subscriber_count?: number;
  // lastSession remains client-side for now (stored in localStorage).
  lastSession?: LastSession;
}

/** The payload accepted by the API for create / update */
export interface SubjectPayload {
  name: string;
  description: string;
  // Optional lecturer and difficulty fields backed by the backend.
  lecturer_name?: string | null;
  difficulty?: Difficulty | null;
  exam_notes?: string | null;
  // Public/subscription field.
  is_public?: boolean;
}

/**
 * Client-side only metadata for a subject.
 * lecturer_name, difficulty, and exam_notes are stored in the backend.
 * Only lastSession remains local until full assessment persistence is available.
 */
export interface SubjectMeta {
  lastSession?: LastSession;
}

/** Document as returned by the backend API */
export interface ApiDocument {
  id: string;
  name: string;
  original_filename?: string;
  file_type?: string;
  subject_id: string;
  created_at: string;
  updated_at?: string;
  size?: number;
}

// ── TODO: MOCK DATA ── The Question, AssessmentResult, and LastSession types
// are used exclusively for the local assessment/quiz feature which has no
// backend counterpart yet. When the assessment endpoint is implemented,
// replace these with API-backed types.

export interface Question {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  topic: string;
  explanation: string;
  is_manual?: boolean;
  generated_at?: string;
  repeatedErrorHint?: {
    error_type: string;
    error_type_label: string;
    topic: string;
    count: number;
    action_tip: string;
    message: string;
  } | null;
  errorPattern?: { error_count: number };
}

export interface QuestionResult {
  question: Question;
  selectedIndex: number;
  isCorrect: boolean;
}

export interface SessionDetail {
  session: import('../api/assessment').AssessmentSession;
  questionResults: QuestionResult[];
}

export interface LastSession {
  score: number;
  total: number;
  score_pct: number;
  grade_prognosis: number;
  date: string;
}

export interface TopicFactor {
  name: string;
  value: number;
  contribution: number;
}

export interface TopicPriorityExplanation {
  topic: string;
  priority: 'high' | 'medium' | 'low';
  composite_score: number;
  summary: string;
  factors: TopicFactor[];
}
