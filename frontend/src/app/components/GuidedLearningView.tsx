import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Route, PauseCircle, CheckCircle2, BookOpen, Brain, ShieldAlert, Target } from 'lucide-react';
import {
  getGuidedLearningRoute,
  generateGuidedFlashcards,
  updateGuidedLearningProgress,
} from '../api/assessment';
import type {
  GuidedLearningProgress,
  GuidedLearningResponse,
  GuidedLearningStep,
} from '../api/assessment';

const PHASE_LABELS: Record<GuidedLearningStep['phase'], string> = {
  VERSTEHEN: 'Verstehen',
  ÜBEN: 'Üben',
  TRANSFER: 'Transfer',
  CHECK: 'Check',
};

const PHASE_COLORS: Record<GuidedLearningStep['phase'], string> = {
  VERSTEHEN: 'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/25 dark:text-sky-200 dark:border-sky-800',
  ÜBEN: 'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-200 dark:border-emerald-800',
  TRANSFER: 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/25 dark:text-amber-200 dark:border-amber-800',
  CHECK: 'bg-violet-100 text-violet-900 border-violet-200 dark:bg-violet-900/25 dark:text-violet-200 dark:border-violet-800',
};

const STEP_STATUS_LABELS = {
  completed: 'Abgeschlossen',
  current: 'Aktuell',
  upcoming: 'Nächster Schritt',
};

export function GuidedLearningView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();

  const [response, setResponse] = useState<GuidedLearningResponse | null>(null);
  const [progress, setProgress] = useState<GuidedLearningProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingFlashcardsStep, setGeneratingFlashcardsStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scorePctInput, setScorePctInput] = useState('');

  useEffect(() => {
    const loadRoute = async () => {
      if (!subjectId) {
        setError('Ungültige Fach-ID');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await getGuidedLearningRoute(subjectId);
        setResponse(result);
        setProgress(result.progress);
        setScorePctInput(result.progress.is_completed ? '75' : '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Guided Journey konnte nicht geladen werden');
      } finally {
        setLoading(false);
      }
    };

    loadRoute();
  }, [subjectId]);

  const routeSteps = response?.route.steps ?? [];
  const activeStep = progress?.current_step ?? response?.resume_step ?? 1;
  const completedSteps = useMemo(() => new Set(progress?.completed_steps ?? []), [progress?.completed_steps]);
  const completedCount = progress?.completed_steps?.length ?? 0;
  const progressPercent = routeSteps.length > 0 ? Math.min(100, Math.round((completedCount / routeSteps.length) * 100)) : 0;

  const persistProgress = async (
    options: { currentStep: 1 | 2 | 3 | 4; completedSteps: number[]; scorePct?: number },
  ) => {
    if (!subjectId) return;

    setSaving(true);
    setError(null);

    try {
      const saved = await updateGuidedLearningProgress(subjectId, {
        current_step: options.currentStep,
        completed_steps: options.completedSteps,
        score_pct: options.scorePct,
      });
      setProgress(saved);
      setResponse((prev) => (prev ? { ...prev, progress: saved, resume_step: saved.current_step } : prev));
      if (saved.is_completed) {
        setScorePctInput(String(options.scorePct ?? (scorePctInput || '75')));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fortschritt konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!progress) return;
    await persistProgress({
      currentStep: activeStep,
      completedSteps: progress.completed_steps ?? [],
    });
  };

  const handleCompleteCurrentStep = async () => {
    if (!progress) return;

    const currentStep = activeStep;
    const currentStepDefinition = routeSteps.find((step) => step.step === currentStep);
    const nextStep = Math.min(4, currentStep + 1) as 1 | 2 | 3 | 4;
    const nextCompletedSteps = Array.from(new Set([...(progress.completed_steps ?? []), currentStep])).sort((a, b) => a - b);

    if (currentStepDefinition?.phase === 'CHECK') {
      const parsedScore = Number(scorePctInput);
      if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
        setError('Bitte trage für Schritt 4 einen gültigen Score zwischen 0 und 100 ein.');
        return;
      }

      await persistProgress({
        currentStep: 4,
        completedSteps: Array.from(new Set([...nextCompletedSteps, 4])).sort((a, b) => a - b),
        scorePct: parsedScore,
      });
      return;
    }

    await persistProgress({
      currentStep: nextStep,
      completedSteps: nextCompletedSteps,
    });
  };

  const handleGenerateFlashcards = async (step: GuidedLearningStep) => {
    if (!subjectId || step.step >= 4) return;

    setGeneratingFlashcardsStep(step.step);
    setError(null);

    try {
      const result = await generateGuidedFlashcards(subjectId, step.step);
      navigate(`/flashcards/${subjectId}`, {
        state: {
          fromGuidedLearning: true,
          guidedStep: result.guided_step,
          guidedTitle: result.step_title,
          guidedCurrentStep: activeStep,
          guidedCompletedSteps: Array.from(completedSteps),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guided-Karteikarten konnten nicht generiert werden');
    } finally {
      setGeneratingFlashcardsStep(null);
    }
  };

  const currentStepDefinition = routeSteps.find((step) => step.step === activeStep) ?? routeSteps[0];
  const scoreHint = currentStepDefinition?.phase === 'CHECK'
    ? 'Trage hier dein Testergebnis ein, damit das Fach bei >= 75% als gelernt markiert wird.'
    : 'Du kannst den aktuellen Schritt speichern und später an derselben Stelle fortsetzen.';

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Guided Journey wird geladen…</p>
      </div>
    );
  }

  if (error && !response) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
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
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <button
          onClick={() => navigate(`/subject/${subjectId}`)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>

        <div className="flex items-center gap-3 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          <Route className="w-4 h-4" />
          Guided Journey
          {response?.auto_enabled && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
              <ShieldAlert className="w-3 h-3" />
              Auto-Modus
            </span>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-(--radius) p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold mb-2">Strukturierter Lernpfad</h2>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
              {response?.route.exit_criteria}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Gesamtbudget</p>
            <p className="text-2xl font-bold">{response?.route.total_hours ?? 12} h</p>
          </div>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          <span>{completedCount} von 4 Schritten gespeichert</span>
          <span>Wiederaufnahme bei Schritt {progress?.current_step ?? 1}</span>
        </div>
      </div>

      {response?.auto_enabled && (
        <div className="mb-6 p-4 rounded-(--radius) border border-sky-300 bg-sky-50 text-sky-900">
          Dieser Guided Mode wurde automatisch empfohlen, weil das Fach besonders anspruchsvoll ist oder kein Dozent hinterlegt wurde.
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-(--radius) border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_0.9fr]">
        <div className="space-y-4">
          {routeSteps.map((step) => {
            const isCompleted = completedSteps.has(step.step) || (response?.progress.is_completed && step.step === 4);
            const isCurrent = step.step === activeStep;
            const statusLabel = isCompleted ? STEP_STATUS_LABELS.completed : isCurrent ? STEP_STATUS_LABELS.current : STEP_STATUS_LABELS.upcoming;

            return (
              <article
                key={step.step}
                className={`rounded-(--radius) border bg-card p-5 transition-all ${isCurrent ? 'border-primary shadow-sm' : 'border-border'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${PHASE_COLORS[step.phase]}`}>
                      {PHASE_LABELS[step.phase]}
                    </span>
                    <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                      Schritt {step.step}
                    </span>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${isCompleted ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-200' : isCurrent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {isCompleted ? <CheckCircle2 className="h-3 w-3" /> : <Target className="h-3 w-3" />}
                    {statusLabel}
                  </span>
                </div>

                <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                <p className="mb-4 text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>{step.description}</p>

                <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-secondary-foreground">
                    <BookOpen className="h-3.5 w-3.5" />
                    {step.budget_hours} h
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-secondary-foreground">
                    <Brain className="h-3.5 w-3.5" />
                    {step.estimated_certainty_gain}
                  </span>
                </div>

                {step.linked_topics.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {step.linked_topics.map((topic) => (
                      <span key={topic} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                        {topic}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mb-4 rounded-(--radius) border border-border bg-accent/50 p-4">
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Aktion</p>
                  <p className="mt-1" style={{ fontSize: 'var(--text-base)' }}>{step.action}</p>
                </div>

                {isCurrent && (
                  <div className="flex flex-wrap gap-3">
                    {step.step < 4 && (
                      <button
                        onClick={() => handleGenerateFlashcards(step)}
                        disabled={saving || generatingFlashcardsStep === step.step}
                        className="inline-flex items-center gap-2 rounded-(--radius) bg-secondary px-4 py-2 text-secondary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        <Brain className="h-4 w-4" />
                        {generatingFlashcardsStep === step.step ? 'Generiere...' : 'Karteikarten für diesen Schritt'}
                      </button>
                    )}
                    <button
                      onClick={handleCompleteCurrentStep}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-(--radius) bg-primary px-4 py-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {step.phase === 'CHECK' ? 'Testergebnis speichern' : 'Schritt abschließen'}
                    </button>
                    <button
                      onClick={handlePause}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-(--radius) bg-secondary px-4 py-2 text-secondary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <PauseCircle className="h-4 w-4" />
                      Pause speichern
                    </button>
                    {step.phase !== 'CHECK' && (
                      <button
                        onClick={() => navigate(`/assessment/${subjectId}`, {
                          state: {
                            fromGuidedLearning: true,
                            guidedCurrentStep: activeStep,
                            guidedCompletedSteps: Array.from(completedSteps),
                          },
                        })}
                        className="inline-flex items-center gap-2 rounded-(--radius) bg-muted px-4 py-2 text-muted-foreground transition-opacity hover:opacity-90"
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        <BookOpen className="h-4 w-4" />
                        Zum Test wechseln
                      </button>
                    )}
                  </div>
                )}

                {isCurrent && step.phase === 'CHECK' && (
                  <div className="mt-4 grid gap-3 rounded-(--radius) border border-border bg-background p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="block">
                      <span className="mb-2 block text-sm text-muted-foreground">Erreichte Prozent</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={scorePctInput}
                        onChange={(event) => setScorePctInput(event.target.value)}
                        className="w-full rounded-(--radius) border border-border bg-background px-3 py-2"
                        placeholder="z. B. 78"
                      />
                    </label>
                    <p className="text-sm text-muted-foreground">{scoreHint}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <aside className="space-y-4">
          <div className="rounded-(--radius) border border-border bg-card p-5">
            <h3 className="mb-3 text-lg font-semibold">Resume-State</h3>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Du kannst jederzeit an der gespeicherten Stelle fortsetzen. Der aktuelle Stand wird pro Nutzer und Fach gespeichert.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Aktueller Schritt</span>
                <span>{activeStep}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Abgeschlossen</span>
                <span>{completedCount}/4</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <span>{progress?.is_completed ? 'Gelernt' : 'In Arbeit'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-(--radius) border border-border bg-card p-5">
            <h3 className="mb-3 text-lg font-semibold">Nächster Fokus</h3>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              {currentStepDefinition?.action || 'Keine Aktion verfügbar'}
            </p>
            <button
              onClick={() => navigate(`/assessment/${subjectId}`, {
                state: {
                  fromGuidedLearning: true,
                  guidedCurrentStep: activeStep,
                  guidedCompletedSteps: Array.from(completedSteps),
                },
              })}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-(--radius) bg-secondary px-4 py-2 text-secondary-foreground transition-opacity hover:opacity-90"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              <Route className="h-4 w-4" />
              Einstufungstest öffnen
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
