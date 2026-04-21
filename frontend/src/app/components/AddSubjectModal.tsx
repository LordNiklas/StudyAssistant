import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, Loader } from 'lucide-react';
import type { Subject, SubjectPayload } from '../lib/types';
import { createSubject, fetchSubjectsByFilter, getPublicSubjects, subscribeToSubject } from '../api/subjects';
import { SubjectModal } from './SubjectModal';

interface AddSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubjectAdded: (subject: Subject) => void;
}

export function AddSubjectModal({ isOpen, onClose, onSubjectAdded }: AddSubjectModalProps) {
  const [activeTab, setActiveTab] = useState<'create' | 'find'>('create');
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  
  // Find tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [publicSubjects, setPublicSubjects] = useState<Subject[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscribingTo, setSubscribingTo] = useState<string | null>(null);
  const [subscribedSubjectIds, setSubscribedSubjectIds] = useState<Set<string>>(new Set());

  const normalizeId = (id: string | number) => String(id);

  // Load public subjects when find tab is opened
  useEffect(() => {
    if (!isOpen || activeTab !== 'find') return;

    if (publicSubjects.length === 0) {
      loadPublicSubjects('');
    }

    loadMySubscriptions();
  }, [activeTab, isOpen]);

  // Debounced search
  useEffect(() => {
    if (activeTab !== 'find') return;
    
    const timer = setTimeout(() => {
      if (searchTerm.length > 0 || publicSubjects.length === 0) {
        loadPublicSubjects(searchTerm);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, activeTab]);

  const loadPublicSubjects = async (search: string) => {
    try {
      setIsLoadingSubjects(true);
      setError(null);
      const response = await getPublicSubjects(search, 50, 0, 'name', 'ASC');
      setPublicSubjects(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Fächer');
    } finally {
      setIsLoadingSubjects(false);
    }
  };

  const loadMySubscriptions = async () => {
    try {
      const subscriptions = await fetchSubjectsByFilter('subscribed');
      setSubscribedSubjectIds(new Set(subscriptions.map((subject) => normalizeId(subject.id))));
    } catch {
      // Non-blocking for the list view: if it fails, users can still browse public subjects.
    }
  };

  const handleSubscribe = async (subjectId: string) => {
    const normalizedSubjectId = normalizeId(subjectId);
    if (subscribedSubjectIds.has(normalizedSubjectId)) return;

    try {
      setSubscribingTo(normalizedSubjectId);
      await subscribeToSubject(subjectId);
      setSubscribedSubjectIds((prev) => new Set(prev).add(normalizedSubjectId));
      
      // Find the subject object
      const subject = publicSubjects.find(s => s.id === subjectId);
      if (subject) {
        onSubjectAdded({ ...subject, ownership: 'subscriber' });
      }
      
      // Close modal after successful subscribe
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Abonnieren');
    } finally {
      setSubscribingTo(null);
    }
  };

  const handleSubjectCreated = (payload: SubjectPayload) => {
    createSubject(payload)
      .then((subject) => {
        onSubjectAdded({ ...subject, ownership: 'owner' });
        setShowSubjectModal(false);
        onClose();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Fachs');
      });
  };

  const renderDifficultyBadge = (difficulty?: string) => {
    const badges: { [key: string]: { emoji: string; color: string; label: string } } = {
      low: { emoji: '🟢', color: 'text-green-600', label: 'Leicht' },
      medium: { emoji: '🔵', color: 'text-blue-600', label: 'Mittel' },
      high: { emoji: '🟡', color: 'text-yellow-600', label: 'Schwer' },
      killer: { emoji: '🔴', color: 'text-red-600', label: 'Exmatrikulator' },
    };
    
    if (!difficulty || !badges[difficulty]) return null;
    const badge = badges[difficulty];
    return (
      <span className={`inline-block ${badge.color}`} title={badge.label}>
        {badge.emoji}
      </span>
    );
  };

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={onClose}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-[rgba(0,0,0,0.5)] z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-(--radius) w-full max-w-2xl max-h-[85vh] flex flex-col z-50">
            <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0 border-b border-border">
              <Dialog.Title asChild>
                <h3 style={{ fontSize: 'var(--text-xl)' }}>Fach hinzufügen</h3>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-border px-6 pt-4 shrink-0">
              <button
                onClick={() => setActiveTab('create')}
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'create'
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontSize: 'var(--text-base)' }}
              >
                ➕ Selbst erstellen
              </button>
              <button
                onClick={() => setActiveTab('find')}
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'find'
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontSize: 'var(--text-base)' }}
              >
                🔍 Fach finden
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {activeTab === 'create' && (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    Lege ein neues Fach an und markiere es optional als öffentlich, damit andere es abonnieren können.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowSubjectModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90"
                  >
                    ➕ Fach selbst erstellen
                  </button>
                </div>
              )}

              {activeTab === 'find' && (
                <div>
                  {/* Search Box */}
                  <div className="mb-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Nach Fächern suchen..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
                        style={{ fontSize: 'var(--text-base)' }}
                      />
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-(--radius) text-destructive">
                      {error}
                    </div>
                  )}

                  {/* Loading */}
                  {isLoadingSubjects && (
                    <div className="flex justify-center py-8">
                      <Loader className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {/* Results */}
                  {!isLoadingSubjects && publicSubjects.length === 0 && !searchTerm && (
                    <div className="text-center py-8 text-muted-foreground">
                      Keine öffentlichen Fächer verfügbar. Sei der erste, der ein Fach teilt!
                    </div>
                  )}

                  {!isLoadingSubjects && publicSubjects.length === 0 && searchTerm && (
                    <div className="text-center py-8 text-muted-foreground">
                      Keine Fächer gefunden, die "{searchTerm}" enthalten.
                    </div>
                  )}

                  {!isLoadingSubjects && publicSubjects.length > 0 && (
                    <div className="space-y-3">
                      {publicSubjects.map((subject) => {
                        const normalizedSubjectId = normalizeId(subject.id);
                        const isSubscribed = subscribedSubjectIds.has(normalizedSubjectId);
                        const isSubscribing = subscribingTo === normalizedSubjectId;

                        return (
                        <div
                          key={subject.id}
                          className="border border-border rounded-(--radius) p-4 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium truncate" style={{ fontSize: 'var(--text-base)' }}>
                                  {subject.name}
                                </h4>
                                {renderDifficultyBadge(subject.difficulty)}
                              </div>
                              <p className="text-muted-foreground line-clamp-2" style={{ fontSize: 'var(--text-sm)' }}>
                                {subject.description}
                              </p>
                              <div className="mt-2 flex items-center gap-4 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                                {subject.owner_username && (
                                  <span>Von: <strong>@{subject.owner_username}</strong></span>
                                )}
                                {subject.document_count !== undefined && (
                                  <span>📄 {subject.document_count} Dokumente</span>
                                )}
                                {subject.subscriber_count !== undefined && (
                                  <span>👥 {subject.subscriber_count} Abonnenten</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleSubscribe(subject.id)}
                              disabled={isSubscribing || isSubscribed}
                              className={`px-3 py-2 rounded-(--radius) transition-opacity shrink-0 whitespace-nowrap ${
                                isSubscribed
                                  ? 'bg-green-600 text-white cursor-not-allowed'
                                  : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50'
                              }`}
                              style={{ fontSize: 'var(--text-sm)' }}
                            >
                              {isSubscribed ? 'Abonniert' : isSubscribing ? 'Wird abonniert...' : '✓ Abonnieren'}
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Nested SubjectModal for creation */}
      <SubjectModal
        isOpen={showSubjectModal}
        onClose={() => setShowSubjectModal(false)}
        onSave={handleSubjectCreated}
        subject={null}
      />
    </>
  );
}
