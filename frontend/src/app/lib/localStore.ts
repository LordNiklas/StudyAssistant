// ── TODO: MOCK DATA ──────────────────────────────────────────────────────────
// This file manages local persistence for features the backend does not support yet:
//   - Extended subject fields: lecturer_name, difficulty, exam_notes
//   - Last assessment session (lastSession) per subject
//   - Topic error patterns for repeated weaknesses
//
// All data is stored in localStorage. Replace these helpers with API calls
// when backend support is available.
// ─────────────────────────────────────────────────────────────────────────────

import type { SubjectMeta, LastSession } from './types';

const SUBJECT_META_KEY = 'ki_app_subject_meta';
const ERROR_PATTERNS_KEY = 'ki_app_error_patterns';

// ── SubjectMeta (lecturer_name, difficulty, exam_notes, lastSession) ──────────

// Reads all persisted subject metadata from localStorage.
function readAllMeta(): Record<string, SubjectMeta> {
  try {
    const raw = localStorage.getItem(SUBJECT_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAllMeta(meta: Record<string, SubjectMeta>): void {
  localStorage.setItem(SUBJECT_META_KEY, JSON.stringify(meta));
}

// Returns extended local metadata for one subject.
export function getSubjectMeta(subjectId: string): SubjectMeta {
  const all = readAllMeta();
  return all[subjectId] ?? {};
}

// Saves extended metadata fields for one subject.
export function saveSubjectMeta(subjectId: string, meta: Partial<SubjectMeta>): void {
  const all = readAllMeta();
  all[subjectId] = { ...all[subjectId], ...meta };
  writeAllMeta(all);
}

// Deletes local metadata when a subject is removed.
export function deleteSubjectMeta(subjectId: string): void {
  const all = readAllMeta();
  delete all[subjectId];
  writeAllMeta(all);
}

// ── LastSession (assessment results) ─────────────────────────────────────────

// Stores the latest assessment result for one subject.
export function saveLastSession(subjectId: string, session: LastSession): void {
  saveSubjectMeta(subjectId, { lastSession: session });
}

// ── Error Patterns (repeated weaknesses) ─────────────────────────────────────

// Returns topic-level error counts for one subject.
export function getErrorPatterns(subjectId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(ERROR_PATTERNS_KEY);
    const all: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    return all[subjectId] ?? {};
  } catch {
    return {};
  }
}

// Increments the error counter for a topic after an incorrect answer.
export function incrementErrorPattern(subjectId: string, topic: string): void {
  try {
    const raw = localStorage.getItem(ERROR_PATTERNS_KEY);
    const all: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
    if (!all[subjectId]) all[subjectId] = {};
    all[subjectId][topic] = (all[subjectId][topic] ?? 0) + 1;
    localStorage.setItem(ERROR_PATTERNS_KEY, JSON.stringify(all));
  } catch {
    // ignore localStorage errors
  }
}
