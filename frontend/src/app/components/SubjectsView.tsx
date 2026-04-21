import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { fetchSubjectsByFilter, createSubject, updateSubject, deleteSubject } from '../api/subjects';
import { getLatestSessionsMap } from '../api/assessment';
import { deleteSubjectMeta } from '../lib/localStore';
import { getDifficultyLabel, getGradeClassName } from '../lib/mockData';
import { SubjectModal } from './SubjectModal';
import { AddSubjectModal } from './AddSubjectModal';
import type { Subject, SubjectPayload } from '../lib/types';

// Sorts subjects by priority: killer difficulty first, then worst score, then newest
function sortByPriority(subjects: Subject[]): Subject[] {
  return [...subjects].sort((a, b) => {
    if (a.difficulty === 'killer' && b.difficulty !== 'killer') return -1;
    if (b.difficulty === 'killer' && a.difficulty !== 'killer') return 1;
    if (a.lastSession && b.lastSession) return a.lastSession.score_pct - b.lastSession.score_pct;
    if (a.lastSession && !b.lastSession) return -1;
    if (!a.lastSession && b.lastSession) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function SubjectsView() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filter, setFilter] = useState<'own' | 'subscribed' | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, latestSessions] = await Promise.all([fetchSubjectsByFilter(filter), getLatestSessionsMap()]);
      setSubjects(data.map((s) => {
        const session = latestSessions[s.id];
        return session
          ? { ...s, lastSession: { score: session.score, total: session.total, score_pct: session.score_pct, grade_prognosis: session.grade_prognosis, date: session.created_at } }
          : s;
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const handleAddSubject = () => {
    setEditingSubject(null);
    setIsAddModalOpen(true);
  };

  const handleEditSubject = (subject: Subject) => {
    setEditingSubject(subject);
    setIsCreateModalOpen(true);
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm('Möchtest du dieses Fach wirklich löschen? Alle zugehörigen Dokumente werden ebenfalls gelöscht.')) return;
    try {
      await deleteSubject(id);
      // Also remove local lastSession for the deleted subject
      deleteSubjectMeta(id);
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Löschen');
    }
  };

  const handleSaveSubject = async (payload: SubjectPayload) => {
    try {
      if (editingSubject) {
        const updated = await updateSubject(editingSubject.id, payload);
        // Preserve lastSession already in state when editing
        setSubjects((prev) => prev.map((s) => (s.id === editingSubject.id ? { ...updated, lastSession: s.lastSession } : s)));
      } else {
        const created = await createSubject(payload);
        setSubjects((prev) => [...prev, created]);
      }
      setIsCreateModalOpen(false);
      setEditingSubject(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern');
    }
  };

  const handleSubjectAdded = (subject: Subject) => {
    setSubjects((prev) => {
      const exists = prev.some((s) => s.id === subject.id);
      if (exists) return prev;
      return [...prev, subject];
    });
  };

  const sorted = sortByPriority(subjects);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive rounded-(--radius) p-6 text-center">
        <p className="text-destructive mb-4">{error}</p>
        <button
          onClick={loadSubjects}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h2 className='text-xl'>Meine Fächer</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'own' | 'subscribed' | 'all')}
            className="px-3 py-2 bg-input-background border border-border rounded-(--radius) focus:outline-none focus:ring-2 focus:ring-ring"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            <option value="all">Alle</option>
            <option value="own">Meine Fächer</option>
            <option value="subscribed">Abonnierte</option>
          </select>
        </div>
        <button
          onClick={handleAddSubject}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Plus className="w-4 h-4" />
          Fach hinzufügen
        </button>
      </div>

      {/* Subjects Grid */}
      {sorted.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-(--radius) p-16 text-center">
          <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
            Noch keine Fächer vorhanden
          </p>
          <button
            onClick={handleAddSubject}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-(--radius) hover:opacity-90"
          >
            Erstes Fach hinzufügen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sorted.map((subject) => {
            const docCount = subject.document_count ?? subject.documents?.length ?? 0;
            const difficultyInfo = getDifficultyLabel(subject.difficulty);

            return (
              <div
                key={subject.id}
                className={`bg-card flex flex-col justify-between border border-border rounded-(--radius) overflow-hidden transition-all hover:shadow-(--elevation-sm) ${
                  subject.difficulty === 'killer' ? 'border-l-4 border-l-destructive!' : ''
                }`}
              >
                <Link to={`/subject/${subject.id}`} className="block h-full">
                  <div className="p-6 h-full">
                    {/* Title and Difficulty Badge */}
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="flex-1" style={{ fontSize: 'var(--text-xl)' }}>
                        {subject.name}
                      </h3>
                    {/* Difficulty Badge */}
                      {difficultyInfo.label && (
                        <span
                          className={`px-2 py-1 rounded-sm text-xs ml-2 ${difficultyInfo.className}`}
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {difficultyInfo.label}
                        </span>
                      )}
                    </div>

                    {/* Lecturer name */}
                    {subject.lecturer_name && (
                      <p className="text-muted-foreground mb-2" style={{ fontSize: 'var(--text-sm)' }}>
                        👤 {subject.lecturer_name}
                      </p>
                    )}

                    {subject.ownership === 'subscriber' && (
                      <p className="text-muted-foreground mb-2" style={{ fontSize: 'var(--text-sm)' }}>
                        🔒 Gehört {subject.owner_username || 'unbekannt'}
                      </p>
                    )}

                    {/* Description */}
                    <p className="text-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
                      {subject.description.length > 100
                        ? `${subject.description.substring(0, 100)}…`
                        : subject.description}
                    </p>

                    {/* Document Count and Score Badge */}
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                        {docCount} Dokument{docCount !== 1 ? 'e' : ''}
                      </span>
                      {subject.lastSession ? (
                        <span
                          className={`px-3 py-1 rounded-sm ${getGradeClassName(
                            subject.lastSession.grade_prognosis,
                          )}`}
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {subject.lastSession.score_pct}% · Note {subject.lastSession.grade_prognosis}
                        </span>
                      ) : (
                        <span
                          className="px-3 py-1 rounded-sm bg-muted text-muted-foreground"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          Noch nicht bewertet
                        </span>
                      )}
                    </div>
                  </div>
                </Link>

                {/* Card Footer */}
                {subject.ownership !== 'subscriber' && (
                  <div className="bg-accent border-t border-border flex justify-between">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleEditSubject(subject);
                      }}
                      className="inline-flex flex-1 justify-center items-center gap-2 px-3 py-3 text-accent-foreground hover:text-primary hover:bg-secondary transition-colors"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <Pencil className="w-4 h-4" />
                      Bearbeiten
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleDeleteSubject(subject.id);
                      }}
                      className="inline-flex flex-1 justify-center items-center gap-2 px-3 py-3 text-accent-foreground hover:text-destructive hover:bg-secondary transition-colors"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <Trash2 className="w-4 h-4" />
                      Löschen
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Subject Modal (edit only) */}
      <SubjectModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingSubject(null);
        }}
        onSave={handleSaveSubject}
        subject={editingSubject}
      />

      {/* Add Subject Modal (create or subscribe) */}
      <AddSubjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubjectAdded={handleSubjectAdded}
      />
    </div>
  );
}
