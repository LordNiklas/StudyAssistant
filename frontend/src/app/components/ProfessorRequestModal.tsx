import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import {
  generateProfessorRequestTemplate,
  type ProfessorRequestTemplateResponse,
} from '../api/subjects';

interface Props {
  subjectId: string;
  subjectName: string;
  onClose: () => void;
}

export function ProfessorRequestModal({ subjectId, subjectName, onClose }: Props) {
  const [openQuestion, setOpenQuestion] = useState('');
  const [result, setResult] = useState<ProfessorRequestTemplateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canGenerate = openQuestion.trim().length > 0 && !isLoading;

  async function handleGenerate() {
    setError(null);
    setCopied(false);

    if (!openQuestion.trim()) {
      setError('Bitte gib zuerst eine konkrete Frage ein.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await generateProfessorRequestTemplate(subjectId, openQuestion.trim());
      setResult(data);
    } catch (err) {
      setError((err as Error).message || 'Fehler beim Generieren der Anfrage.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy() {
    if (!result?.full_text) return;

    try {
      await navigator.clipboard.writeText(result.full_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Konnte den Text nicht in die Zwischenablage kopieren.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-3xl h-[80vh] bg-background border border-border rounded-(--radius) shadow-xl flex flex-col">
        {/* Header – Fixed */}
        <div className="flex items-center justify-between p-6 border-b border-border shrink-0">
          <div>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>Professor-Anfragegenerator</h2>
            <p className="text-muted-foreground mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              {subjectName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-(--radius) hover:bg-secondary transition-colors"
            aria-label="Schliessen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content – Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
          <div className="bg-accent border border-border rounded-(--radius) p-4">
            <p style={{ fontSize: 'var(--text-sm)' }}>
              Formuliere hier deine offene Frage. Das System erstellt daraus eine hoefliche E-Mail-Vorlage.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Offene Frage</label>
            <textarea
              rows={4}
              value={openQuestion}
              onChange={(e) => setOpenQuestion(e.target.value)}
              placeholder="z. B. Wird Kapitel 5 in der Klausur abgefragt?"
              className="w-full px-3 py-2 border border-border rounded-(--radius) bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              style={{ fontSize: 'var(--text-base)' }}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontSize: 'var(--text-base)' }}
            >
              {isLoading ? 'Generiere...' : 'Vorlage generieren'}
            </button>

            {result && (
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                style={{ fontSize: 'var(--text-base)' }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Kopiert' : 'Text kopieren'}
              </button>
            )}
          </div>

          {error && (
            <p className="text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-(--radius)" style={{ fontSize: 'var(--text-sm)' }}>
              {error}
            </p>
          )}

          {result && (
            <div className="border border-border rounded-(--radius) p-4 bg-card space-y-3">
              <div>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>Anrede</p>
                <p style={{ fontSize: 'var(--text-base)' }}>{result.greeting}</p>
              </div>
              <div>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>Einleitung</p>
                <p style={{ fontSize: 'var(--text-base)' }}>{result.intro}</p>
              </div>
              <div>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>Frage</p>
                <p style={{ fontSize: 'var(--text-base)' }}>{result.open_question_section}</p>
              </div>
              <div>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>Kontext</p>
                <p style={{ fontSize: 'var(--text-base)' }}>{result.context_section}</p>
              </div>
              <div>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>Abschluss</p>
                <p style={{ fontSize: 'var(--text-base)' }}>{result.closing}</p>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Modell: {result.metadata.model} {result.metadata.used_fallback ? '(Fallback)' : ''}
                </p>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
