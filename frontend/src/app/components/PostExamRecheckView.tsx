import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, CheckCircle2, ClipboardList, Sparkles } from 'lucide-react';
import {
  getPostExamCatalog,
  submitPostExamReview,
  type LearningStyle,
  type PostExamCatalogItem,
  type PostExamSubmitItem,
} from '../api/assessment';
import { getGradeClassName } from '../lib/mockData';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
};

function toBooleanValue(value: string): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function hasTrimmedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function PostExamRecheckView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();

  const [items, setItems] = useState<PostExamCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');
  const [result, setResult] = useState<{
    session_id: string;
    score: number;
    total: number;
    score_pct: number;
    grade_prognosis: number;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!subjectId) return;
      setIsLoading(true);
      setError(null);
      try {
        const catalog = await getPostExamCatalog(subjectId);
        setItems(catalog.items);
        if (catalog.applied_learning_style) setActiveStyle(catalog.applied_learning_style);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden des Re-Check-Katalogs');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [subjectId]);

  const isComplete = useMemo(
    () =>
      items.length > 0 &&
      items.every(
        (item) =>
          hasTrimmedText(item.topic)
          && hasTrimmedText(item.question_text)
          && hasTrimmedText(item.expected_answer)
          && item.came_up_in_exam !== null
          && item.was_correct !== null
          && item.confidence !== null,
      ),
    [items],
  );

  const updateItem = (index: number, patch: Partial<PostExamCatalogItem>) => {
    setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async () => {
    if (!subjectId || !isComplete) return;

    const payload: PostExamSubmitItem[] = items.map((item) => ({
      topic: item.topic.trim(),
      question_text: item.question_text.trim(),
      expected_answer: item.expected_answer.trim(),
      came_up_in_exam: item.came_up_in_exam as boolean,
      was_correct: item.was_correct as boolean,
      confidence: item.confidence as 'low' | 'medium' | 'high',
      source: item.source,
    }));

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await submitPostExamReview(subjectId, payload);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern des Re-Checks');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Re-Check-Katalog wird vorbereitet...</p>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive mb-4">{error}</p>
        <button
          onClick={() => navigate(`/subject/${subjectId}`)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius)"
        >
          Zurück zum Fach
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={() => navigate(`/subject/${subjectId}`)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>
        <h2 className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5" />
          Post-Klausur-Re-Check
        </h2>
      </div>

      {result && (
        <div className="bg-card border border-border rounded-(--radius) p-5 mb-6">
          <h3 className="mb-3 flex items-center gap-2" style={{ fontSize: 'var(--text-lg)' }}>
            <CheckCircle2 className="w-5 h-5 text-[rgb(34,197,94)]" />
            Re-Check gespeichert
          </h3>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="px-3 py-1 rounded-sm bg-secondary text-secondary-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              {result.score}/{result.total}
            </span>
            <span className="px-3 py-1 rounded-sm bg-secondary text-secondary-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              {result.score_pct}%
            </span>
            <span className={`px-3 py-1 rounded-sm ${getGradeClassName(result.grade_prognosis)}`} style={{ fontSize: 'var(--text-sm)' }}>
              Note {result.grade_prognosis}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/result/${subjectId}`, { state: { sessionId: result.session_id } })}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
              style={{ fontSize: 'var(--text-base)' }}
            >
              Ergebnis ansehen
            </button>
            <button
              onClick={() => navigate(`/subject/${subjectId}`)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
              style={{ fontSize: 'var(--text-base)' }}
            >
              Zurück zum Fach
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-(--radius) border border-destructive/40 bg-destructive/10 text-destructive" style={{ fontSize: 'var(--text-base)' }}>
          {error}
        </div>
      )}

      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={index} className="bg-card border border-border rounded-(--radius) p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
                Re-Check Punkt {index + 1}
              </h3>
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm ${item.source === 'ai' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {item.source === 'ai' ? <Sparkles className="w-3 h-3" /> : null}
                {item.source === 'ai' ? 'KI-Vorschlag' : 'Standardfrage'}
              </span>
            </div>

            <label className="block mb-4">
              <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Thema</span>
              <input
                value={item.topic}
                onChange={(e) => updateItem(index, { topic: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              />
            </label>

            <label className="block mb-3">
              <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Frage</span>
              <textarea
                value={item.question_text}
                onChange={(e) => updateItem(index, { question_text: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              />
            </label>

            <label className="block mb-4">
              <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Erwartete Antwort</span>
              <textarea
                value={item.expected_answer}
                onChange={(e) => updateItem(index, { expected_answer: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Kam in der Klausur dran?*</span>
                <select
                  value={item.came_up_in_exam === null ? '' : String(item.came_up_in_exam)}
                  onChange={(e) => updateItem(index, { came_up_in_exam: toBooleanValue(e.target.value) })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
                >
                  <option value="">Bitte wählen</option>
                  <option value="true">Ja</option>
                  <option value="false">Nein</option>
                </select>
              </label>

              <label className="block">
                <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Richtig beantwortet?*</span>
                <select
                  value={item.was_correct === null ? '' : String(item.was_correct)}
                  onChange={(e) => updateItem(index, { was_correct: toBooleanValue(e.target.value) })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
                >
                  <option value="">Bitte wählen</option>
                  <option value="true">Ja</option>
                  <option value="false">Nein</option>
                </select>
              </label>

              <label className="block">
                <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Sicherheit*</span>
                <select
                  value={item.confidence ?? ''}
                  onChange={(e) => updateItem(index, { confidence: (e.target.value || null) as PostExamCatalogItem['confidence'] })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
                >
                  <option value="">Bitte wählen</option>
                  <option value="low">Unsicher</option>
                  <option value="medium">Teilweise sicher</option>
                  <option value="high">Sicher</option>
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={() => navigate(`/subject/${subjectId}`)}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          Abbrechen
        </button>
        <button
          onClick={handleSubmit}
          disabled={!isComplete || isSubmitting}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontSize: 'var(--text-base)' }}
        >
          {isSubmitting ? 'Speichern...' : 'Re-Check speichern'}
        </button>
      </div>
    </div>
  );
}
