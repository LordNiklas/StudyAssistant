// ── TODO: MOCK DATA ──────────────────────────────────────────────────────────
// This file contains local mock data for features not supported by the backend yet.
// Replace all "TODO: MOCK DATA" sections with real API calls after backend expansion.
// ─────────────────────────────────────────────────────────────────────────────

import type { Question } from './types';

// ── TODO: MOCK DATA ── Generic sample questions for placement tests.
// The backend currently has no endpoint for question generation.
// Replace this data with the real API call in AssessmentView.tsx when
// POST /api/assessment/:subjectId is available.
export const MOCK_QUESTIONS: Question[] = [
  {
    id: 'mock-q1',
    question: 'Was versteht man unter dem Begriff "Abstraktion" in der Informatik?',
    options: [
      'Das Entfernen von Details, um ein allgemeines Konzept zu beschreiben',
      'Die Umwandlung von Code in Maschinensprache',
      'Ein Verfahren zur Datenkompression',
      'Die Verschlüsselung von Daten',
    ],
    correct_index: 0,
    topic: 'Grundkonzepte',
    explanation:
      'Abstraktion bezeichnet das Weglassen von Details, um auf einer höheren Ebene zu arbeiten und Komplexität zu reduzieren.',
  },
  {
    id: 'mock-q2',
    question: 'Welches Konzept beschreibt die Wiederverwendung von Code durch Vererbung?',
    options: [
      'Polymorphismus',
      'Enkapsulierung',
      'Vererbung',
      'Komposition',
    ],
    correct_index: 2,
    topic: 'Objektorientierung',
    explanation:
      'Vererbung ermöglicht es, Eigenschaften und Methoden einer Klasse an Unterklassen weiterzugeben und so Code wiederzuverwenden.',
  },
  {
    id: 'mock-q3',
    question: 'Was ist die Zeitkomplexität der binären Suche im Durchschnitt?',
    options: [
      'O(n)',
      'O(n²)',
      'O(log n)',
      'O(n log n)',
    ],
    correct_index: 2,
    topic: 'Algorithmen',
    explanation:
      'Die binäre Suche halbiert bei jedem Schritt den Suchbereich, was zu einer logarithmischen Zeitkomplexität O(log n) führt.',
  },
  {
    id: 'mock-q4',
    question: 'Welche Datenstruktur arbeitet nach dem LIFO-Prinzip?',
    options: [
      'Queue (Warteschlange)',
      'Stack (Stapel)',
      'Linked List',
      'Hash Map',
    ],
    correct_index: 1,
    topic: 'Datenstrukturen',
    explanation:
      'Ein Stack (Stapel) arbeitet nach dem Last-In-First-Out (LIFO)-Prinzip: Das zuletzt eingefügte Element wird zuerst entnommen.',
  },
  {
    id: 'mock-q5',
    question: 'Was bedeutet "idempotent" im Kontext von HTTP-Methoden?',
    options: [
      'Die Anfrage ist verschlüsselt',
      'Mehrfache identische Anfragen haben denselben Effekt wie eine einzelne',
      'Die Antwort wird gecacht',
      'Die Anfrage benötigt keine Authentifizierung',
    ],
    correct_index: 1,
    topic: 'Webentwicklung',
    explanation:
      'Idempotenz bedeutet, dass wiederholte Ausführungen derselben Operation das gleiche Ergebnis liefern. GET, PUT und DELETE sind idempotent.',
  },
];

// ── TODO: MOCK DATA ── UI helper functions for difficulty, grade, and formatting.
// This logic is client-only and should move to backend-supported data over time.

import type { Difficulty } from './types';

export const getDifficultyLabel = (
  difficulty?: Difficulty,
): { label: string; className: string } => {
  const map: Record<Difficulty, { label: string; className: string }> = {
    low: { label: '🟢 Leicht', className: 'bg-[rgb(34,197,94)] text-white' },
    medium: { label: '🔵 Mittel', className: 'bg-primary text-primary-foreground' },
    high: { label: '🟡 Schwer', className: 'bg-[rgb(234,179,8)] text-[rgb(30,30,30)]' },
    killer: {
      label: '🔴 Exmatrikulator',
      className: 'bg-destructive text-destructive-foreground',
    },
  };
  return difficulty ? map[difficulty] : { label: '', className: '' };
};

export const getGradeClassName = (grade: number): string => {
  if (grade <= 2) return 'bg-[rgb(34,197,94)] text-white';
  if (grade === 3) return 'bg-[rgb(234,179,8)] text-[rgb(30,30,30)]';
  return 'bg-destructive/15 border border-destructive text-destructive';
};

export const getGradeRecommendation = (grade: number): string => {
  const recommendations: Record<number, string> = {
    1: 'Hervorragend! Du bist bestens vorbereitet.',
    2: 'Sehr gut! Mit etwas Wiederholung bist du optimal aufgestellt.',
    3: 'Befriedigend. Arbeite die markierten Schwachstellen gezielt nach.',
    4: 'Knapp bestanden. Intensiveres Lernen in den Schwachstellen-Themen dringend empfohlen.',
    5: 'Nicht bestanden. Lade weitere Dokumente hoch und wiederhole den Test nach intensivem Lernen.',
  };
  return recommendations[grade] || '';
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
