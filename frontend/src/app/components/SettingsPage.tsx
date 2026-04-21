import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Brain, Lock, LogOut, Save, Pencil, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCognitiveProfile } from '../api/assessment';
import type { CognitiveProfile } from '../api/assessment';

export function SettingsPage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Change Username section
  const [username, setUsername] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);

  // Change Password section
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [cognitiveProfile, setCognitiveProfile] = useState<CognitiveProfile | null>(null);
  const [isLoadingCognitive, setIsLoadingCognitive] = useState(true);
  const [cognitiveError, setCognitiveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoadingCognitive(true);
    setCognitiveError(null);

    getCognitiveProfile()
      .then((profile) => {
        if (!active) return;
        setCognitiveProfile(profile);
      })
      .catch((error: Error) => {
        if (!active) return;
        setCognitiveError(error.message || 'Kognitives Profil konnte nicht geladen werden');
      })
      .finally(() => {
        if (!active) return;
        setIsLoadingCognitive(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUsername(user?.username ?? '');
  }, [user?.username]);

  const handleUsernameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(null);
    setIsSavingUsername(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUsernameError(data.error || 'Fehler beim Speichern');
        if (data.error === 'Username already taken') {
          // focus the input
          const input = document.getElementById('username-input') as HTMLInputElement | null;
          input?.focus();
        }
      } else {
        if (data?.username) {
          updateUser({ username: data.username });
        }
        setUsernameSuccess('Benutzername gespeichert');
        setIsUsernameModalOpen(false);
      }
    } catch {
      setUsernameError('Netzwerkfehler');
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError('Neue Passwörter stimmen nicht überein');
      return;
    }

    setIsSavingPassword(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || 'Fehler beim Speichern');
      } else {
        setPasswordSuccess('Passwort geändert');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch {
      setPasswordError('Netzwerkfehler');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const formatMemberSince = () => {
    if (!user?.createdAt) {
      return 'Nicht verfügbar';
    }

    const parsed = new Date(user.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return 'Nicht verfügbar';
    }

    return parsed.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const displayName = user?.username?.trim() || 'Benutzer';
  const initial = displayName.charAt(0).toUpperCase();

  const formatUpdatedAt = (value?: string) => {
    if (!value) return 'Nicht verfügbar';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Nicht verfügbar';
    return parsed.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTempo = (tempo?: string) => {
    if (tempo === 'fast') return 'Schnell';
    if (tempo === 'slow') return 'Langsam';
    return 'Mittel';
  };

  const formatAbstraction = (value?: string) => {
    if (value === 'concrete') return 'Konkret';
    if (value === 'abstract') return 'Abstrakt';
    return 'Mittel';
  };

  const formatErrorType = (value: string) => {
    if (value === 'conceptual') return 'Konzeptionell';
    if (value === 'procedural') return 'Prozedural';
    if (value === 'memory') return 'Gedächtnis';
    if (value === 'mixed') return 'Gemischt';
    return value;
  };

  const getTopErrorTypes = () => {
    if (!cognitiveProfile?.error_pattern_bias || typeof cognitiveProfile.error_pattern_bias !== 'object') {
      return [] as Array<{ key: string; value: number }>;
    }

    const byErrorType = (cognitiveProfile.error_pattern_bias as { by_error_type?: Record<string, unknown> }).by_error_type;
    if (!byErrorType || typeof byErrorType !== 'object') {
      return [] as Array<{ key: string; value: number }>;
    }

    return Object.entries(byErrorType)
      .map(([key, value]) => ({ key, value: Number(value || 0) }))
      .filter((item) => Number.isFinite(item.value) && item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
  };

  const topErrorTypes = getTopErrorTypes();

  const confidenceLabel = (value?: string) => {
    if (value === 'high') return 'Hoch';
    if (value === 'medium') return 'Mittel';
    return 'Niedrig';
  };

  const confidenceClass = (value?: string) => {
    if (value === 'high') return 'bg-green-100 text-green-800';
    if (value === 'medium') return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10 pt-6">
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Mein Profil</h1>

        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-800 text-lg font-semibold text-white">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <p className="text-4xl font-semibold text-gray-900">{displayName}</p>
                <button
                  type="button"
                  onClick={() => setIsUsernameModalOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  aria-label="Namen ändern"
                  title="Namen ändern"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-gray-500">{user?.email ?? 'Keine E-Mail vorhanden'}</p>
            </div>
          </div>

          <div className="my-5 h-px bg-gray-200" />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm text-gray-400">User-ID</p>
              <p className="mt-1 text-2xl font-medium text-gray-900">{user?.id ?? '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Mitglied seit</p>
              <p className="mt-1 text-2xl font-medium text-gray-900">{formatMemberSince()}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 flex items-center gap-2 text-2xl font-semibold text-gray-800">
            <Brain className="h-5 w-5" />
            Dein kognitives Profil
          </h2>

          {isLoadingCognitive && <p className="text-sm text-gray-500">Profil wird geladen...</p>}
          {!isLoadingCognitive && cognitiveError && <p className="text-sm text-red-600">{cognitiveError}</p>}

          {!isLoadingCognitive && !cognitiveError && cognitiveProfile && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-400">Verarbeitungstempo</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{formatTempo(cognitiveProfile.tempo_score)}</p>
                  {cognitiveProfile.explanations?.tempo && (
                    <p className="mt-2 text-sm text-gray-600">{cognitiveProfile.explanations.tempo}</p>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-sm text-gray-400">Abstraktionsniveau</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">{formatAbstraction(cognitiveProfile.abstraction_score)}</p>
                  {cognitiveProfile.explanations?.abstraction && (
                    <p className="mt-2 text-sm text-gray-600">{cognitiveProfile.explanations.abstraction}</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-400">Häufige Fehlertypen</p>
                {topErrorTypes.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-600">Noch nicht genug Daten vorhanden.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topErrorTypes.map((item) => (
                      <span key={item.key} className="rounded bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                        {formatErrorType(item.key)}: {item.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-400">Konfidenz der Profilaussage</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className={`rounded px-3 py-1 text-sm font-semibold ${confidenceClass(cognitiveProfile.confidence?.class)}`}>
                    {confidenceLabel(cognitiveProfile.confidence?.class)}
                  </span>
                  {typeof cognitiveProfile.confidence?.score === 'number' && (
                    <span className="text-sm text-gray-600">Score: {cognitiveProfile.confidence.score}/100</span>
                  )}
                </div>
                {Array.isArray(cognitiveProfile.confidence?.reasons) && cognitiveProfile.confidence.reasons.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {cognitiveProfile.confidence.reasons.map((reason) => (
                      <p key={reason} className="text-xs text-gray-500">{reason}</p>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500">
                Letzte Aktualisierung: {formatUpdatedAt(cognitiveProfile.updated_at)}
              </p>
            </div>
          )}
        </section>

        {/* Change Password */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 flex items-center gap-2 text-2xl font-semibold text-gray-800">
            <Lock className="h-5 w-5" />
            Passwort ändern
          </h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-1">
                Aktuelles Passwort
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                disabled={isSavingPassword}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                Neues Passwort
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                disabled={isSavingPassword}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-gray-400">Mindestens 8 Zeichen</p>
            </div>
            <div>
              <label htmlFor="confirm-new-password" className="block text-sm font-medium text-gray-700 mb-1">
                Neues Passwort bestätigen
              </label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                required
                disabled={isSavingPassword}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>
            {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            {passwordSuccess && <p className="text-sm text-green-600">{passwordSuccess}</p>}
            <button
              type="submit"
              disabled={isSavingPassword}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingPassword ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Speichern…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Passwort ändern
                </>
              )}
            </button>
          </form>
        </section>

        {isUsernameModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <button
              type="button"
              aria-label="Modal schließen"
              className="absolute inset-0 bg-black/40"
              onClick={() => setIsUsernameModalOpen(false)}
            />
            <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Profil</p>
                  <h2 className="text-2xl font-semibold text-gray-900">Namen ändern</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUsernameModalOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  aria-label="Modal schließen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleUsernameSubmit} className="space-y-4">
                <div>
                  <label htmlFor="username-input" className="block text-sm font-medium text-gray-700 mb-1">
                    Vollständiger Name
                  </label>
                  <input
                    id="username-input"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    disabled={isSavingUsername}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
                  />
                  {usernameError && <p className="mt-1 text-sm text-red-600">{usernameError}</p>}
                  {usernameSuccess && <p className="mt-1 text-sm text-green-600">{usernameSuccess}</p>}
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsUsernameModalOpen(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingUsername}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingUsername ? (
                      <>
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Speichern…
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Speichern
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Logout */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-3 flex items-center gap-2 text-2xl font-semibold text-gray-800">
            <LogOut className="h-5 w-5" />
            Abmelden
          </h2>
          <p className="mb-4 text-sm text-gray-400">Melden Sie sich von Ihrem Konto ab. Sie können sich jederzeit wieder anmelden.</p>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </button>
        </section>
      </div>
    </div>
  );
}
