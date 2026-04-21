import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { X, ArrowLeft, ArrowRight, Check, AlertTriangle } from 'lucide-react';
import { generateQuestions, getLearningProfile, submitAssessment } from '../api/assessment';
import type { Question } from '../lib/types';
import type { LearningStyle } from '../api/assessment';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
};

export function AssessmentView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const guidedState = (location.state ?? {}) as {
    fromGuidedLearning?: boolean;
    guidedCurrentStep?: number;
    guidedCompletedSteps?: number[];
  };
  const isFromGuidedLearning = Boolean(guidedState.fromGuidedLearning);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');
  const [testStartedAt, setTestStartedAt] = useState<number | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<(number | null)[]>([]);
  const [responseTimes, setResponseTimes] = useState<(number | null)[]>([]);

  useEffect(() => {
    const loadQuestions = async () => {
      if (!subjectId) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        // Load style before question generation
        const profile = await getLearningProfile();
        setActiveStyle(profile.style);

        // Generate or fetch cached questions
        const response = await generateQuestions(subjectId);
        if (response.applied_learning_style) {
          setActiveStyle(response.applied_learning_style);
        }

        setQuestions(response.data);
        setAnswers(new Array(response.data.length).fill(null));
        setResponseTimes(new Array(response.data.length).fill(null));
        const now = Date.now();
        setTestStartedAt(now);
        setQuestionStartedAt(new Array(response.data.length).fill(null));
      } catch (err) {
        console.error('Failed to load questions:', err);
        setError((err as Error).message || 'Fehler beim Laden der Fragen');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadQuestions();
  }, [subjectId]);

  useEffect(() => {
    if (questions.length === 0) return;
    setQuestionStartedAt((prev) => {
      const next = prev.length === questions.length ? [...prev] : new Array(questions.length).fill(null);
      if (next[currentIndex] == null) {
        next[currentIndex] = Date.now();
      }
      return next;
    });
  }, [currentIndex, questions.length]);

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Fragen werden aus deinen Dokumenten generiert…</p>
      </div>
    );
  }

  if (error) {
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

  if (questions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Keine Fragen verfügbar</p>
        <button
          onClick={() => navigate(`/subject/${subjectId}`)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius)"
        >
          Zurück zum Fach
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const isLastQuestion = currentIndex === questions.length - 1;
  const isFirstQuestion = currentIndex === 0;
  const isAnswered = answers[currentIndex] !== null;

  const handleSelectAnswer = (optionIndex: number) => {
    const startedAt = questionStartedAt[currentIndex] ?? Date.now();
    const elapsed = Math.max(250, Date.now() - startedAt);

    const newAnswers = [...answers];
    newAnswers[currentIndex] = optionIndex;
    setAnswers(newAnswers);

    const nextResponseTimes = [...responseTimes];
    nextResponseTimes[currentIndex] = elapsed;
    setResponseTimes(nextResponseTimes);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const handleSubmit = async () => {
    if (!subjectId) return;
    
    if (answers.some((a) => a === null)) {
      alert('Bitte beantworte alle Fragen, bevor du den Test abschickst.');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const payload = {
        subject_id: subjectId,
        total_duration_seconds: testStartedAt
          ? Math.max(1, Math.round((Date.now() - testStartedAt) / 1000))
          : undefined,
        answers: answers.map((selectedIndex, idx) => ({
          question_id: questions[idx].id,
          selected_index: selectedIndex!,
          response_time_ms: responseTimes[idx] ?? undefined,
        })),
      };

      const result = await submitAssessment(payload);
      
      // Navigate to result view with the API response
      navigate(`/result/${subjectId}`, {
        state: { 
          questions, 
          answers,
          result: result.data,
          fromGuidedLearning: isFromGuidedLearning,
          guidedCurrentStep: guidedState.guidedCurrentStep ?? 4,
          guidedCompletedSteps: guidedState.guidedCompletedSteps ?? [],
        },
      });
    } catch (err) {
      console.error('Failed to submit assessment:', err);
      alert('Fehler beim Absenden des Tests. Bitte versuche es erneut.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAbort = () => {
    if (confirm('Test wirklich abbrechen? Fortschritt geht verloren.')) {
      navigate(isFromGuidedLearning ? `/guided-learning/${subjectId}` : `/subject/${subjectId}`);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={handleAbort}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <X className="w-4 h-4" />
          Test abbrechen
        </button>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Frage {currentIndex + 1} von {questions.length}
          </span>
          <div className="w-40 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {currentQuestion.repeatedErrorHint && (
        <div className="bg-amber-400/15 border border-amber-400 p-4 mb-6 flex items-start gap-3 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
              Wiederholte Schwachstelle:
            </p>
            <p className="text-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              {currentQuestion.repeatedErrorHint.message}
            </p>
          </div>
        </div>
      )}

      {/* Question Card */}
      <div className="bg-card border border-border rounded-(--radius) mb-6 overflow-hidden">
        {currentQuestion.topic && (
          <div className="px-6 py-3 bg-accent border-b border-border">
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              🏷️ {currentQuestion.topic}
            </span>
          </div>
        )}
        <div className="p-6">
          <h3 className="mb-6" style={{ fontSize: 'var(--text-lg)' }}>
            {currentQuestion.question}
          </h3>

          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              const isSelected = answers[currentIndex] === index;
              return (
                <button
                  key={index}
                  onClick={() => handleSelectAnswer(index)}
                  className={`w-full text-left px-4 py-3 border rounded-(--radius) transition-all ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border hover:bg-accent'
                  }`}
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={handlePrevious}
          disabled={isFirstQuestion}
          className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>

        {isLastQuestion ? (
          <button
            onClick={handleSubmit}
            disabled={!isAnswered || isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[rgb(34,197,94)] text-white rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontSize: 'var(--text-base)' }}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Wird gesendet...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Test abschicken
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={!isAnswered}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontSize: 'var(--text-base)' }}
          >
            Weiter
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
