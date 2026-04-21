import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { getTopicPriorities } from '../api/explain';
import type { TopicPriorityExplanation } from '../lib/types';

interface Props {
  subjectId: string;
}

function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const classes =
    priority === 'high'
      ? 'bg-red-100 text-red-800'
      : priority === 'medium'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-gray-100 text-gray-600';
  const label = priority === 'high' ? 'Hoch' : priority === 'medium' ? 'Mittel' : 'Gering';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}

const FACTOR_TOOLTIPS: Record<string, string> = {
  'Fehlerquote': 'Anteil falsch beantworteter Fragen zu diesem Thema',
  'Wiederholungsrate': 'Wie oft dieses Thema bereits geübt wurde (normalisiert auf 10 Antworten = 100%)',
  'Dozentenfokus': 'Anteil der Prüfungsfragen, die dieses Thema abdecken',
  'Letzter Score invertiert': 'Invertierter letzter Prüfungsscore – 100% bedeutet 0% richtig beantwortet',
};

function InfoTooltip({ text }: { text: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ top: rect.top - 10, left: rect.left + rect.width / 2 });
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
            style={{ top: `${position.top}px`, left: `${position.left}px`, fontSize: 'var(--text-xs, 0.75rem)', maxWidth: '22rem' }}
          >
            {text}
          </span>,
          document.body
        )}
    </>
  );
}

function FactorChip({ name, value }: { name: string; value: number }) {
  const tooltip = FACTOR_TOOLTIPS[name];
  return (
    <span className="inline-flex items-center gap-1">
      <span>{name}</span>
      <span className="font-medium">{value}%</span>
      {tooltip && <InfoTooltip text={tooltip} />}
    </span>
  );
}

function TopicRow({ item }: { item: TopicPriorityExplanation }) {
  const topFactors = [...item.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <PriorityBadge priority={item.priority} />
      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ fontSize: 'var(--text-base)' }}>
          {item.topic}
        </span>
        {topFactors.length > 0 && (
          <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5" style={{ fontSize: 'var(--text-sm)' }}>
            {topFactors.map((f, i) => (
              <span key={f.name} className="inline-flex items-center gap-1">
                {i > 0 && <span className="select-none">·</span>}
                <FactorChip name={f.name} value={f.value} />
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

export function TopicPriorityPanel({ subjectId }: Props) {
  const [topics, setTopics] = useState<TopicPriorityExplanation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTopicPriorities(subjectId)
      .then((data) => {
        if (!cancelled) setTopics(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-(--radius) p-4">
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Themenpriorisierung wird geladen…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-(--radius) p-4">
        <p className="text-destructive" style={{ fontSize: 'var(--text-sm)' }}>
          Fehler: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-(--radius) p-4">
      {topics.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Keine Themenpriorisierung verfügbar
        </p>
      ) : (
        topics.map((item) => (
          <TopicRow key={item.topic} item={item} />
        ))
      )}
    </div>
  );
}
