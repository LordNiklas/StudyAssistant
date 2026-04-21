import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import {
  ArrowLeft,
  Upload,
  ClipboardCheck,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Trash2,
  Calendar,
  ChevronRight,
  BookOpen,
  ListChecks,
  Brain,
  Route,
  Mail,
  MoreVertical,
  Info,
  FileText,
  BarChart3,
  CheckCircle,
  Layers,
} from 'lucide-react';
import { fetchSubject, fetchSubjectClassification } from '../api/subjects';
import { unsubscribeFromSubject } from '../api/subjects';
import { fetchDocuments, deleteDocument } from '../api/documents';
import { getAssessmentHistory, getPostExamHistory } from '../api/assessment';
import { getSubjectMeta } from '../lib/localStore';
import { getDifficultyLabel, getGradeClassName, formatDate, formatFileSize } from '../lib/mockData';
import { DocumentUploadModal } from './DocumentUploadModal';
import { QuestionManagerModal } from './QuestionManagerModal';
import { TopicPriorityPanel } from './TopicPriorityPanel';
import { ProfessorRequestModal } from './ProfessorRequestModal';
import type { Subject, ApiDocument } from '../lib/types';
import type { AssessmentSession } from '../api/assessment';
import type { SubjectClassificationResponse } from '../api/subjects';

const CLASSIFICATION_LABELS: Record<'1day' | 'deep', string> = {
  '1day': '1-Tag-lernbar',
  deep: 'Konzeptuell-tief',
};

export function SubjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [sessions, setSessions] = useState<AssessmentSession[]>([]);
  const [lastPostExam, setLastPostExam] = useState<{ session_id: string | null; score_pct: number; grade_prognosis: number; created_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isQuestionManagerOpen, setIsQuestionManagerOpen] = useState(false);
  const [isProfessorRequestOpen, setIsProfessorRequestOpen] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);
  const [classification, setClassification] = useState<SubjectClassificationResponse | null>(null);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'information' | 'documents' | 'priority' | 'history' | 'recheck'>('information');
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  /**
   * Load the subject detail view data from the API.
   *
   * @param id - Subject ID from the current route.
   */
  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch subject from real API (lecturer_name, difficulty, exam_notes come from the API)
      const subjectData = await fetchSubject(id);
      const { lastSession } = getSubjectMeta(id);
      const merged: Subject = lastSession ? { ...subjectData, lastSession } : subjectData;
      setSubject(merged);

      // Fetch documents from real API
      const docsData = await fetchDocuments(id);
      setDocuments(docsData);

      try {
        const classificationData = await fetchSubjectClassification(id);
        setClassification(classificationData);
      } catch {
        setClassification(null);
      }

      // Fetch assessment history from real API
      try {
        const historyData = await getAssessmentHistory(id);
        setSessions(historyData);
      } catch {
        // Non-critical: history stays empty
      }

      try {
        const postExamHistory = await getPostExamHistory(id, 1);
        setLastPostExam(postExamHistory[0] || null);
      } catch {
        // Non-critical: post-exam history stays empty
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close actions menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setIsActionsMenuOpen(false);
      }
    }

    if (isActionsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isActionsMenuOpen]);

  /**
   * Delete one document from the subject and update the local list.
   *
   * @param docId - Document ID.
   */
  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Dokument wirklich löschen?')) return;
    try {
      await deleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Löschen');
    }
  };

  /**
   * Open the assessment flow when at least one document is available.
   */
  const handleStartAssessment = () => {
    if (!subject || documents.length === 0) return;
    navigate(`/assessment/${subject.id}`);
  };

  /**
   * Remove the current user's subscription without deleting subject data.
   */
  const handleUnsubscribe = async () => {
    if (!subject || subject.ownership !== 'subscriber') return;
    if (!confirm('Möchtest du dieses Fach wirklich deabonnieren? Deine Daten bleiben erhalten.')) return;

    setIsUnsubscribing(true);
    try {
      // Removing the subscription does not delete subject data, documents, or history.
      await unsubscribeFromSubject(subject.id);
      navigate('/');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Deabonnieren');
    } finally {
      setIsUnsubscribing(false);
      setIsActionsMenuOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="inline-block w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !subject) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">{error || 'Fach nicht gefunden'}</p>
        <Link to="/" className="text-primary hover:underline mt-4 inline-block">
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const canStartAssessment = documents.length > 0;
  const isReadOnly = subject.ownership === 'subscriber';
  const difficultyInfo = getDifficultyLabel(subject.difficulty);
  const topClassificationFactors = (classification?.factors || []).slice(0, 3);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-3 py-2 ease-in-out hover:bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
            style={{ fontSize: 'var(--text-base)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Zurück
          </button>
        </div>
      </div>

      {/* Title and Actions Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <h2 className='text-xl font-bold'>{subject.name}</h2>
        
        {/* Actions Dropdown Menu – Right Aligned */}
        <div ref={actionsMenuRef} className="relative inline-block">
          <button
            onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
            style={{ fontSize: 'var(--text-base)' }}
          >
            <MoreVertical className="w-4 h-4" />
            Aktionen
          </button>

          {/* Dropdown Menu Content */}
          {isActionsMenuOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-card border border-border rounded-(--radius) shadow-lg z-50">
              {/* Lernplan erstellen */}
              <button
                onClick={() => {
                  navigate(`/learning-plan/${subject.id}`);
                  setIsActionsMenuOpen(false);
                }}
                className="w-full text-left inline-flex items-center gap-2 px-4 py-3 text-secondary-foreground hover:bg-accent transition-colors first:rounded-t-(--radius)"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                <BookOpen className="w-4 h-4" />
                Lernplan erstellen
              </button>

              {/* Post-Klausur-Re-Check */}
              <button
                onClick={() => {
                  navigate(`/post-exam/${subject.id}`);
                  setIsActionsMenuOpen(false);
                }}
                className="w-full text-left inline-flex items-center gap-2 px-4 py-3 text-secondary-foreground hover:bg-accent transition-colors border-t border-border"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                <ClipboardList className="w-4 h-4" />
                Post-Klausur-Re-Check
              </button>

              {/* Fragen verwalten */}
              <button
                onClick={() => {
                  setIsQuestionManagerOpen(true);
                  setIsActionsMenuOpen(false);
                }}
                className="w-full text-left inline-flex items-center gap-2 px-4 py-3 text-secondary-foreground hover:bg-accent transition-colors border-t border-border"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                <ListChecks className="w-4 h-4" />
                Testfragen verwalten
              </button>

              {/* Professor-Anfrage */}
              <button
                onClick={() => {
                  setIsProfessorRequestOpen(true);
                  setIsActionsMenuOpen(false);
                }}
                className="w-full text-left inline-flex items-center gap-2 px-4 py-3 text-secondary-foreground hover:bg-accent transition-colors border-t border-border last:rounded-b-(--radius)"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                <Mail className="w-4 h-4" />
                Professor-Anfrage
              </button>

              {subject.ownership === 'subscriber' && (
                <button
                  onClick={handleUnsubscribe}
                  disabled={isUnsubscribing}
                  className="w-full text-left inline-flex items-center gap-2 px-4 py-3 bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors border-t border-border disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  <Trash2 className="w-4 h-4" />
                  {isUnsubscribing ? 'Deabonnieren...' : 'Deabonnieren'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isReadOnly && (
        <div className="mb-6 p-4 rounded-(--radius) border border-yellow-300 bg-yellow-50 text-yellow-900">
          Dieses Fach gehört {subject.owner_username || 'dem Fachinhaber'}. Du hast Read-only-Zugriff:
          Tests und Lernplanung sind erlaubt, Dokument-Upload und Löschen nicht.
        </div>
      )}

      {(subject.difficulty === 'killer' || !subject.lecturer_name) && (
        <div className="mb-6 p-4 rounded-(--radius) border border-sky-300 bg-sky-50 text-sky-900">
          Für dieses Fach ist der Guided Mode empfohlen, weil {subject.difficulty === 'killer' ? 'der Schwierigkeitsgrad als extrem hoch markiert ist' : 'kein Dozent hinterlegt ist'}.
        </div>
      )}

      {/* Secondary Button Row – Right Aligned */}
      <div className="flex justify-end gap-2 mb-6">
        {/* Guided Journey */}
        <button
          onClick={() => navigate(`/guided-learning/${subject.id}`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Route className="w-4 h-4" />
          Guided Journey
        </button>

        {/* Karteikarten */}
        <button
          onClick={() => navigate(`/flashcards/${subject.id}`)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-(--radius) hover:opacity-90 transition-opacity"
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Brain className="w-4 h-4" />
          Karteikarten lernen
        </button>

        {/* Einstufungstest – enabled when documents are loaded */}
        <button
          onClick={handleStartAssessment}
          disabled={!canStartAssessment}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-(--radius) transition-opacity ${
            canStartAssessment
              ? 'bg-[rgb(34,197,94)] text-white hover:opacity-90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
          title={!canStartAssessment ? 'Bitte lade zuerst Dokumente hoch' : ''}
        >
          <ClipboardCheck className="w-4 h-4" />
          Einstufungstest
        </button>

        {/* Dokument hochladen */}
        <button
          onClick={() => !isReadOnly && setIsUploadModalOpen(true)}
          disabled={isReadOnly}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-(--radius) transition-opacity ${
            isReadOnly
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
          title={isReadOnly ? 'Nur der Fachinhaber kann Dokumente hochladen' : ''}
        >
          <Upload className="w-4 h-4" />
          Dokument hochladen
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-0 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('information')}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === 'information'
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Info className="w-4 h-4" />
          Informationen
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === 'documents'
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          <FileText className="w-4 h-4" />
          Dokumente
        </button>
        <button
          onClick={() => setActiveTab('priority')}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === 'priority'
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          <Layers className="w-4 h-4" />
          Themenpriorisierung
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          <BarChart3 className="w-4 h-4" />
          Testhistorie
        </button>
        <button
          onClick={() => lastPostExam && setActiveTab('recheck')}
          disabled={!lastPostExam}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
            !lastPostExam
              ? 'opacity-50 cursor-not-allowed border-transparent text-muted-foreground'
              : activeTab === 'recheck'
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          style={{ fontSize: 'var(--text-base)' }}
        >
          <CheckCircle className="w-4 h-4" />
          Re-Check
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'information' && (
        <div className='p-6 border border-border rounded-(--radius) bg-card'>
          <div className="bg-card rounded-(--radius) mb-6">
            <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
              Beschreibung
            </p>
            <p style={{ fontSize: 'var(--text-base)' }}>{subject.description}</p>
          </div>

          {/* Lecturer / Difficulty / Test Info Card */}
          {(subject.lecturer_name || subject.difficulty || subject.exam_notes || subject.lastSession || lastPostExam) && (
            <div className="bg-card rounded-(--radius) mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {subject.lecturer_name && (
                  <div>
                    <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                      Dozent
                    </p>
                    <p style={{ fontSize: 'var(--text-base)' }}>{subject.lecturer_name}</p>
                  </div>
                )}
                {subject.difficulty && (
                  <div>
                    <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                      Schwierigkeitsgrad
                    </p>
                    <span
                      className={`inline-block px-3 py-1 rounded-sm ${difficultyInfo.className}`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {difficultyInfo.label}
                    </span>
                  </div>
                )}
                {classification && (
                  <div>
                    <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                      Fachklassifizierung
                    </p>
                    <span
                      className={`inline-block px-3 py-1 rounded-sm ${classification.classification === '1day' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'}`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {CLASSIFICATION_LABELS[classification.classification]}
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                    Letzter Test
                  </p>
                  {subject.lastSession ? (
                    <span
                      className={`inline-block px-3 py-1 rounded-sm ${getGradeClassName(
                        subject.lastSession.grade_prognosis,
                      )}`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {subject.lastSession.score_pct}% · Note {subject.lastSession.grade_prognosis}
                    </span>
                  ) : (
                    <span style={{ fontSize: 'var(--text-base)' }}>–</span>
                  )}
                </div>
              </div>

              {classification && topClassificationFactors.length > 0 && (
                <div className="bg-accent border border-border rounded-(--radius) p-4 mb-4">
                  <p className="text-muted-foreground mb-2" style={{ fontSize: 'var(--text-sm)' }}>
                    Warum diese Einstufung?
                  </p>
                  <ul className="space-y-2">
                    {topClassificationFactors.map((factor, index) => (
                      <li key={`${factor.name}-${index}`} style={{ fontSize: 'var(--text-sm)' }}>
                        <span className="font-medium">{factor.name}:</span> {String(factor.value)} - {factor.rationale}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Exam Notes */}
              {subject.exam_notes && (
                <div>
                  <p className="text-muted-foreground mb-1" style={{ fontSize: 'var(--text-sm)' }}>
                    Prüfungsnotizen
                  </p>
                  <p style={{ fontSize: 'var(--text-base)' }}>{subject.exam_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Documents */}
      {activeTab === 'documents' && (
        documents.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-(--radius) p-12 text-center">
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4" style={{ fontSize: 'var(--text-base)' }}>
              Noch keine Dokumente hochgeladen
            </p>
            <button
              onClick={() => !isReadOnly && setIsUploadModalOpen(true)}
              disabled={isReadOnly}
              className={`px-4 py-2 rounded-(--radius) transition-opacity ${
                isReadOnly
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
              style={{ fontSize: 'var(--text-base)' }}
            >
              {isReadOnly ? 'Read-only' : 'Erstes Dokument hochladen'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-card border border-border rounded-(--radius) p-4 hover:shadow-(--elevation-sm) transition-all overflow-hidden"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="flex-1 wrap-break-word" style={{ fontSize: 'var(--text-base)' }}>
                    {doc.name}
                  </h4>
                </div>
                <div className="space-y-1">
                  {doc.original_filename && (
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                      {doc.file_type?.toUpperCase() ?? ''}
                    </p>
                  )}
                  {doc.size != null && (
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                      {formatFileSize(doc.size)}
                    </p>
                  )}
                  <p className="text-muted-foreground flex items-center gap-1" style={{ fontSize: 'var(--text-sm)' }}>
                    <Calendar className="w-3 h-3" />
                    {formatDate(doc.created_at)}
                  </p>
                </div>
                <div className="mt-4 flex justify-end">
                  {!isReadOnly && (
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="inline-flex items-center gap-1 text-destructive hover:underline"
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Löschen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Tab Content: Priority */}
      {activeTab === 'priority' && (
        <div>
          <TopicPriorityPanel subjectId={subject.id} />
        </div>
      )}

      {/* Tab Content: History */}
      {activeTab === 'history' && (
        <div>
          {sessions.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-(--radius) p-12 text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                Noch keine Tests durchgeführt
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => navigate(`/result/${id}`, { state: { sessionId: session.id } })}
                  className="w-full bg-card border border-border rounded-(--radius) p-4 flex justify-between items-center hover:bg-accent transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span style={{ fontSize: 'var(--text-base)' }}>
                      {formatDate(session.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 rounded-sm ${getGradeClassName(session.grade_prognosis)}`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {session.score_pct}%
                    </span>
                    <span
                      className={`px-3 py-1 rounded-sm ${getGradeClassName(session.grade_prognosis)}`}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      Note {session.grade_prognosis}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Re-Check */}
      {activeTab === 'recheck' && lastPostExam && (
        <button
          onClick={() => lastPostExam.session_id && navigate(`/result/${id}`, { state: { sessionId: lastPostExam.session_id } })}
          disabled={!lastPostExam.session_id}
          className={`w-full bg-card border border-border rounded-(--radius) p-6 text-left transition-colors ${
            lastPostExam.session_id ? 'hover:bg-accent cursor-pointer' : 'opacity-70 cursor-not-allowed'
          }`}
        >
          <div className="mb-4">
            <p className="text-muted-foreground text-xs mb-2 font-bold uppercase" style={{ fontSize: 'var(--text-sm)' }}>
              Letzter Post-Klausur-Re-Check
            </p>
            <div className="flex items-center gap-4">
              <span
                className={`px-3 py-2 rounded-sm ${getGradeClassName(
                  lastPostExam.grade_prognosis,
                )}`}
                style={{ fontSize: 'var(--text-base)', fontWeight: 'bold' }}
              >
                {lastPostExam.score_pct}% · Note {lastPostExam.grade_prognosis}
              </span>
              <span className="text-muted-foreground" style={{ fontSize: 'var(--text-base)' }}>
                {formatDate(lastPostExam.created_at)}
              </span>
              {lastPostExam.session_id && (
                <span className="text-primary" style={{ fontSize: 'var(--text-sm)' }}>
                  Details ansehen
                </span>
              )}
            </div>
          </div>
        </button>
      )}

      {/* Upload Modal – real API */}
      <DocumentUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        subjectId={subject.id}
        subjectName={subject.name}
        onUploaded={(doc) => setDocuments((prev) => [...prev, doc])}
      />

      {/* Question Manager modal */}
      {isQuestionManagerOpen && (
        <QuestionManagerModal
          subjectId={subject.id}
          subjectName={subject.name}
          onClose={() => setIsQuestionManagerOpen(false)}
        />
      )}

      {isProfessorRequestOpen && (
        <ProfessorRequestModal
          subjectId={subject.id}
          subjectName={subject.name}
          onClose={() => setIsProfessorRequestOpen(false)}
        />
      )}
    </div>
  );
}
