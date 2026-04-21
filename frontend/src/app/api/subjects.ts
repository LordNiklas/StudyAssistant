// Real API client for /api/subjects
// These functions call the actual Study Assistant backend.

import type { Subject, SubjectPayload } from '../lib/types';

const BASE = '/api';

/** Get all subjects visible to the current user. */
export async function fetchSubjects(): Promise<Subject[]> {
  const res = await fetch(`${BASE}/subjects`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Fächer');
  return data.data as Subject[];
}

/**
 * Get subjects for a specific filter.
 *
 * @param filter - Own subjects, subscriptions, or the combined view.
 */
export async function fetchSubjectsByFilter(filter: 'own' | 'subscribed' | 'all'): Promise<Subject[]> {
  const res = await fetch(`${BASE}/subjects?filter=${filter}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Fächer');
  return data.data as Subject[];
}

/**
 * Load one subject by ID.
 *
 * @param id - Subject ID.
 */
export async function fetchSubject(id: string): Promise<Subject> {
  const res = await fetch(`${BASE}/subjects/${id}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden des Fachs');
  return data.data as Subject;
}

/**
 * Create a new subject.
 *
 * @param payload - Subject data to persist.
 */
export async function createSubject(payload: SubjectPayload): Promise<Subject> {
  const res = await fetch(`${BASE}/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Erstellen des Fachs');
  return data.data as Subject;
}

/**
 * Update an existing subject.
 *
 * @param id - Subject ID.
 * @param payload - Updated subject data.
 */
export async function updateSubject(id: string, payload: SubjectPayload): Promise<Subject> {
  const res = await fetch(`${BASE}/subjects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Aktualisieren des Fachs');
  return data.data as Subject;
}

/**
 * Delete a subject for the current owner.
 *
 * @param id - Subject ID.
 */
export async function deleteSubject(id: string): Promise<void> {
  const res = await fetch(`${BASE}/subjects/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Löschen des Fachs');
}

export type SubjectClassification = '1day' | 'deep';

export interface SubjectClassificationFactor {
  name: string;
  value: string | number;
  contribution: number;
  rationale: string;
}

export interface SubjectClassificationResponse {
  subject_id: string;
  classification: SubjectClassification;
  factors: SubjectClassificationFactor[];
}

export interface ProfessorRequestTemplateResponse {
  subject_id: string;
  greeting: string;
  intro: string;
  open_question_section: string;
  context_section: string;
  closing: string;
  full_text: string;
  metadata: {
    model: string;
    generated_at: string;
    used_fallback: boolean;
  };
}

/**
 * Load the learning-path classification for one subject.
 *
 * @param id - Subject ID.
 */
export async function fetchSubjectClassification(id: string): Promise<SubjectClassificationResponse> {
  const res = await fetch(`${BASE}/subjects/${id}/classify`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Klassifizieren des Fachs');
  return data.data as SubjectClassificationResponse;
}

export async function generateProfessorRequestTemplate(
  id: string,
  openQuestion: string,
): Promise<ProfessorRequestTemplateResponse> {
  const res = await fetch(`${BASE}/subjects/${id}/request-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openQuestion }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Fehler beim Erzeugen der Anfrage');
  return data.data as ProfessorRequestTemplateResponse;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUBJECT SUBSCRIPTIONS
  // ════════════════════════════════════════════════════════════════════════════

  export interface PublicSubjectListResponse {
    success: boolean;
    count: number;
    total: number;
    data: Subject[];
  }

  /**
   * Load the public subject catalog with pagination and search.
   *
   * @param search - Optional search string.
   * @param limit - Maximum number of rows to return.
   * @param offset - Pagination offset.
   * @param sort - Sort field.
   * @param order - Sort order.
   */
  export async function getPublicSubjects(
    search?: string,
    limit = 20,
    offset = 0,
    sort = 'name',
    order: 'ASC' | 'DESC' = 'ASC',
  ): Promise<PublicSubjectListResponse> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());
    params.append('sort', sort);
    params.append('order', order);

    const res = await fetch(`${BASE}/subjects/public/list?${params.toString()}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Fehler beim Laden der öffentlichen Fächer');
    return data;
  }

  /**
   * Subscribe the current user to a public subject.
   *
   * @param id - Subject ID.
   */
  export async function subscribeToSubject(id: string): Promise<{ id: string; subscribed_at: string }> {
    const res = await fetch(`${BASE}/subjects/${id}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Fehler beim Abonnieren des Fachs');
    return data.data;
  }

  /**
   * Remove only the subscription link; the subject data itself remains stored.
   *
   * @param id - Subject ID.
   */
  export async function unsubscribeFromSubject(id: string): Promise<void> {
    const res = await fetch(`${BASE}/subjects/${id}/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Fehler beim Abmelden vom Fach');
  }

  /** Get all subjects the current user is subscribed to. */
  export async function getMySubscriptions(): Promise<Subject[]> {
    const res = await fetch(`${BASE}/subjects/subscriptions/mine`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Abonnements');
    return data.data as Subject[];
}
