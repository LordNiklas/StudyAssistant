import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { ArrowLeft, RotateCcw, CheckCircle2, XCircle, AlertCircle, ChevronDown } from 'lucide-react';
import * as Accordion from '@radix-ui/react-accordion';
import { getGradeClassName, getGradeRecommendation } from '../lib/mockData';
import { getPostExamReviewBySession, getSession, updateGuidedLearningProgress } from '../api/assessment';
import type { Question, QuestionResult } from '../lib/types';

export function ResultView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const state = (location.state ?? {}) as {
    questions?: Question[];
    answers?: number[];
    result?: { score: number; total: number; score_pct: number; grade_prognosis: number };
    sessionId?: string;
    fromGuidedLearning?: boolean;
    guidedCurrentStep?: number;
    guidedCompletedSteps?: number[];
  };

  // State for async session loading (history view)
  const [sessionData, setSessionData] = useState<{
    score: number; total: number; score_pct: number; grade_prognosis: number;
    questionResults: QuestionResult[];
  } | null>(null);
  const [postExamReview, setPostExamReview] = useState<{
    reviewId: string;
    items: {
      id: string;
      topic: string;
      question_text: string;
      expected_answer: string;
      came_up_in_exam: boolean;
      was_correct: boolean;
      confidence: 'low' | 'medium' | 'high';
      source: 'standard' | 'ai';
    }[];
  } | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guidedSyncPending, setGuidedSyncPending] = useState(false);
  const [guidedSyncError, setGuidedSyncError] = useState<string | null>(null);
  const [guidedSyncDone, setGuidedSyncDone] = useState(false);

  useEffect(() => {
    const sessionId = state.sessionId;
    if (!sessionId) return;
    setLoadingSession(true);
    getSession(sessionId)
      .then(({ session, questionResults }) => {
        setSessionData({
          score: session.score,
          total: session.total,
          score_pct: session.score_pct,
          grade_prognosis: session.grade_prognosis,
          questionResults,
        });

        if (questionResults.length === 0) {
          return getPostExamReviewBySession(sessionId)
            .then((reviewData) => {
              setPostExamReview({
                reviewId: reviewData.review.id,
                items: reviewData.items.map((item) => ({
                  id: item.id,
                  topic: item.topic,
                  question_text: item.question_text,
                  expected_answer: item.expected_answer,
                  came_up_in_exam: item.came_up_in_exam,
                  was_correct: item.was_correct,
                  confidence: item.confidence,
                  source: item.source,
                })),
              });
            })
            .catch(() => setPostExamReview(null));
        }

        setPostExamReview(null);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingSession(false));
  }, [state.sessionId]);

  // Build results from fresh state (immediate after test) or from loaded session
  const results = useMemo(() => {
    // History view: data loaded from API
    if (state.sessionId) {
      if (!sessionData) return null;
      if (sessionData.questionResults.length === 0 && postExamReview) {
        return { ...sessionData, weaknesses: [] };
      }

      const weaknesses = sessionData.questionResults
        .filter((r) => !r.isCorrect && r.question.topic)
        .map((r) => r.question.topic)
        .filter((t, i, self) => self.indexOf(t) === i)
        .slice(0, 3);
      return { ...sessionData, weaknesses };
    }

    // Fresh test: built from state
    const { questions, answers } = state;
    if (!questions || !answers) return null;

    const questionResults: QuestionResult[] = questions.map((q, index) => ({
      question: q,
      selectedIndex: answers[index],
      isCorrect: answers[index] === q.correct_index,
    }));

    const score = questionResults.filter((r) => r.isCorrect).length;
    const total = questions.length;
    const score_pct = Math.round((score / total) * 100);

    let grade_prognosis = 5;
    if (score_pct >= 90) grade_prognosis = 1;
    else if (score_pct >= 75) grade_prognosis = 2;
    else if (score_pct >= 60) grade_prognosis = 3;
    else if (score_pct >= 50) grade_prognosis = 4;

    const weaknesses = questionResults
      .filter((r) => !r.isCorrect && r.question.topic)
      .map((r) => r.question.topic)
      .filter((topic, index, self) => self.indexOf(topic) === index)
      .slice(0, 3);

    return { score, total, score_pct, grade_prognosis, questionResults, weaknesses };
  }, [state, sessionData, postExamReview]);

  const isGuidedFlow = Boolean(state.fromGuidedLearning) && !state.sessionId;

  useEffect(() => {
    if (!subjectId || !isGuidedFlow || guidedSyncDone || guidedSyncPending || !results) return;

    let isMounted = true;
    const syncGuidedProgress = async () => {
      setGuidedSyncPending(true);
      setGuidedSyncError(null);

      try {
        const previousSteps = Array.isArray(state.guidedCompletedSteps) ? state.guidedCompletedSteps : [];
        const normalizedPrevious = [...new Set(previousSteps
          .map((step) => Number(step))
          .filter((step) => Number.isFinite(step) && step >= 1 && step <= 4))].sort((a, b) => a - b);

        const shouldCloseStepFour = results.score_pct >= 75;
        const completedSteps = shouldCloseStepFour
          ? [...new Set([...normalizedPrevious, 4])].sort((a, b) => a - b)
          : normalizedPrevious;

        await updateGuidedLearningProgress(subjectId, {
          current_step: 4,
          completed_steps: completedSteps,
          score_pct: results.score_pct,
        });

        if (!isMounted) return;
        setGuidedSyncDone(true);
      } catch (err) {
        if (!isMounted) return;
        setGuidedSyncError(err instanceof Error ? err.message : 'Guided-Fortschritt konnte nicht synchronisiert werden');
      } finally {
        if (!isMounted) return;
        setGuidedSyncPending(false);
      }
    };

    syncGuidedProgress();

    return () => {
      isMounted = false;
    };
  }, [
    guidedSyncDone,
    guidedSyncPending,
    isGuidedFlow,
    results,
    state.guidedCompletedSteps,
    subjectId,
  ]);

  if (loadingSession) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Ergebnis wird geladen…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive mb-4">{loadError}</p>
        <button onClick={() => navigate(`/subject/${subjectId}`)} className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius)">
          Zurück zum Fach
        </button>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Keine Ergebnisse verfügbar</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius)"
        >
          Zurück zur Übersicht
        </button>
      </div>
    );
  }

  const progressBarColor =
    results.score_pct >= 75
      ? 'bg-[rgb(34,197,94)]'
      : results.score_pct >= 50
        ? 'bg-[rgb(234,179,8)]'
        : 'bg-destructive';
  const guidedStep4Passed = results.score_pct >= 75;

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <button
          onClick={() => navigate(isGuidedFlow ? `/guided-learning/${subjectId}` : `/subject/${subjectId}`)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          {isGuidedFlow ? 'Zurück zur Guided Journey' : 'Zurück zum Fach'}
        </button>
        <button
          onClick={() => navigate(`/assessment/${subjectId}`, {
            state: isGuidedFlow
              ? {
                fromGuidedLearning: true,
                guidedCurrentStep: 4,
                guidedCompletedSteps: state.guidedCompletedSteps ?? [],
              }
              : undefined,
          })}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <RotateCcw className="w-4 h-4" />
          Test wiederholen
        </button>
      </div>

      {isGuidedFlow && (
        <div className="mb-6 rounded-(--radius) border border-sky-300 bg-sky-50 p-4 text-sky-900">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sky-900" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>
              Guided Step 4:
            </span>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 ${guidedStep4Passed ? 'bg-[rgb(34,197,94)] text-white' : 'bg-destructive text-destructive-foreground'}`}
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {guidedStep4Passed ? 'Bestanden' : 'Nicht bestanden'}
            </span>
            <span className="text-sky-900/80" style={{ fontSize: 'var(--text-xs)' }}>
              (Schwelle: 75%)
            </span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)' }}>
            {guidedSyncPending && 'Synchronisiere Ergebnis mit der Guided Journey...'}
            {!guidedSyncPending && !guidedSyncError && guidedSyncDone && 'Ergebnis wurde in Schritt 4 der Guided Journey übernommen.'}
            {guidedSyncError && `Synchronisierung fehlgeschlagen: ${guidedSyncError}`}
          </p>
        </div>
      )}

      {/* Score and Grade Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Score Card */}
        <div className="bg-card border border-border rounded-(--radius) p-6">
          <div className="text-center">
            <div
              className="mb-2"
              style={{ fontSize: 'var(--text-6xl)', fontWeight: 'var(--font-weight-bold)' }}
            >
              {results.score}/{results.total}
            </div>
            <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
              Fragen richtig beantwortet
            </p>
            <div className="mb-2">
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${progressBarColor} transition-all`}
                  style={{ width: `${results.score_pct}%` }}
                />
              </div>
            </div>
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              {results.score_pct}%
            </span>
          </div>
        </div>

        {/* Grade Card */}
        <div className="bg-card border border-border rounded-(--radius) p-6">
          <div className="text-center">
            <div className="mb-3">
              <span
                className={`inline-block px-6 py-3 rounded-(--radius) ${getGradeClassName(
                  results.grade_prognosis,
                )}`}
                style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 'var(--font-weight-semi-bold)',
                }}
              >
                Note {results.grade_prognosis}
              </span>
            </div>
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
              📊 Aktuelle Prognose
            </p>
            <p className="text-muted-foreground mt-2" style={{ fontSize: 'var(--text-sm)' }}>
              {getGradeRecommendation(results.grade_prognosis)}
            </p>
          </div>
        </div>
      </div>

      {/* Weaknesses Section */}
      {results.weaknesses.length > 0 && (
        <div className="mb-8">
          <h3
            className="flex items-center gap-2 mb-4"
            style={{ fontSize: 'var(--text-lg)' }}
          >
            <AlertCircle className="w-5 h-5 text-amber-400" />
            Identifizierte Schwachstellen
          </h3>
          <div className="flex flex-wrap gap-3">
            {results.weaknesses.map((topic, index) => (
              <span
                key={index}
                className="px-4 py-2 bg-amber-400/15 border border-amber-400 text-[rgb(30,30,30)] rounded-(--radius)"
                style={{ fontSize: 'var(--text-base)' }}
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Questions Review */}
      <div>
        <h3 className="mb-4" style={{ fontSize: 'var(--text-lg)' }}>
          📋 Fragenübersicht
        </h3>

        {postExamReview && postExamReview.items.length > 0 ? (
          <div className="space-y-3">
            {postExamReview.items.map((item, index) => {
              const cameUp = item.came_up_in_exam ? 'Ja' : 'Nein';
              const wasCorrect = item.was_correct ? 'Ja' : 'Nein';
              return (
                <div
                  key={item.id}
                  className="bg-card border border-border rounded-(--radius) p-4"
                >
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <h4 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
                      Re-Check Punkt {index + 1}: {item.topic}
                    </h4>
                    <span className={`px-3 py-1 rounded-sm ${item.source === 'ai' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`} style={{ fontSize: 'var(--text-sm)' }}>
                      {item.source === 'ai' ? 'KI-Vorschlag' : 'Standardfrage'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>Frage</p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>{item.question_text}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>Erwartete Antwort</p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>{item.expected_answer}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>Kam in der Klausur dran?</p>
                      <p style={{ fontSize: 'var(--text-base)' }}>{cameUp}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>Richtig beantwortet?</p>
                      <p style={{ fontSize: 'var(--text-base)' }}>{wasCorrect}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>Sicherheit</p>
                      <p style={{ fontSize: 'var(--text-base)' }}>{item.confidence}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <Accordion.Root type="single" collapsible className="space-y-3">
          {results.questionResults.map((result, index) => {
            const isCorrect = result.isCorrect;
            const borderColor = isCorrect
              ? 'border-l-4 border-l-emerald-500/45'
              : 'border-l-4 border-l-destructive/45';
            const bgColor = isCorrect
              ? 'bg-emerald-500/12'
              : 'bg-destructive/12';
            const bgHoverColor = isCorrect
              ? 'hover:bg-emerald-500/20'
              : 'hover:bg-destructive/20';

            return (
              <Accordion.Item
                key={index}
                value={`question-${index}`}
                className={`bg-card border border-border rounded-(--radius) overflow-hidden ${borderColor}`}
              >
                <Accordion.Trigger
                  className={`group w-full px-4 py-4 flex items-center justify-between transition-colors ${bgColor} ${bgHoverColor} cursor-pointer`}
                >
                  <div className="flex items-center gap-3 flex-1 text-left">
                    {isCorrect ? (
                      <CheckCircle2 className="w-5 h-5 text-[rgb(34,197,94)] shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive shrink-0" />
                    )}
                    <span style={{ fontSize: 'var(--text-base)' }}>
                      {result.question.question}
                    </span>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-sm ml-4 shrink-0 ${
                      isCorrect
                      ? 'bg-[rgb(34,197,94)] text-white'
                      : 'bg-destructive text-destructive-foreground'
                    }`}
                    style={{ fontSize: 'var(--text-sm)' }}
                  >
                    {isCorrect ? 'Richtig' : 'Falsch'}
                  </span>
                  <ChevronDown className="w-4 h-4 ml-4 text-primary transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </Accordion.Trigger>
                <Accordion.Content className="px-4 py-4 border-t border-border">
                  <div className="space-y-3">
                    <div>
                      <p
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--font-weight-semi-bold)',
                        }}
                      >
                        Deine Antwort:
                      </p>
                      <p
                        className={isCorrect ? 'text-[rgb(34,197,94)]' : 'text-destructive'}
                        style={{ fontSize: 'var(--text-base)' }}
                      >
                        {result.question.options[result.selectedIndex]}{' '}
                        {isCorrect ? '✓' : '✗'}
                      </p>
                    </div>
                    {!isCorrect && (
                      <div>
                        <p
                          style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-weight-semi-bold)',
                          }}
                        >
                          Richtige Antwort:
                        </p>
                        <p className="text-[rgb(34,197,94)]" style={{ fontSize: 'var(--text-base)' }}>
                          {result.question.options[result.question.correct_index]} ✓
                        </p>
                      </div>
                    )}
                    <div>
                      <p
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--font-weight-semi-bold)',
                        }}
                      >
                        Erklärung:
                      </p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                        {result.question.explanation}
                      </p>
                    </div>
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            );
          })}
        </Accordion.Root>
        )}
      </div>
    </div>
  );
}
