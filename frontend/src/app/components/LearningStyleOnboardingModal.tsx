import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, X } from 'lucide-react';
import type { LearningStyle } from '../api/assessment';

interface LearningStyleOnboardingModalProps {
  isOpen: boolean;
  mode: 'onboarding' | 'settings';
  selectedStyle: LearningStyle;
  onSelect: (style: LearningStyle) => void;
  onSave: () => void;
  onClose: () => void;
  onSkip: () => void;
  isSaving: boolean;
  error?: string | null;
}

const STYLE_OPTIONS: Array<{
  value: LearningStyle;
  title: string;
  description: string;
}> = [
  {
    value: 'visual',
    title: 'Visuell',
    description: 'Mit klarer Struktur, Vergleichstabellen und gut merkbaren Bildern in Textform.'
  },
  {
    value: 'analytical',
    title: 'Analytisch',
    description: 'Mit Definitionen, Herleitungen und sauberer, logischer Begruendung.'
  },
  {
    value: 'practical',
    title: 'Praktisch',
    description: 'Mit konkreten Anwendungsfaellen, Vorgehensschritten und Praxisbezug.'
  },
  {
    value: 'mixed',
    title: 'Gemischt (Empfohlen)',
    description: 'Kombiniert alle drei Lernstile für einen ausgewogenen Prüfungsfokus.'
  },
];

export function LearningStyleOnboardingModal({
  isOpen,
  mode,
  selectedStyle,
  onSelect,
  onSave,
  onClose,
  onSkip,
  isSaving,
  error,
}: LearningStyleOnboardingModalProps) {
  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(0,0,0,0.55)] z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-(--radius) w-full max-w-2xl max-h-[90vh] flex flex-col z-50">
          <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-border">
            <Dialog.Title asChild>
              <h3 style={{ fontSize: 'var(--text-xl)' }}>
                {mode === 'onboarding' ? 'Lernstil-Onboarding' : 'Lernstil ändern'}
              </h3>
            </Dialog.Title>
            <button
              onClick={mode === 'onboarding' ? onSkip : onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label={mode === 'onboarding' ? 'Onboarding überspringen' : 'Modal schließen'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-5 overflow-y-auto">
            <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
              Wähle deinen bevorzugten Lernstil. Die KI passt Fragen, Lernplan und Antworten daran an.
            </p>

            {error && (
              <div className="mb-4 border border-destructive/40 bg-destructive/10 text-destructive rounded-(--radius) px-3 py-2" style={{ fontSize: 'var(--text-sm)' }}>
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {STYLE_OPTIONS.map((option) => {
                const isSelected = selectedStyle === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => onSelect(option.value)}
                    className={`text-left border rounded-(--radius) p-4 transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-semi-bold)' }}>
                        {option.title}
                      </span>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            {mode === 'onboarding' ? (
              <button
                onClick={onSkip}
                disabled={isSaving}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Überspringen (Gemischt)
              </button>
            ) : (
              <button
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Abbrechen
              </button>
            )}
            <button
              onClick={onSave}
              disabled={isSaving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontSize: 'var(--text-base)' }}
            >
              {isSaving ? 'Speichern...' : 'Lernstil speichern'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
