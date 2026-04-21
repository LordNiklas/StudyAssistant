import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Info } from 'lucide-react';
import type { Subject, SubjectPayload, Difficulty } from '../lib/types';

interface SubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: SubjectPayload) => void;
  subject: Subject | null;
}

export function SubjectModal({ isOpen, onClose, onSave, subject }: SubjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lecturerName, setLecturerName] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [examNotes, setExamNotes] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  useEffect(() => {
    if (subject) {
      setName(subject.name);
      setDescription(subject.description);
      setLecturerName(subject.lecturer_name || '');
      setDifficulty(subject.difficulty || '');
      setExamNotes(subject.exam_notes || '');
      setIsPublic(subject.is_public || false);
    } else {
      setName('');
      setDescription('');
      setLecturerName('');
      setDifficulty('');
      setExamNotes('');
      setIsPublic(false);
    }
    setErrors({});
  }, [subject, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { name?: string; description?: string } = {};
    if (!name.trim()) newErrors.name = 'Bitte gib einen Fachnamen ein.';
    if (!description.trim()) newErrors.description = 'Bitte gib eine Beschreibung ein.';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const payload: SubjectPayload = {
      name: name.trim(),
      description: description.trim(),
      lecturer_name: lecturerName.trim() || null,
      difficulty: (difficulty as Difficulty) || null,
      exam_notes: examNotes.trim() || null,
      is_public: isPublic,
    };
    onSave(payload);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(0,0,0,0.5)] z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-(--radius) w-full max-w-lg max-h-[85vh] flex flex-col z-50">
          <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0 border-b border-border">
            <Dialog.Title asChild>
              <h3 style={{ fontSize: 'var(--text-xl)' }}>
                {subject ? 'Fach bearbeiten' : 'Neues Fach erstellen'}
              </h3>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 px-6 pb-6">
            {/* Name */}
            <div className="mb-4 mt-6">
              <label htmlFor="subject-name" className="block mb-2" style={{ fontSize: 'var(--text-base)' }}>
                Fachname <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                id="subject-name"
                value={name}
                onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) setErrors((prev) => ({ ...prev, name: undefined })); }}
                className={`w-full px-3 py-2 bg-input-background border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.name ? 'border-destructive focus:ring-destructive' : 'border-border'
                }`}
                style={{ fontSize: 'var(--text-base)' }}
              />
              {errors.name && (
                <p className="mt-1 text-destructive" style={{ fontSize: 'var(--text-sm)' }}>{errors.name}</p>
              )}
            </div>

            {/* Description */}
            <div className="mb-4">
              <label htmlFor="subject-description" className="block mb-2" style={{ fontSize: 'var(--text-base)' }}>
                Beschreibung <span className="text-destructive">*</span>
              </label>
              <textarea
                id="subject-description"
                value={description}
                onChange={(e) => { setDescription(e.target.value); if (e.target.value.trim()) setErrors((prev) => ({ ...prev, description: undefined })); }}
                rows={3}
                className={`w-full px-3 py-2 bg-input-background border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring ${
                  errors.description ? 'border-destructive focus:ring-destructive' : 'border-border'
                }`}
                style={{ fontSize: 'var(--text-base)' }}
              />
              {errors.description && (
                <p className="mt-1 text-destructive" style={{ fontSize: 'var(--text-sm)' }}>{errors.description}</p>
              )}
            </div>

            {/* Lecturer Name */}
            <div className="mb-4">
              <label htmlFor="subject-lecturer" className="block mb-2" style={{ fontSize: 'var(--text-base)' }}>
                Dozentenname
              </label>
              <input
                type="text"
                id="subject-lecturer"
                value={lecturerName}
                onChange={(e) => setLecturerName(e.target.value)}
                placeholder="z. B. Prof. Dr. Müller"
                className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ fontSize: 'var(--text-base)' }}
              />
            </div>

            {/* Difficulty */}
            <div className="mb-4">
              <label htmlFor="subject-difficulty" className="block mb-2" style={{ fontSize: 'var(--text-base)' }}>
                Schwierigkeitsgrad
              </label>
              <select
                id="subject-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ fontSize: 'var(--text-base)' }}
              >
                <option value="">– nicht angegeben –</option>
                <option value="low">🟢 Leicht</option>
                <option value="medium">🔵 Mittel</option>
                <option value="high">🟡 Schwer</option>
                <option value="killer">🔴 Exmatrikulator</option>
              </select>
            </div>

            {/* Exam Notes */}
            <div className="mb-6">
              <label htmlFor="subject-exam-notes" className="block mb-2" style={{ fontSize: 'var(--text-base)' }}>
                Prüfungsnotizen
              </label>
              <textarea
                id="subject-exam-notes"
                value={examNotes}
                onChange={(e) => setExamNotes(e.target.value)}
                rows={2}
                placeholder="z. B. Klausur hat immer Aufgaben zu Thema X, offene Fragen bevorzugt…"
                className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ fontSize: 'var(--text-base)' }}
              />
            </div>

            {/* Is Public Toggle */}
            <div className="mb-6 p-4 bg-muted rounded-(--radius) border border-border">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="subject-is-public"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="mt-1 w-4 h-4 cursor-pointer"
                />
                <div className="flex-1">
                  <label htmlFor="subject-is-public" className="block font-medium cursor-pointer mb-1" style={{ fontSize: 'var(--text-base)' }}>
                    Fach als öffentlich markieren
                  </label>
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Andere Nutzer können dieses Fach finden und abonnieren. Du kannst Tests machen, Lernpläne erstellen und deine Fortschritte tracken, ohne sie zu teilen.
                  </p>
                </div>
              </div>
            </div>

            </div>{/* end scrollable area */}

            {/* Actions – always visible */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Speichern
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
