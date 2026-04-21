import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Layers } from 'lucide-react';
import { fetchSubjectsByFilter } from '../api/subjects';
import {
  getFlashcards,
  getLearningProfile,
  submitFlashcardReview,
  type Flashcard,
  type FlashcardRating,
  type LearningStyle,
} from '../api/assessment';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
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

type MergedCard = Flashcard & { subject_name: string };

export function FlashcardsAllView() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<MergedCard[]>([]);
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (preserveIndex = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const [subjects, profile] = await Promise.all([
        fetchSubjectsByFilter('all'),
        getLearningProfile(),
      ]);
      setActiveStyle(profile.style);

      const dueBySubject = await Promise.all(
        subjects.map(async (subject) => {
          const response = await getFlashcards(subject.id, 'due', false, 500);
          return response.cards.map((card) => ({ ...card, subject_name: subject.name }));
        }),
      );

      const merged = dueBySubject
        .flat()
        .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

      setCards(merged);
      if (!preserveIndex) {
        setCurrentIndex(0);
      } else {
        setCurrentIndex((prev) => Math.max(0, Math.min(prev, Math.max(merged.length - 1, 0))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der kombinierten Karten');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const currentCard = useMemo(
    () => (cards.length > 0 ? cards[currentIndex] : null),
    [cards, currentIndex],
  );

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

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Fachübergreifende Karten werden geladen...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={() => navigate('/flashcards')}
          className="inline-flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>
        <h2 className="flex items-center gap-2">
          <Layers className="w-5 h-5" />
          Alle Fächer gemeinsam
        </h2>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-(--radius) border border-destructive/40 bg-destructive/10 text-destructive" style={{ fontSize: 'var(--text-base)' }}>
          {error}
        </div>
      )}

      {currentCard ? (
        <div className="bg-card border border-border rounded-(--radius) p-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Karte {currentIndex + 1} von {cards.length}
            </span>
            <div className="flex gap-2">
              <span className="px-2 py-1 rounded-sm bg-secondary text-secondary-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                {currentCard.subject_name}
              </span>
              <span
                className={`px-2 py-1 rounded-sm ${SOURCE_CLASSES[currentCard.source] || SOURCE_CLASSES.manual}`}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {SOURCE_LABELS[currentCard.source] || SOURCE_LABELS.manual}
              </span>
            </div>
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
            Aktuell sind keine fälligen Karteikarten in deinen Fächern vorhanden.
          </p>
          <button
            onClick={() => navigate('/flashcards')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
            style={{ fontSize: 'var(--text-base)' }}
          >
            Zur Auswahl
          </button>
        </div>
      )}
    </div>
  );
}
