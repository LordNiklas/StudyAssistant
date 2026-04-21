import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';
import { getLearningProfile, updateLearningProfile } from '../api/assessment';
import { LearningStyleOnboardingModal } from './LearningStyleOnboardingModal';
import { useAuth } from '../context/AuthContext';
import type { LearningStyle } from '../api/assessment';

const LEARNING_STYLE_LABEL: Record<LearningStyle, string> = {
  visual: 'Visuell',
  analytical: 'Analytisch',
  practical: 'Praktisch',
  mixed: 'Gemischt',
};

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const isSubjectsActive =
    location.pathname === '/' ||
    location.pathname.startsWith('/subject') ||
    location.pathname.startsWith('/assessment') ||
    location.pathname.startsWith('/result');
  const isLlmActive = location.pathname === '/llm';
  const isFlashcardsActive = location.pathname.startsWith('/flashcards');
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'onboarding' | 'settings'>('onboarding');
  const [isSavingStyle, setIsSavingStyle] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<LearningStyle>('mixed');
  const [activeStyle, setActiveStyle] = useState<LearningStyle>('mixed');

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getLearningProfile();
        setSelectedStyle(profile.style);
        setActiveStyle(profile.style);
        setModalMode(profile.onboarding_completed ? 'settings' : 'onboarding');
        setIsOnboardingOpen(!profile.onboarding_completed);
      } catch {
        setSelectedStyle('mixed');
        setActiveStyle('mixed');
      }
    };

    loadProfile();
  }, []);

  const handleSaveLearningStyle = async () => {
    setIsSavingStyle(true);
    setStyleError(null);
    try {
      const updated = await updateLearningProfile(selectedStyle, true);
      setActiveStyle(updated.style);
      setSelectedStyle(updated.style);
      setModalMode('settings');
      setIsOnboardingOpen(false);
      setSaveNotice('Lernstil gespeichert');
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : 'Lernstil konnte nicht gespeichert werden.');
    } finally {
      setIsSavingStyle(false);
    }
  };

  const handleSkipOnboarding = async () => {
    setIsSavingStyle(true);
    setStyleError(null);
    try {
      const updated = await updateLearningProfile('mixed', true);
      setActiveStyle(updated.style);
      setSelectedStyle(updated.style);
      setModalMode('settings');
      setIsOnboardingOpen(false);
      setSaveNotice('Lernstil auf Gemischt gesetzt');
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : 'Lernstil konnte nicht gespeichert werden.');
    } finally {
      setIsSavingStyle(false);
    }
  };

  const handleOpenStyleSettings = () => {
    setStyleError(null);
    setSelectedStyle(activeStyle);
    setModalMode('settings');
    setIsOnboardingOpen(true);
  };

  const handleCloseModal = () => {
    setStyleError(null);
    setSelectedStyle(activeStyle);
    if (modalMode === 'onboarding') {
      handleSkipOnboarding();
      return;
    }
    setIsOnboardingOpen(false);
  };

  useEffect(() => {
    if (!saveNotice) return;
    const timeoutId = window.setTimeout(() => setSaveNotice(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [saveNotice]);

  const profileName = user?.username?.trim() || 'Profil';
  const profileNameShort = profileName.split(/\s+/)[0] || 'Profil';
  const profileInitial = profileName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex w-full">
              <div className="shrink-0 flex items-center">
                <h1
                  className="text-foreground"
                  style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-weight-semi-bold)' }}
                >
                  Study Assistant
                </h1>
              </div>
              <div className='flex items-center justify-between w-full'>
                <div className="ml-8 flex space-x-4 items-center">
                  <Link
                    to="/"
                    className={`inline-flex items-center px-3 py-2 rounded-(--radius) transition-colors h-fit ${
                      isSubjectsActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={{ fontSize: 'var(--text-base)' }}
                  >
                    Fächer
                  </Link>
                  <Link
                    to="/llm"
                    className={`inline-flex items-center px-3 py-2 rounded-(--radius) transition-colors h-fit ${
                      isLlmActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={{ fontSize: 'var(--text-base)' }}
                  >
                    Frage stellen
                  </Link>
                  <Link
                    to="/flashcards"
                    className={`inline-flex items-center px-3 py-2 rounded-(--radius) transition-colors h-fit ${
                      isFlashcardsActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={{ fontSize: 'var(--text-base)' }}
                  >
                    Karteikarten
                  </Link>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenStyleSettings}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-(--radius) transition-all h-fit border-2 border-primary bg-primary/10 text-primary font-semibold shadow-(--elevation-sm) hover:bg-primary hover:text-primary-foreground hover:scale-[1.02]"
                    style={{ fontSize: 'var(--text-base)' }}
                    title="Lernstil anpassen"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    Lernstil anpassen: {LEARNING_STYLE_LABEL[activeStyle]}
                  </button>
                  {user && (
                    <Link
                      to="/settings"
                      className="inline-flex items-center gap-2 rounded-(--radius) px-2.5 py-1.5 transition-colors h-fit text-foreground hover:bg-accent hover:text-accent-foreground"
                      style={{ fontSize: 'var(--text-base)' }}
                      title="Einstellungen"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-sm font-semibold text-white">
                        {profileInitial}
                      </span>
                      <span className="text-base font-semibold text-gray-900">{profileNameShort}</span>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {saveNotice && (
        <div
          className="fixed left-1/2 bottom-6 -translate-x-1/2 z-70 px-5 py-3 rounded-(--radius) border border-[rgb(34,197,94)]/35 bg-[rgb(22,101,52)] text-[rgb(220,252,231)] shadow-(--elevation-sm)"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          {saveNotice}
        </div>
      )}

      <LearningStyleOnboardingModal
        isOpen={isOnboardingOpen}
        mode={modalMode}
        selectedStyle={selectedStyle}
        onSelect={setSelectedStyle}
        onSave={handleSaveLearningStyle}
        onClose={handleCloseModal}
        onSkip={handleSkipOnboarding}
        isSaving={isSavingStyle}
        error={styleError}
      />
    </div>
  );
}
