import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Brain, Layers, Plus, Sparkles, Trash2 } from 'lucide-react';
import { fetchSubject } from '../api/subjects';
import {
  archiveFlashcard,
  createFlashcard,
  generateFlashcards,
  getFlashcards,
  getLearningProfile,
  updateGuidedLearningProgress,
  submitFlashcardReview,
  updateFlashcard,
  type Flashcard,
  type FlashcardPayload,
  type FlashcardRating,
  type FlashcardStats,
  type LearningStyle,
} from '../api/assessment';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
};

const EMPTY_FORM: FlashcardPayload = {
  term: '',
  answer: '',
  hint: '',
  topic: '',
};

const REVIEW_COLOR = {
  again: 'bg-destructive/12 border-destructive/45 text-destructive',
  hard: 'bg-orange-400/12 border-orange-400/45 text-orange-400',
  good: 'bg-blue-400/12 border-blue-400/45 text-blue-400',
  easy: 'bg-emerald-500/12 border-emerald-500/45 text-emerald-500',
};

const SOURCE_LABELS: Record<string, string> = {
  ai: 'KI',
  guided: 'Generiert',
  manual: 'Manuell',
};

const SOURCE_CLASSES: Record<string, string> = {
  ai: 'bg-primary text-primary-foreground',
  guided: 'bg-sky-600 text-white',
  manual: 'bg-secondary text-secondary-foreground',
};

export function FlashcardsView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state ?? {}) as {
    fromMenu?: boolean;
    fromGuidedLearning?: boolean;
    guidedStep?: number;
    guidedTitle?: string;
    guidedCurrentStep?: number;
    guidedCompletedSteps?: number[];
  };
  const fromMenu = Boolean(locationState.fromMenu);
  const fromGuidedLearning = Boolean(locationState.fromGuidedLearning);
  const guidedStep = typeof locationState.guidedStep === 'number' ? locationState.guidedStep : null;
  const guidedTitle = locationState.guidedTitle || '';

  const [subjectName, setSubjectName] = useState('');
  const [dueCards, setDueCards] = useState<Flashcard[]>([]);
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [stats, setStats] = useState<FlashcardStats | null>(null);
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');

  const [activeTab, setActiveTab] = useState<'learn' | 'manage'>('learn');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const [form, setForm] = useState<FlashcardPayload>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guidedCompletionPending, setGuidedCompletionPending] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadData = async (preserveIndex = false) => {
    if (!subjectId) return;

    setIsLoading(true);
    setError(null);
    try {
      const [subject, dueResponse, allResponse, profile] = await Promise.all([
        fetchSubject(subjectId),
        getFlashcards(subjectId, 'due', false, 500, guidedStep ?? undefined),
        getFlashcards(subjectId, 'all', false, 1000, guidedStep ?? undefined),
        getLearningProfile(),
      ]);

      setSubjectName(subject.name);
      setDueCards(dueResponse.cards);
      setAllCards(allResponse.cards);
      setStats(dueResponse.stats);
      setActiveStyle(profile.style);

      if (!preserveIndex) {
        setCurrentIndex(0);
      } else {
        setCurrentIndex((prev) => Math.max(0, Math.min(prev, Math.max(dueResponse.cards.length - 1, 0))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Karteikarten');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  const currentCard = useMemo(
    () => (dueCards.length > 0 ? dueCards[currentIndex] : null),
    [dueCards, currentIndex],
  );
  const guidedCardsLearned = useMemo(
    () => Boolean(
      guidedStep !== null && 
      allCards.length > 0 && 
      // Criterion 1: Every card must be rated as 'good' or 'easy' (never 'again' or 'hard').
      allCards.every((card) => 
        card.last_review_rating && 
        card.last_review_rating !== 'again' && 
        card.last_review_rating !== 'hard'
      ) &&
      // Criterion 2: No card may currently be due.
      stats?.due_now === 0
    ),
    [allCards, stats, guidedStep],
  );

  const completeGuidedStage = async () => {
    if (!subjectId || guidedStep === null || guidedStep >= 4) return;

    setGuidedCompletionPending(true);
    setError(null);
    try {
      const completedSteps = [...new Set([...(locationState.guidedCompletedSteps ?? []), guidedStep])].sort((a, b) => a - b);
      await updateGuidedLearningProgress(subjectId, {
        current_step: Math.min(4, guidedStep + 1) as 1 | 2 | 3 | 4,
        completed_steps: completedSteps,
      });
      navigate(`/guided-learning/${subjectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guided-Stufe konnte nicht abgeschlossen werden');
    } finally {
      setGuidedCompletionPending(false);
    }
  };

  const handleReview = async (rating: FlashcardRating) => {
    if (!currentCard) return;

    setIsSaving(true);
    setError(null);
    try {
      await submitFlashcardReview([{ flashcard_id: currentCard.id, rating }]);
      setRevealed(false);
      await loadData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern der Bewertung');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!subjectId) return;

    setIsGenerating(true);
    setError(null);
    setInfo(null);
    try {
      const result = await generateFlashcards(subjectId);
      if (result.applied_learning_style) setActiveStyle(result.applied_learning_style);
      setInfo(`KI-Generierung: ${result.inserted_count} neue Karten erstellt, ${result.skipped_duplicates} Duplikate übersprungen.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler bei der KI-Generierung');
    } finally {
      setIsGenerating(false);
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleSaveCard = async () => {
    if (!subjectId) return;

    if (!form.term?.trim() || !form.answer?.trim()) {
      setError('Bitte Begriff und Antwort ausfüllen.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateFlashcard(editingId, {
          term: form.term.trim(),
          answer: form.answer.trim(),
          hint: form.hint?.trim() || null,
          topic: form.topic?.trim() || null,
        });
        setInfo('Karteikarte aktualisiert.');
      } else {
        await createFlashcard(subjectId, {
          term: form.term.trim(),
          answer: form.answer.trim(),
          hint: form.hint?.trim() || null,
          topic: form.topic?.trim() || null,
        });
        setInfo('Karteikarte erstellt.');
      }
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern der Karteikarte');
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (card: Flashcard) => {
    setEditingId(card.id);
    setForm({
      term: card.term,
      answer: card.answer,
      hint: card.hint || '',
      topic: card.topic || '',
    });
  };

  const handleArchive = async (card: Flashcard) => {
    if (!confirm('Karteikarte archivieren?')) return;

    setIsSaving(true);
    setError(null);
    try {
      await archiveFlashcard(card.id);
      if (editingId === card.id) resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Archivieren');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Karteikarten werden geladen...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={() => navigate(fromGuidedLearning ? `/guided-learning/${subjectId}` : fromMenu ? '/flashcards' : `/subject/${subjectId}`)}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>
        <h2 className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Karteikarten: {subjectName}{guidedStep !== null ? ` · Guided Schritt ${guidedStep}${guidedTitle ? ` (${guidedTitle})` : ''}` : ''}
        </h2>
      </div>

      {guidedStep !== null && (
        <div className="mb-6 rounded-(--radius) border border-sky-300 bg-sky-50 p-4 text-sky-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>
                Guided Schritt {guidedStep}
              </p>
              <p style={{ fontSize: 'var(--text-sm)' }}>
                {guidedCardsLearned
                  ? 'Alle Karten wurden mindestens einmal gelernt. Du kannst diese Stage jetzt abschließen.'
                  : 'Lerne alle Karten dieses Schritts. Danach kannst du die Stage als abgeschlossen markieren.'}
              </p>
            </div>
            {guidedCardsLearned && guidedStep < 4 && (
              <button
                onClick={completeGuidedStage}
                disabled={guidedCompletionPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {guidedCompletionPending ? 'Speichere...' : 'Stage abschließen'}
              </button>
            )}
          </div>
        </div>
      )}

      {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <div className={`rounded-(--radius) border p-3 ${REVIEW_COLOR.again}`}>
              <p className="text-sm text-red-400">Again · Fällig</p>
              <p className='text-lg'>{stats.due_now}</p>
            </div>
            <div className={`rounded-(--radius) border p-3 ${REVIEW_COLOR.easy}`}>
              <p className="text-emerald-500 text-sm">Easy · Aktiv</p>
              <p className='text-lg'>{stats.total_active}</p>
            </div>
            <div className={`rounded-(--radius) border p-3 ${REVIEW_COLOR.hard}`}>
              <p className="text-orange-400 text-sm">Hard · Neu</p>
              <p className='text-lg'>{stats.new_cards}</p>
            </div>
            <div className={`rounded-(--radius) border p-3 ${REVIEW_COLOR.good}`}>
              <p className="text-blue-400 text-sm">Good · Im Lernen</p>
              <p className='text-lg'>{stats.learning_cards}</p>
            </div>
            <div className="rounded-(--radius) border p-3 bg-muted/60 border-border text-muted-foreground">
              <p className="text-muted-foreground text-sm">Archiv</p>
              <p className='text-lg'>{stats.archived}</p>
            </div>
          </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-(--radius) border border-destructive/40 bg-destructive/10 text-destructive" style={{ fontSize: 'var(--text-base)' }}>
          {error}
        </div>
      )}

      {info && (
        <div className="mb-4 p-3 rounded-(--radius) border border-border bg-accent text-foreground" style={{ fontSize: 'var(--text-base)' }}>
          {info}
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setActiveTab('learn')}
          className={`px-4 py-2 rounded-(--radius) ${activeTab === 'learn' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          Lernen
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          className={`px-4 py-2 rounded-(--radius) ${activeTab === 'manage' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          Verwalten
        </button>
      </div>

      {activeTab === 'learn' && (
        <div>
          {currentCard ? (
            <div className="bg-card border border-border rounded-(--radius) p-6">
              <div className="flex justify-between items-center mb-3">
                <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  Karte {currentIndex + 1} von {dueCards.length}
                </span>
                <span
                  className={`px-2 py-1 rounded-sm ${SOURCE_CLASSES[currentCard.source] || SOURCE_CLASSES.manual}`}
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  {SOURCE_LABELS[currentCard.source] || SOURCE_LABELS.manual}
                </span>
              </div>

              {currentCard.topic && (
                <div className="mb-4">
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Thema: {currentCard.topic}
                  </span>
                </div>
              )}

              <h3 className="mb-5" style={{ fontSize: 'var(--text-xl)' }}>{currentCard.term}</h3>

              {!revealed ? (
                <button
                  onClick={() => setRevealed(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  Antwort anzeigen
                </button>
              ) : (
                <div>
                  <div className="bg-accent border border-border rounded-(--radius) p-4 mb-4">
                    <p style={{ fontSize: 'var(--text-base)' }}>{currentCard.answer}</p>
                    {currentCard.hint && (
                      <p className="mt-3 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                        Tipp: {currentCard.hint}
                      </p>
                    )}
                  </div>

                  <p className="mb-3 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Wie gut konntest du die Antwort?
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <button
                      onClick={() => handleReview('again')}
                      disabled={isSaving}
                      className={`px-3 py-2 rounded-(--radius) ${REVIEW_COLOR.again} hover:bg-red-600/15 transition-color disabled:opacity-50`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      Again
                    </button>
                    <button
                      onClick={() => handleReview('hard')}
                      disabled={isSaving}
                      className={`px-3 py-2 rounded-(--radius) ${REVIEW_COLOR.hard} hover:bg-amber-600/15 transition-color disabled:opacity-50`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      Hard
                    </button>
                    <button
                      onClick={() => handleReview('good')}
                      disabled={isSaving}
                      className={`px-3 py-2 rounded-(--radius) ${REVIEW_COLOR.good} hover:bg-blue-600/15 transition-color disabled:opacity-50`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      Good
                    </button>
                    <button
                      onClick={() => handleReview('easy')}
                      disabled={isSaving}
                      className={`px-3 py-2 rounded-(--radius) ${REVIEW_COLOR.easy} hover:bg-emerald-600/15 transition-color disabled:opacity-50`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      Easy
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-(--radius) p-10 text-center">
              <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
                {guidedStep !== null
                  ? 'Für diesen Schritt sind aktuell keine fälligen Karten mehr vorhanden.'
                  : 'Keine fälligen Karteikarten. Wechsle auf Verwalten oder generiere neue Karten.'}
              </p>
              {guidedStep !== null && guidedCardsLearned && guidedStep < 4 && (
                <button
                  onClick={completeGuidedStage}
                  disabled={guidedCompletionPending}
                  className="mb-4 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  {guidedCompletionPending ? 'Speichere...' : 'Stage abschließen'}
                </button>
              )}
              <button
                onClick={() => setActiveTab('manage')}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Zur Verwaltung
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'manage' && (
        <div>
          {guidedStep !== null && (
            <div className="mb-5 rounded-(--radius) border border-sky-300 bg-sky-50 p-4 text-sky-900">
              In diesem Modus bearbeitest du die Karten für Guided Schritt {guidedStep}. Neue manuelle Karten bleiben möglich, werden aber nicht Teil der Guided-Stage.
            </div>
          )}
          <div className="flex flex-wrap gap-3 mb-5">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontSize: 'var(--text-base)' }}
            >
              <Sparkles className="w-4 h-4" />
              {isGenerating ? 'Generiere...' : '20 KI-Karten generieren'}
            </button>
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
              style={{ fontSize: 'var(--text-base)' }}
            >
              <Plus className="w-4 h-4" />
              Neue Karte
            </button>
          </div>

          <div className="bg-card border border-border rounded-(--radius) p-5 mb-6">
            <h3 className="mb-4" style={{ fontSize: 'var(--text-lg)' }}>
              {editingId ? 'Karteikarte bearbeiten' : 'Karteikarte erstellen'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Begriff*</span>
                <input
                  value={form.term || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, term: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
                />
              </label>

              <label className="block">
                <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Thema</span>
                <input
                  value={form.topic || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, topic: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
                />
              </label>
            </div>

            <label className="block mt-4">
              <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Antwort*</span>
              <textarea
                value={form.answer || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, answer: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              />
            </label>

            <label className="block mt-4">
              <span className="block mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>Tipp</span>
              <textarea
                value={form.hint || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, hint: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              />
            </label>

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSaveCard}
                disabled={isSaving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-base)' }}
              >
                {editingId ? 'Änderungen speichern' : 'Karte erstellen'}
              </button>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  Abbrechen
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {allCards.length === 0 ? (
              <div className="bg-card border border-border rounded-(--radius) p-6 text-center">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                  Noch keine aktiven Karteikarten vorhanden.
                </p>
              </div>
            ) : (
              allCards.map((card) => (
                <div key={card.id} className="bg-card border border-border rounded-(--radius) p-4">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-1 rounded-sm ${SOURCE_CLASSES[card.source] || SOURCE_CLASSES.manual}`}
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {SOURCE_LABELS[card.source] || SOURCE_LABELS.manual}
                        </span>
                        {card.topic && (
                          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                            {card.topic}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>{card.term}</p>
                      <p className="text-muted-foreground mt-1" style={{ fontSize: 'var(--text-sm)' }}>
                        {card.answer}
                      </p>
                      <p className="text-muted-foreground mt-1" style={{ fontSize: 'var(--text-sm)' }}>
                        Fällig: {new Date(card.due_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-start gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(card)}
                        className="px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleArchive(card)}
                        className="px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
