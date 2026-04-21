// API client for /api/explain
// Explainable AI topic priority endpoints

import type { TopicPriorityExplanation } from '../lib/types';

const BASE = '/api';

/**
 * Get topic priorities with explanations for a subject.
 * Returns an empty array if the subject has no topics yet.
 * Throws on network errors or if the subject is not found.
 */
export async function getTopicPriorities(subjectId: string): Promise<TopicPriorityExplanation[]> {
  const res = await fetch(`${BASE}/explain/topic-priority/${subjectId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler beim Laden der Themenpriorisierung');
  return data.data;
}
