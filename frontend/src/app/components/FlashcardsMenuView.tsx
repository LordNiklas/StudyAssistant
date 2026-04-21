import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Brain, Layers, ChevronRight } from 'lucide-react';
import { fetchSubjectsByFilter } from '../api/subjects';
import { getFlashcardStats } from '../api/assessment';
import type { Subject } from '../lib/types';

export function FlashcardsMenuView() {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const subjectData = await fetchSubjectsByFilter('all');
        setSubjects(subjectData);

        const statsEntries = await Promise.all(
          subjectData.map(async (subject) => {
            try {
              const stats = await getFlashcardStats(subject.id);
              return [subject.id, stats.due_now] as const;
            } catch {
              return [subject.id, 0] as const;
            }
          }),
        );

        setStatsMap(Object.fromEntries(statsEntries));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden der Fächer');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const totalDue = useMemo(
    () => Object.values(statsMap).reduce((sum, value) => sum + value, 0),
    [statsMap],
  );

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p style={{ fontSize: 'var(--text-base)' }}>Karteikarten-Menü wird geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius)"
          style={{ fontSize: 'var(--text-base)' }}
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-6 text-xl">Karteikarten lernen</h2>

      <div className="bg-card border border-border rounded-(--radius) p-6 mb-8">
        <h3 className="mb-3" style={{ fontSize: 'var(--text-lg)' }}>Lernmodus wählen</h3>
        <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
          Du kannst ein einzelnes Fach lernen oder alle Fächer zusammen in einer gemeinsamen Session.
        </p>
        <button
          onClick={() => navigate('/flashcards/all')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Layers className="w-4 h-4" />
          Alle Fächer gemeinsam lernen ({totalDue} fällige Karten)
        </button>
      </div>

      <div>
        <h3 className="mb-4" style={{ fontSize: 'var(--text-lg)' }}>Einzelfach lernen</h3>
        {subjects.length === 0 ? (
          <div className="bg-card border border-border rounded-(--radius) p-6 text-center">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
              Noch keine Fächer vorhanden.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map((subject) => (
              <button
                key={subject.id}
                onClick={() => navigate(`/flashcards/${subject.id}`, { state: { fromMenu: true } })}
                className="bg-card border border-border rounded-(--radius) p-4 text-left hover:shadow-(--elevation-sm) transition-all"
              >
                <div className="flex justify-between items-center mb-2">
                  <p style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
                    {subject.name}
                  </p>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    <Brain className="inline w-4 h-4 mr-1" />
                    Karteikarten
                  </span>
                  <span className="px-2 py-1 rounded-sm bg-secondary text-secondary-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    {statsMap[subject.id] || 0} fällig
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
