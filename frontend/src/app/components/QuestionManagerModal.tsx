import { useState, useEffect } from 'react';
import { X, Trash2, Plus, Bot, User, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getQuestions,
  createQuestion,
  deleteQuestion,
  type ManagedQuestion,
  type QuestionPayload,
} from '../api/assessment';

interface Props {
  subjectId: string;
  subjectName: string;
  onClose: () => void;
}

const EMPTY_FORM: QuestionPayload = {
  question: '',
  options: ['', '', '', ''],
  correct_index: 0,
  topic: '',
  explanation: '',
};

export function QuestionManagerModal({ subjectId, subjectName, onClose }: Props) {
  const [questions, setQuestions] = useState<ManagedQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<QuestionPayload>({ ...EMPTY_FORM, options: ['', '', '', ''] });
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadQuestions();
  }, [subjectId]);

  async function loadQuestions() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getQuestions(subjectId);
      setQuestions(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(questionId: string) {
    if (!confirm('Frage wirklich löschen?')) return;
    try {
      await deleteQuestion(questionId);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.question.trim()) { setFormError('Fragetext darf nicht leer sein.'); return; }
    if (form.options.some((o) => !o.trim())) { setFormError('Alle 4 Antwortoptionen müssen ausgefüllt sein.'); return; }

    setIsSaving(true);
    try {
      const created = await createQuestion(subjectId, {
        ...form,
        options: form.options as [string, string, string, string],
      });
      setQuestions((prev) => [created, ...prev]);
      setForm({ ...EMPTY_FORM, options: ['', '', '', ''] });
      setIsFormOpen(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  function updateOption(index: number, value: string) {
    setForm((prev) => {
      const options = [...prev.options] as [string, string, string, string];
      options[index] = value;
      return { ...prev, options };
    });
  }

  const aiCount = questions.filter((q) => !q.is_manual).length;
  const manualCount = questions.filter((q) => q.is_manual).length;

  // Unique, non-empty topics from already loaded questions – used for datalist suggestions
  const uniqueTopics = Array.from(
    new Set(questions.map((q) => q.topic).filter((t): t is string => !!t && t.trim() !== ''))
  ).sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-2xl h-[80vh] bg-background border border-border rounded-(--radius) shadow-xl flex flex-col">
        {/* Header – Fixed */}
        <div className="flex items-center justify-between p-6 border-b border-border shrink-0">
          <div>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>Testfragen verwalten</h2>
            <p className="text-muted-foreground mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              {subjectName} · {aiCount} KI-Fragen · {manualCount} manuelle Fragen
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-(--radius) hover:bg-secondary transition-colors"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content – Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
          {/* Add question toggle */}
          <button
            onClick={() => setIsFormOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-primary/10 border border-primary/30 rounded-(--radius) hover:bg-primary/20 transition-colors"
            style={{ fontSize: 'var(--text-base)' }}
          >
            <span className="flex items-center gap-2 text-primary font-medium">
              <Plus className="w-4 h-4" />
              Manuelle Frage hinzufügen
            </span>
            {isFormOpen ? <ChevronUp className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />}
          </button>

          {/* Add question form */}
          {isFormOpen && (
            <form
              onSubmit={handleCreate}
              className="border border-border rounded-(--radius) p-4 space-y-4 bg-card"
            >
              {formError && (
                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-(--radius)">
                  {formError}
                </p>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Fragetext *</label>
                <textarea
                  rows={2}
                  required
                  className="w-full px-3 py-2 border border-border rounded-(--radius) bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  style={{ fontSize: 'var(--text-sm)' }}
                  value={form.question}
                  onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))}
                  placeholder="Was ist...?"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium">Antwortoptionen * (richtige Antwort auswählen)</label>
                {form.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct_index"
                      checked={form.correct_index === i}
                      onChange={() => setForm((p) => ({ ...p, correct_index: i }))}
                      className="accent-primary"
                      aria-label={`Option ${String.fromCharCode(65 + i)} als richtige Antwort markieren`}
                    />
                    <span className="text-muted-foreground text-sm w-4">{String.fromCharCode(65 + i)}:</span>
                    <input
                      type="text"
                      required
                      className="flex-1 px-3 py-1.5 border border-border rounded-(--radius) bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      style={{ fontSize: 'var(--text-sm)' }}
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    />
                  </div>
                ))}
              </div>

              {/* Datalist for topic suggestions */}
              <datalist id="topic-suggestions">
                {uniqueTopics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Thema
                    {uniqueTopics.length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        ({uniqueTopics.length} Vorschläge verfügbar)
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    list="topic-suggestions"
                    className="w-full px-3 py-2 border border-border rounded-(--radius) bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    style={{ fontSize: 'var(--text-sm)' }}
                    value={form.topic}
                    onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))}
                    placeholder="z. B. Netzwerkprotokolle"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Erklärung (zur richtigen Antwort)</label>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2 border border-border rounded-(--radius) bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                    style={{ fontSize: 'var(--text-sm)' }}
                    value={form.explanation}
                    onChange={(e) => setForm((p) => ({ ...p, explanation: e.target.value }))}
                    placeholder="Kurze Begründung…"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsFormOpen(false); setFormError(null); setForm({ ...EMPTY_FORM, options: ['', '', '', ''] }); }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  {isSaving ? 'Speichern…' : 'Frage speichern'}
                </button>
              </div>
            </form>
          )}

          {/* Question list */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-red-500 text-sm text-center py-4">{error}</p>
          ) : questions.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              Noch keine Fragen vorhanden. Starte einen Einstufungstest, um KI-Fragen zu generieren, oder füge manuelle Fragen hinzu.
            </p>
          ) : (
            <ul className="space-y-2">
              {questions.map((q) => (
                <li key={q.id} className="flex items-start gap-3 p-4 border border-border rounded-(--radius) bg-card">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          q.is_manual
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                        }`}
                      >
                        {q.is_manual ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                        {q.is_manual ? 'Manuell' : 'KI'}
                      </span>
                      {q.topic && (
                        <span className="text-xs text-muted-foreground truncate">{q.topic}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium line-clamp-2">{q.question}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Richtig: {q.options[q.correct_index]}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-(--radius) transition-colors"
                    aria-label="Frage löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
