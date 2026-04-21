import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, BookOpen, AlertTriangle, Info, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { generateLearningPlan, getEffortProbability, getLearningProfile } from '../api/assessment';
import type {
  ConfidenceClass,
  EffortProbabilityResponse,
  LearningPlanResponse,
  LearningPlanTopicItem,
  SubjectClassification,
} from '../api/assessment';
import { getGradeClassName } from '../lib/mockData';
import type { LearningStyle } from '../api/assessment';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
};

const PRIORITY_LABELS: Record<LearningPlanTopicItem['priority'], string> = {
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
};

const PRIORITY_CLASSES: Record<LearningPlanTopicItem['priority'], string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

const CONFIDENCE_LABELS: Record<ConfidenceClass, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
};

const CONFIDENCE_CLASSES: Record<ConfidenceClass, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  high: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

const CLASSIFICATION_LABELS: Record<SubjectClassification, string> = {
  '1day': '1-Tag-lernbar',
  deep: 'Konzeptuell-tief',
};

interface InfoTooltipProps {
  text: string;
}

function InfoTooltip({ text }: InfoTooltipProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.top - 10,
      left: rect.left + rect.width / 2,
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const handleReposition = () => updatePosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={text}
      >
        <Info className="w-4 h-4" />
      </button>
      {isOpen &&
        createPortal(
          <span
            className="fixed z-9999 pointer-events-none -translate-x-1/2 -translate-y-full rounded-(--radius) border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              fontSize: 'var(--text-xs, 0.75rem)',
              maxWidth: '22rem',
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </>
  );
}

export function LearningPlanView() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();

  const [hours, setHours] = useState<number>(10);
  const [targetGrade, setTargetGrade] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<LearningPlanResponse | null>(null);
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');
  const [effortModel, setEffortModel] = useState<EffortProbabilityResponse | null>(null);
  const [isEffortLoading, setIsEffortLoading] = useState<boolean>(true);
  const [effortError, setEffortError] = useState<string | null>(null);
  const [isEffortExpanded, setIsEffortExpanded] = useState<boolean>(true);

  useEffect(() => {
    getLearningProfile()
      .then((profile) => setActiveStyle(profile.style))
      .catch(() => setActiveStyle('mixed'));
  }, []);

  useEffect(() => {
    if (!subjectId) {
      setIsEffortLoading(false);
      setEffortModel(null);
      setEffortError('Ungültige Fach-ID');
      return;
    }

    let isMounted = true;
    setIsEffortLoading(true);
    setEffortError(null);

    getEffortProbability(subjectId)
      .then((result) => {
        if (!isMounted) return;
        setEffortModel(result);
      })
      .catch((err) => {
        if (!isMounted) return;
        setEffortModel(null);
        setEffortError(err instanceof Error ? err.message : 'Aufwand-Modell konnte nicht geladen werden');
      })
      .finally(() => {
        if (!isMounted) return;
        setIsEffortLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [subjectId]);

  const handleGenerate = async () => {
    if (!subjectId) return;
    setIsLoading(true);
    setError(null);
    setPlan(null);
    try {
      const result = await generateLearningPlan(subjectId, hours, targetGrade);
      if (result.applied_learning_style) {
        setActiveStyle(result.applied_learning_style);
      }
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setIsLoading(false);
    }
  };

  const totalPlanHours = plan?.topic_plan.reduce((sum, t) => sum + t.hours, 0) ?? 0;

  return (
    <div>
        <button
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 hover:bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>
        

        <h2 className="flex items-center gap-4 mb-6 text-xl font-bold">
            <BookOpen className="w-6 h-6" />
            Lernplan erstellen
        </h2>   

      <div
        className="bg-card border border-border rounded-(--radius) mb-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-secondary/50 focus-visible:bg-secondary/50 p-6 ease-in-out duration-200 cursor-pointer"
            onClick={() => setIsEffortExpanded((prev) => !prev)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsEffortExpanded((prev) => !prev);
                }  
            }}
            tabIndex={0}
            aria-expanded={isEffortExpanded}
            role="button"
        >
          <div className="flex items-center gap-2">
            <h3 style={{ fontSize: 'var(--text-lg)' }}>Aufwand-Wahrscheinlichkeitsmodell</h3>
            <InfoTooltip text="Zeigt je Zielnote den erwarteten Lernstundenbereich und die Wahrscheinlichkeit, diese Note auf Basis von Fachhistorie und Heuristiken zu erreichen." />
          </div>
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            <ChevronDown className={`ease-in-out duration-200 ${isEffortExpanded ? 'rotate-180' : ''}`} />
          </span>
        </div>

        {isEffortExpanded && (
          <div className="px-6 pb-6 mt-4">
            {effortModel && (
              <div className="mb-4">
                <span className="flex items-center gap-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  Klassifizierung: {CLASSIFICATION_LABELS[effortModel.classification]}
                  <InfoTooltip text="Die Klassifizierung beschreibt den Fachtyp (1-Tag-lernbar, ausgeglichen, konzeptuell-tief) und beeinflusst die Stundenbereiche." />
                  · Historie: {effortModel.history_count} Session(s)
                </span>
                {effortModel.tempo_explanation && (
                  <p className="text-muted-foreground mt-1" style={{ fontSize: 'var(--text-sm)' }}>
                    {effortModel.tempo_explanation}
                  </p>
                )}
              </div>
            )}

            {isEffortLoading && (
              <div className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                Aufwand-Modell wird berechnet...
              </div>
            )}

            {!isEffortLoading && effortError && (
              <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-(--radius) p-4">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p style={{ fontSize: 'var(--text-base)' }}>{effortError}</p>
              </div>
            )}

            {!isEffortLoading && !effortError && effortModel && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-155 text-left" style={{ fontSize: 'var(--text-sm)' }}>
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Zielnote</th>
                      <th className="py-2 pr-4 font-medium">Stundenbereich</th>
                      <th className="py-2 pr-4 font-medium">Wahrscheinlichkeit</th>
                      <th className="py-2 pr-4 font-medium">Visualisierung</th>
                      <th className="py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          Konfidenz
                          <InfoTooltip text="Konfidenz bewertet die Belastbarkeit der Wahrscheinlichkeit anhand Datenmenge und lokaler Verteilungsstärke rund um die Note." />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {effortModel.results.map((row) => (
                      <tr key={row.grade}>
                        <td className="py-3 pr-4 font-medium">Note {row.grade}</td>
                        <td className="py-3 pr-4">{row.hours_min}-{row.hours_max} Std.</td>
                        <td className="py-3 pr-4">{row.probability_percent}%</td>
                        <td className="py-3 pr-4">
                          <div className="w-full max-w-55 h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${row.probability_percent}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-sm ${CONFIDENCE_CLASSES[row.confidence_class]}`}
                            style={{ fontSize: 'var(--text-xs, 0.75rem)' }}
                          >
                            {CONFIDENCE_LABELS[row.confidence_class]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-(--radius) p-6 mb-6">
        <h3 className="mb-4" style={{ fontSize: 'var(--text-lg)' }}>
          Rahmenbedingungen
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="hours-input"
              className="block mb-2 text-muted-foreground"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              Verfügbare Lernzeit
            </label>
            <div className="flex items-center gap-4">
              <input
                id="hours-input"
                type="range"
                min={1}
                max={80}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span
                className="w-20 text-center font-semibold bg-secondary text-secondary-foreground px-3 py-1 rounded-(--radius)"
                style={{ fontSize: 'var(--text-base)' }}
              >
                {hours} Std.
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="grade-select"
              className="block mb-2 text-muted-foreground"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              Ziel-Note (optional)
            </label>
            <select
              id="grade-select"
              value={targetGrade ?? ''}
              onChange={(e) => setTargetGrade(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-3 py-2 bg-background border border-border rounded-(--radius)"
              style={{ fontSize: 'var(--text-base)' }}
            >
              <option value="">Bestmöglich</option>
              <option value="1">Note 1 (&gt;= 90%)</option>
              <option value="2">Note 2 (&gt;= 75%)</option>
              <option value="3">Note 3 (&gt;= 60%)</option>
              <option value="4">Note 4 (&gt;= 50%)</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="mt-6 inline-flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontSize: 'var(--text-base)' }}
        >
          {isLoading ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              KI erstellt Lernplan...
            </>
          ) : (
            <>
              <BookOpen className="w-4 h-4" />
              Lernplan generieren
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-(--radius) p-4 mb-6">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p style={{ fontSize: 'var(--text-base)' }}>{error}</p>
        </div>
      )}

      {plan && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-(--radius) p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                Erreichbare Note mit {hours} Stunden
              </p>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block px-4 py-2 rounded-(--radius) font-semibold text-lg ${getGradeClassName(plan.achievable_grade)}`}
                >
                  Note {plan.achievable_grade}
                </span>
                <span className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                  (~{plan.achievable_pct}%)
                </span>
              </div>
            </div>
            <div className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Gesamtstunden im Plan: <strong className="text-foreground">{totalPlanHours} Std.</strong>
            </div>
          </div>

          <div className="bg-accent border border-border rounded-(--radius) p-5">
            <p className="font-medium mb-1" style={{ fontSize: 'var(--text-sm)' }}>
              Lernstil aktiv: {LEARNING_STYLE_LABEL[activeStyle]}
            </p>
            {plan.general_advice && <p style={{ fontSize: 'var(--text-base)' }}>{plan.general_advice}</p>}
          </div>

          <div className="bg-card border border-border rounded-(--radius) overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 style={{ fontSize: 'var(--text-lg)' }}>Themen-Lernplan</h3>
            </div>
            <div className="divide-y divide-border">
              {plan.topic_plan.map((item, i) => (
                <div key={i} className="px-6 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 flex items-center gap-3 min-w-0">
                      <span
                        className={`shrink-0 inline-block px-2 py-0.5 rounded-sm ${PRIORITY_CLASSES[item.priority]}`}
                        style={{ fontSize: 'var(--text-xs, 0.75rem)' }}
                      >
                        {PRIORITY_LABELS[item.priority]}
                      </span>
                      <span className="font-medium truncate" style={{ fontSize: 'var(--text-base)' }}>
                        {item.topic}
                      </span>
                    </div>
                    <span
                      className="shrink-0 bg-secondary text-secondary-foreground px-3 py-1 rounded-(--radius)"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {item.hours} Std.
                    </span>
                  </div>
                  {item.tip && (
                    <p className="mt-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                      {item.tip}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
