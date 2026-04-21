// Real API client for /api/documents
// These functions call the actual Study Assistant backend.

import type { ApiDocument } from '../lib/types';

const BASE = '/api';

/**
 * Load all documents for one subject.
 *
 * @param subjectId - Subject ID.
 */
export async function fetchDocuments(subjectId: string): Promise<ApiDocument[]> {
  const res = await fetch(`${BASE}/documents/subject/${subjectId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Laden der Dokumente');
  return data.data as ApiDocument[];
}

/**
 * Upload a document to a subject.
 *
 * @param subjectId - Subject ID.
 * @param file - File to upload.
 */
export async function uploadDocument(subjectId: string, file: File): Promise<ApiDocument> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/documents/${subjectId}`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Hochladen des Dokuments');
  return data.data as ApiDocument;
}

/**
 * Delete one document.
 *
 * @param id - Document ID.
 */
export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${BASE}/documents/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler beim Löschen des Dokuments');
}
