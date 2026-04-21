import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Upload } from 'lucide-react';
import { uploadDocument } from '../api/documents';
import type { ApiDocument } from '../lib/types';

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectId: string;
  subjectName: string;
  /** Called with the newly created document after a successful upload */
  onUploaded: (doc: ApiDocument) => void;
}

export function DocumentUploadModal({
  isOpen,
  onClose,
  subjectId,
  subjectName,
  onUploaded,
}: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setErrorMsg(null);
    try {
      // Real API call to upload the document
      const doc = await uploadDocument(subjectId, file);
      setFile(null);
      onUploaded(doc);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Fehler beim Hochladen');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setFile(null);
          setErrorMsg(null);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[rgba(0,0,0,0.5)] z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-(--radius) w-full max-w-md max-h-[85vh] flex flex-col z-50">
          <div className="flex justify-between items-center px-6 pt-6 pb-4 border-b border-border shrink-0">
            <Dialog.Title asChild>
              <h3 style={{ fontSize: 'var(--text-xl)' }}>Dokument hochladen</h3>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-sm)' }}>
                Fach: <strong>{subjectName}</strong>
              </p>

              {errorMsg && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-(--radius)">
                  <p className="text-destructive" style={{ fontSize: 'var(--text-sm)' }}>{errorMsg}</p>
                </div>
              )}

              <div className="mb-6">
                <label htmlFor="file-upload" className="block mb-2">
                  Datei auswählen <span className="text-destructive">*</span>
                </label>
                <input
                  type="file"
                  id="file-upload"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.txt"
                  required
                  className="w-full px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
                  style={{ fontSize: 'var(--text-base)' }}
                />
                {file && (
                  <p className="mt-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Ausgewählt: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isUploading}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-base)' }}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={!file || isUploading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontSize: 'var(--text-base)' }}
              >
                {isUploading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Wird hochgeladen…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Hochladen
                  </>
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
