-- ══════════════════════════════════════════════════════════════════════════════
-- AUTHENTICATION CORE TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- Stores user identities and password hashes for login.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Stores study subjects owned by users.
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  lecturer_name VARCHAR(255),
  difficulty VARCHAR(20) DEFAULT NULL,
  exam_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stores uploaded learning documents per subject.
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255),
  file_type VARCHAR(50),
  file_path TEXT,
  content TEXT,
  vector_id VARCHAR(255),
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Speeds up document lookups by subject.
CREATE INDEX IF NOT EXISTS idx_documents_subject_id ON documents(subject_id);

-- Updates updated_at automatically before row updates.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Keeps subjects.updated_at current on each update.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_subjects_updated_at') THEN
    CREATE TRIGGER update_subjects_updated_at
    BEFORE UPDATE ON subjects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Keeps documents.updated_at current on each update.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_documents_updated_at') THEN
    CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ASSESSMENT AND LEARNING SUPPORT TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- Caches generated and manual assessment questions per subject.
CREATE TABLE IF NOT EXISTS assessment_questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL,        -- Answer choices, e.g. ["Option A", "Option B", "Option C", "Option D"]
  correct_index INTEGER NOT NULL,
  topic VARCHAR(255),
  explanation TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE for user-created questions that survive cache refreshes.
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Speeds up question lookups by subject.
CREATE INDEX IF NOT EXISTS idx_assessment_questions_subject_id ON assessment_questions(subject_id);

-- Stores completed assessment sessions and scoring metrics.
CREATE TABLE IF NOT EXISTS assessment_sessions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,        -- Number of correct answers.
  total INTEGER NOT NULL,        -- Total number of questions.
  score_pct INTEGER NOT NULL,    -- Score percentage from 0 to 100.
  grade_prognosis INTEGER,       -- Predicted grade in the range 1 to 5.
  duration_seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Speeds up session lookups by subject.
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_subject_id ON assessment_sessions(subject_id);

-- Stores individual answers given during each session.
CREATE TABLE IF NOT EXISTS user_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES assessment_questions(id),
  selected_index INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  topic VARCHAR(255),
  response_time_ms INTEGER,
  error_type VARCHAR(50)
);

-- Stores cognitive profile signals for each user.
CREATE TABLE IF NOT EXISTS cognitive_profiles (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tempo_score VARCHAR(20) NOT NULL DEFAULT 'medium',
  abstraction_score VARCHAR(20) NOT NULL DEFAULT 'medium',
  error_pattern_bias JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cognitive_profiles_user_id ON cognitive_profiles(user_id);

-- Guided Learning Journey progress per user and subject
CREATE TABLE IF NOT EXISTS guided_learning_progress (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  completed_steps INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_guided_learning_progress_user_subject
  ON guided_learning_progress(user_id, subject_id);

-- Tracks recurring topic-level error patterns per subject.
-- user_id can remain NULL when running in global or shared modes.
CREATE TABLE IF NOT EXISTS error_patterns (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  error_count INTEGER DEFAULT 0,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_id, topic)      -- Can be extended to include user_id for per-user tracking.
);

-- Stores metadata for each post-exam review run.
CREATE TABLE IF NOT EXISTS post_exam_reviews (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES assessment_sessions(id) ON DELETE SET NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  score_pct INTEGER NOT NULL,
  grade_prognosis INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_exam_reviews_subject_id ON post_exam_reviews(subject_id);

-- Stores per-topic review items for post-exam analysis.
CREATE TABLE IF NOT EXISTS post_exam_review_items (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES post_exam_reviews(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  question_text TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  came_up_in_exam BOOLEAN NOT NULL,
  was_correct BOOLEAN NOT NULL,
  confidence VARCHAR(20) NOT NULL,
  source VARCHAR(20) DEFAULT 'standard',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_exam_review_items_review_id ON post_exam_review_items(review_id);

-- Caches generated post-exam catalog items.
CREATE TABLE IF NOT EXISTS post_exam_catalog_cache (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_exam_catalog_cache_subject_created
  ON post_exam_catalog_cache(subject_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRATIONS (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensures subjects.user_id exists before dependent migration steps.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- Adds hybrid question-management columns for existing deployments.
ALTER TABLE assessment_questions ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE assessment_questions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
UPDATE assessment_questions aq
SET user_id = s.user_id
FROM subjects s
WHERE aq.subject_id = s.id AND aq.user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_questions_subject_user ON assessment_questions(subject_id, user_id);

-- Creates onboarding profile data for learning style preferences.
CREATE TABLE IF NOT EXISTS learning_profile (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  style VARCHAR(20) NOT NULL DEFAULT 'mixed',
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_profile_user_id ON learning_profile(user_id);

-- Backward-compatible migration for existing instances
ALTER TABLE learning_profile ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE learning_profile ADD COLUMN IF NOT EXISTS style VARCHAR(20) NOT NULL DEFAULT 'mixed';
ALTER TABLE learning_profile ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE learning_profile ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE learning_profile ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE assessment_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE user_answers ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
ALTER TABLE user_answers ADD COLUMN IF NOT EXISTS error_type VARCHAR(50);

-- Ensures question-linked answers are removed when questions are deleted.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  WHERE c.conrelid = 'user_answers'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'assessment_questions'::regclass
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE user_answers DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE user_answers
    ADD CONSTRAINT user_answers_question_id_fkey
    FOREIGN KEY (question_id)
    REFERENCES assessment_questions(id)
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already present with the expected name.
    NULL;
END $$;

ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS tempo_score VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS abstraction_score VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS error_pattern_bias JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE cognitive_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS guided_learning_progress (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  completed_steps INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_guided_learning_progress_user_subject
  ON guided_learning_progress(user_id, subject_id);

ALTER TABLE guided_learning_progress ADD COLUMN IF NOT EXISTS current_step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE guided_learning_progress ADD COLUMN IF NOT EXISTS completed_steps INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE guided_learning_progress ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE guided_learning_progress ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE guided_learning_progress ADD COLUMN IF NOT EXISTS last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Adds post-exam review columns for backwards compatibility.
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS score_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS grade_prognosis INTEGER;
ALTER TABLE post_exam_reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE post_exam_review_items ADD COLUMN IF NOT EXISTS came_up_in_exam BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE post_exam_review_items ADD COLUMN IF NOT EXISTS was_correct BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE post_exam_review_items ADD COLUMN IF NOT EXISTS confidence VARCHAR(20) NOT NULL DEFAULT 'medium';
ALTER TABLE post_exam_review_items ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'standard';
ALTER TABLE post_exam_review_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS post_exam_catalog_cache (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_learning_profile_updated_at') THEN
    CREATE TRIGGER update_learning_profile_updated_at
    BEFORE UPDATE ON learning_profile
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cognitive_profiles_updated_at') THEN
    CREATE TRIGGER update_cognitive_profiles_updated_at
    BEFORE UPDATE ON cognitive_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Creates flashcards and spaced-repetition review tracking tables.
CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  answer TEXT NOT NULL,
  hint TEXT,
  topic VARCHAR(255),
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  guided_step INTEGER,
  repetition INTEGER NOT NULL DEFAULT 0,
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  due_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_reviewed_at TIMESTAMP,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flashcards_subject_id ON flashcards(subject_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_due_at ON flashcards(due_at);
CREATE INDEX IF NOT EXISTS idx_flashcards_subject_archived_due
  ON flashcards(subject_id, is_archived, due_at);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id TEXT PRIMARY KEY,
  flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  rating VARCHAR(20) NOT NULL,
  was_correct BOOLEAN NOT NULL,
  reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_flashcard_id ON flashcard_reviews(flashcard_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_subject_id ON flashcard_reviews(subject_id);

ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS hint TEXT;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
UPDATE flashcards f
SET user_id = s.user_id
FROM subjects s
WHERE f.subject_id = s.id AND f.user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_flashcards_subject_user ON flashcards(subject_id, user_id);
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS topic VARCHAR(255);
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS guided_step INTEGER;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS repetition INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS interval_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS due_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_flashcards_subject_guided_step
  ON flashcards(subject_id, guided_step);

ALTER TABLE flashcard_reviews ADD COLUMN IF NOT EXISTS subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE;
ALTER TABLE flashcard_reviews ADD COLUMN IF NOT EXISTS rating VARCHAR(20) NOT NULL DEFAULT 'again';
ALTER TABLE flashcard_reviews ADD COLUMN IF NOT EXISTS was_correct BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE flashcard_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_flashcards_updated_at') THEN
    CREATE TRIGGER update_flashcards_updated_at
    BEFORE UPDATE ON flashcards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- EXPLAINABLE TOPIC PRIORITY SCORES
-- ══════════════════════════════════════════════════════════════════════════════

-- Stores computed priority scores and explainable factor breakdowns per topic.
CREATE TABLE IF NOT EXISTS topic_priority_explanations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  priority VARCHAR(10) NOT NULL,  -- Allowed values: 'high', 'medium', or 'low'.
  composite_score NUMERIC(5,3) NOT NULL,
  factors JSONB NOT NULL,
  repeated_error_hints JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_id, topic)
);

ALTER TABLE topic_priority_explanations ADD COLUMN IF NOT EXISTS repeated_error_hints JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_topic_priority_explanations_subject_id ON topic_priority_explanations(subject_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- AUTHENTICATION MIGRATIONS
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensure users.created_at exists and is populated on existing instances.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;

-- Adds subjects.user_id with a foreign key to users.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- ══════════════════════════════════════════════════════════════════════════════
-- SUBJECT SUBSCRIPTION SYSTEM
-- ══════════════════════════════════════════════════════════════════════════════

-- Enables public subjects and read-only subscriptions.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Stores subject subscriptions per user.
CREATE TABLE IF NOT EXISTS subject_subscriptions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  subscriber_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(20) DEFAULT 'read_only',
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_id, subscriber_user_id)
);

-- Improves query performance for subscription and sharing lookups.
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subject_subscriptions(subscriber_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subject ON subject_subscriptions(subject_id);
CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_subjects_is_public ON subjects(is_public);
