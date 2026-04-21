import { useState, useEffect } from 'react';
import { Send } from 'lucide-react';
import { fetchSubjectsByFilter } from '../api/subjects';
import { queryLlm } from '../api/llm';
import type { Subject } from '../lib/types';

const LEARNING_STYLE_LABEL = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
} as const;

export function LlmView() {
  const [query, setQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sourceDocuments, setSourceDocuments] = useState<Array<{ id: string; name: string }>>([]);
  const [hasResponse, setHasResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedStyle, setAppliedStyle] = useState<keyof typeof LEARNING_STYLE_LABEL>('mixed');

  // Load subjects for the filter dropdown from the real API
  const [subjects, setSubjects] = useState<Subject[]>([]);
  useEffect(() => {
    fetchSubjectsByFilter('all')
      .then(setSubjects)
      .catch(() => {
        // Non-critical – dropdown just stays empty
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setHasResponse(true);
    setAnswer('');
    setSourceDocuments([]);
    setError(null);

    try {
      // Real API call to the LLM backend
      const result = await queryLlm(query, selectedSubject || undefined);
      setAnswer(result.answer);
      setSourceDocuments(result.sourceDocuments);
      if (result.applied_learning_style) {
        setAppliedStyle(result.applied_learning_style);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setAnswer('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2 className="mb-6 text-xl">Frage stellen</h2>

      {/* Input Card */}
      <div className="bg-card border border-border rounded-(--radius) p-6 mb-6">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="llm-query" className="block mb-2">
              Deine Frage
            </label>
            <textarea
              id="llm-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              placeholder="Stelle eine Frage zu deinen Dokumenten…"
              className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ fontSize: 'var(--text-base)' }}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="llm-subject" className="block mb-2">
              Fach filtern (Optional)
            </label>
            <select
              id="llm-subject"
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ fontSize: 'var(--text-base)' }}
            >
              <option value="">Alle Fächer</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ fontSize: 'var(--text-base)' }}
          >
            <Send className="w-4 h-4" />
            Frage absenden
          </button>
        </form>
      </div>

      {/* Response Section */}
      {hasResponse && (
        <div>
          <h4 className="mb-4">Antwort</h4>

          <div className="bg-card border border-border rounded-(--radius) p-6 mb-6">
            {isLoading ? (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                  Denke nach…
                </p>
              </div>
            ) : error ? (
              <p className="text-destructive" style={{ fontSize: 'var(--text-base)' }}>
                Fehler: {error}
              </p>
            ) : (
              <div className="whitespace-pre-wrap" style={{ fontSize: 'var(--text-base)' }}>
                {answer}
              </div>
            )}
          </div>

          {!isLoading && !error && sourceDocuments.length > 0 && (
            <div>
              <h4 className="mb-4">Quelldokumente</h4>
              <div className="space-y-2">
                {sourceDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="w-full bg-card border border-border rounded-(--radius) p-4 text-left"
                    style={{ fontSize: 'var(--text-base)' }}
                  >
                    {doc.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isLoading && !error && sourceDocuments.length === 0 && answer && (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
              Keine Quelldokumente wurden verwendet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
