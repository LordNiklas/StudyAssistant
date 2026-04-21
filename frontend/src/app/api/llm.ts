// Real API client for /api/llm
// These functions call the actual Study Assistant backend.

const BASE = '/api';

export interface LlmResponse {
  answer: string;
  sourceDocuments: Array<{ id: string; name: string }>;
  applied_learning_style?: 'visual' | 'analytical' | 'practical' | 'mixed';
}

export async function queryLlm(query: string, subjectId?: string): Promise<LlmResponse> {
  const res = await fetch(`${BASE}/llm/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, subjectId: subjectId || undefined }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Fehler bei der KI-Anfrage');
  return {
    answer: data.answer,
    sourceDocuments: data.sourceDocuments || [],
    applied_learning_style: data.applied_learning_style,
  };
}
