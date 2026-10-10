import { TablePagination, useTablePagination } from './components/TablePagination';
import { FormEvent, lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { checkApiHealth, getUsers, getPiDashboard, piDataMode } from './api';
import { piDateBounds, piIsoDate } from './piData';
import DatePicker from './DatePicker';
import { asDate, exportAttendanceCsv, Skeleton, tabLabel, presenceTab, shouldResetTab, timestampMillis, type AttendanceRange, type Tab, type Toast } from './dashboardShared';
import PersonalizedBentoDashboard from './components/PersonalizedBentoDashboard';
import { auth, db } from './firebase';
import { translations, type Copy, type Language } from './i18n';
import { createMockData, localIsoDate, offsetIsoDate, startOfCurrentWeek } from './mockData';
import './connection-status.css';
import './qol.css';
import './bento-dashboard.css';
import type { Attendance, Camera, ManagedUser, UnknownEvent, UserSession } from './types';

type Theme = 'dark' | 'light';
type ThemeSetting = 'dark' | 'light';
type LayoutMode = 'bento' | 'classic';
type AuthMode = 'sign-in' | 'sign-up' | 'reset';
type LoadingState = { attendance: boolean; unknown: boolean; cameras: boolean; users: boolean };

const tabs: Tab[] = ['overview', 'attendance', 'recog', 'users', 'unknown', 'devices', 'admin'];
const CAMERA_HEARTBEAT_TIMEOUT_MS = 35_000;
const today = () => piDataMode ? piIsoDate() : localIsoDate();
const UsersView = lazy(() => import('./views/UsersView'));
const UnknownView = lazy(() => import('./views/UnknownView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PiPanel = lazy(() => import('./components/PiPanel'));

function cameraHeartbeatOnline(camera: Camera, now: number) {
  const lastSeen = timestampMillis(camera.last_seen);
  return camera.status === 'online' && lastSeen > 0 && now - lastSeen <= CAMERA_HEARTBEAT_TIMEOUT_MS;
}

function attendanceBounds(tab: Tab, range: AttendanceRange, customDate: string) {
  if (piDataMode) return piDateBounds(tab === 'overview' ? 'overview' : range, customDate);
  if (tab === 'overview' || range === 'today') return { start: today(), end: today() };
  if (range === 'yesterday') return { start: offsetIsoDate(-1), end: offsetIsoDate(-1) };
  if (range === 'week') return { start: startOfCurrentWeek(), end: today() };
  return { start: customDate, end: customDate };
}

function authErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

function dataError(error: Error, copy: Copy) {
  if (/index.*building|query requires an index/i.test(error.message)) return copy.errors.indexBuilding;
  if (/permission|permission-denied/i.test(error.message)) return copy.errors.permission;
  return copy.errors.data;
}

function isMissingFirestore(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return /database \(default\) does not exist|datastore\/setup/i.test(message);
}

function LiveClock({ use24Hour, showSeconds, copy }: { use24Hour: boolean; showSeconds: boolean; copy: Copy }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), showSeconds ? 1000 : 60_000);
    return () => window.clearInterval(timer);
  }, [showSeconds]);
  const time = now.toLocaleTimeString(copy.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: !use24Hour,
  });
  const date = now.toLocaleDateString(copy.locale, { weekday: 'short', day: '2-digit', month: 'short' });
  return <div className="live-clock" aria-label={`${copy.common.time}: ${time}`}><strong>{time}</strong><span>{date}</span></div>;
}

function LegalFooter({ copy, onOpenPrivacy }: { copy: Copy; onOpenPrivacy?: () => void }) {
  return (
    <footer className="legal-footer">
      <div className="legal-footer-inner">
        <span className="legal-copy">© {new Date().getFullYear()} SIC Smart Attendance</span>
        <span className="legal-sep" aria-hidden="true">·</span>
        {onOpenPrivacy ? (
          <button type="button" className="legal-link-btn" onClick={onOpenPrivacy}>
            <span className="legal-icon" aria-hidden="true">🛡</span>
            <span>{copy.legal.privacy}</span>
          </button>
        ) : (
          <a href="/privacy.html" className="legal-link-btn">
            <span className="legal-icon" aria-hidden="true">🛡</span>
            <span>{copy.legal.privacy}</span>
          </a>
        )}
      </div>
    </footer>
  );
}

function PrivacyDialog({ copy, onClose }: { copy: Copy; onClose: () => void }) {
  return (
    <div className="privacy-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className="privacy-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <div className="privacy-header">
          <div className="privacy-header-text">
            <span className="privacy-badge">
              <span className="privacy-shield-icon" aria-hidden="true">🛡</span>
              {copy.legal.privacyDialogEyebrow}
            </span>
            <h2 id="privacy-title">{copy.legal.privacyDialogTitle}</h2>
            <p className="privacy-updated">{copy.legal.privacyLastUpdated}</p>
          </div>
          <button className="settings-close" onClick={onClose} aria-label={copy.common.close}>×</button>
        </div>

        <div className="privacy-body">
          <div className="privacy-card">
            <div className="privacy-card-header">
              <span className="privacy-card-num">01</span>
              <h3>{copy.legal.privacySection1Title}</h3>
            </div>
            <p>{copy.legal.privacySection1Text}</p>
          </div>

          <div className="privacy-card">
            <div className="privacy-card-header">
              <span className="privacy-card-num">02</span>
              <h3>{copy.legal.privacySection2Title}</h3>
            </div>
            <p>{copy.legal.privacySection2Text}</p>
          </div>

          <div className="privacy-card">
            <div className="privacy-card-header">
              <span className="privacy-card-num">03</span>
              <h3>{copy.legal.privacySection3Title}</h3>
            </div>
            <p>{copy.legal.privacySection3Text}</p>
          </div>

          <div className="privacy-card">
            <div className="privacy-card-header">
              <span className="privacy-card-num">04</span>
              <h3>{copy.legal.privacySection4Title}</h3>
            </div>
            <p>{copy.legal.privacySection4Text}</p>
          </div>

          <div className="privacy-card">
            <div className="privacy-card-header">
              <span className="privacy-card-num">05</span>
              <h3>{copy.legal.privacySection5Title}</h3>
            </div>
            <p>{copy.legal.privacySection5Text}</p>
          </div>
        </div>

        <div className="privacy-footer">
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="privacy-external-link">
            <span>{copy.legal.privacyViewFullDoc}</span>
            <span aria-hidden="true">↗</span>
          </a>
          <button type="button" className="privacy-close-btn" onClick={onClose}>
            {copy.legal.privacyClose}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({ copy, language, themeSetting, layoutMode, use24Hour, showSeconds, demoMode, user, username, userPfp, onLanguage, onThemeSetting, onLayoutMode, onUse24Hour, onShowSeconds, onDemoMode, onUpdateAvatar, onSignOut, onClose }: {
  copy: Copy;
  language: Language;
  themeSetting: ThemeSetting;
  layoutMode: LayoutMode;
  use24Hour: boolean;
  showSeconds: boolean;
  demoMode: boolean;
  user?: User | null;
  username?: string;
  userPfp?: string | null;
  onLanguage: (value: Language) => void;
  onThemeSetting: (value: ThemeSetting) => void;
  onLayoutMode: (value: LayoutMode) => void;
  onUse24Hour: (value: boolean) => void;
  onShowSeconds: (value: boolean) => void;
  onDemoMode: (value: boolean) => void;
  onUpdateAvatar?: (dataUrl: string | null) => void;
  onSignOut?: () => void;
  onClose: () => void;
}) {
  return <div className="settings-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-title">
        <div><p className="eyebrow">{copy.settings.eyebrow}</p><h2 id="settings-title">{copy.settings.title}</h2></div>
        <button className="settings-close" onClick={onClose} aria-label={copy.common.close}>×</button>
      </div>
      {user && onUpdateAvatar && (
        <div className="pfp-setting">
          <strong>{copy.settings.pfp}</strong><small>{copy.settings.pfpHint}</small>
          <div className="pfp-row">
            <div className="pfp-preview">
              {userPfp ? (
                <img src={userPfp} alt="" className="pfp-preview-img" />
              ) : (
                <span className="pfp-initials">
                  {((username || user.displayName || user.email || 'U').slice(0, 2)).toUpperCase()}
                </span>
              )}
            </div>
            <div className="pfp-actions">
              <label className="pfp-upload-label">
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = e => {
                      const img = new Image();
                      img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const size = 128;
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          const minDim = Math.min(img.width, img.height);
                          const sx = (img.width - minDim) / 2;
                          const sy = (img.height - minDim) / 2;
                          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
                          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                          onUpdateAvatar(dataUrl);
                        }
                      };
                      img.src = e.target?.result as string;
                    };
                    reader.readAsDataURL(file);
                    event.target.value = '';
                  }}
                />
                <span className="pfp-btn primary">{copy.settings.pfpChange}</span>
              </label>
              {userPfp && (
                <button
                  type="button"
                  className="pfp-btn secondary"
                  onClick={() => onUpdateAvatar(null)}
                >
                  {copy.settings.pfpRemove}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="theme-setting">
        <strong>{copy.settings.appearance}</strong><small>{copy.settings.appearanceHint}</small>
        <div className="theme-options" role="group" aria-label={copy.settings.colorTheme}>
          <button className={themeSetting === 'dark' ? 'theme-option active' : 'theme-option'} onClick={() => onThemeSetting('dark')} aria-pressed={themeSetting === 'dark'}><span aria-hidden="true">☾</span>{copy.settings.dark}</button>
          <button className={themeSetting === 'light' ? 'theme-option active' : 'theme-option'} onClick={() => onThemeSetting('light')} aria-pressed={themeSetting === 'light'}><span aria-hidden="true">☀</span>{copy.settings.light}</button>
        </div>
      </div>
      <div className="theme-setting">
        <strong>{copy.settings.layoutMode}</strong><small>{copy.settings.layoutModeHint}</small>
        <div className="theme-options" role="group" aria-label={copy.settings.layoutMode}>
          <button className={layoutMode === 'bento' ? 'theme-option active' : 'theme-option'} onClick={() => onLayoutMode('bento')} aria-pressed={layoutMode === 'bento'}><span aria-hidden="true">⚡</span>{copy.settings.layoutBento}</button>
          <button className={layoutMode === 'classic' ? 'theme-option active' : 'theme-option'} onClick={() => onLayoutMode('classic')} aria-pressed={layoutMode === 'classic'}><span aria-hidden="true">↩</span>{copy.settings.layoutClassic}</button>
        </div>
      </div>
      <div className="language-setting">
        <strong>{copy.settings.language}</strong><small>{copy.settings.languageHint}</small>
        <div className="language-options" role="group" aria-label={copy.settings.language}>
          <button className={language === 'en' ? 'language-option active' : 'language-option'} onClick={() => onLanguage('en')} aria-pressed={language === 'en'}>EN <span>{copy.settings.english}</span></button>
          <button className={language === 'vi' ? 'language-option active' : 'language-option'} onClick={() => onLanguage('vi')} aria-pressed={language === 'vi'}>VI <span>{copy.settings.vietnamese}</span></button>
        </div>
      </div>
      <label className="toggle-row"><span><strong>{copy.settings.clock24}</strong><small>{copy.settings.clock24Hint}</small></span><input type="checkbox" checked={use24Hour} onChange={event => onUse24Hour(event.target.checked)} /></label>
      <label className="toggle-row"><span><strong>{copy.settings.seconds}</strong><small>{copy.settings.secondsHint}</small></span><input type="checkbox" checked={showSeconds} onChange={event => onShowSeconds(event.target.checked)} /></label>
      <label className="toggle-row demo-toggle"><span><strong>{copy.settings.demo}</strong><small>{copy.settings.demoHint}</small></span><input type="checkbox" checked={demoMode} onChange={event => onDemoMode(event.target.checked)} /></label>
      {onSignOut && <button className="settings-signout" onClick={onSignOut}>{copy.settings.signOut}</button>}
      <p className="settings-note">{copy.settings.saved}</p>
    </section>
  </div>;
}

function Login({ copy, language, themeSetting, layoutMode, use24Hour, showSeconds, demoMode, onLanguage, onThemeSetting, onLayoutMode, onUse24Hour, onShowSeconds, onDemoMode, onRegistrationState }: {
  copy: Copy;
  language: Language;
  themeSetting: ThemeSetting;
  layoutMode: LayoutMode;
  use24Hour: boolean;
  showSeconds: boolean;
  demoMode: boolean;
  onLanguage: (value: Language) => void;
  onThemeSetting: (value: ThemeSetting) => void;
  onLayoutMode: (value: LayoutMode) => void;
  onUse24Hour: (value: boolean) => void;
  onShowSeconds: (value: boolean) => void;
  onDemoMode: (value: boolean) => void;
  onRegistrationState: (value: boolean) => void;
}) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [signingIn, setSigningIn] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function submitSignIn(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      const code = authErrorCode(error);
      setMessageType('error');
      setMessage(code === 'auth/user-not-found' ? copy.auth.accountMissing : code === 'auth/wrong-password' ? copy.auth.wrongPassword : code === 'auth/invalid-credential' ? copy.auth.invalidCredential : copy.auth.signInFailed);
      setSigningIn(false);
    }
  }

  async function submitSignUp(event: FormEvent) {
    event.preventDefault();
    setMessageType('error');
    const cleanUsername = username.trim();
    const normalizedUsername = cleanUsername.toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(cleanUsername)) return setMessage(copy.auth.usernameInvalid);
    if (!dateOfBirth) return setMessage(copy.auth.chooseDob);
    if (password.length < 6) return setMessage(copy.auth.shortPassword);
    if (password !== confirmPassword) return setMessage(copy.auth.mismatch);
    setCreating(true);
    setMessage('');
    onRegistrationState(true);
    let createdUser: User | null = null;
    let profileCreated = false;
    try {
      createdUser = (await createUserWithEmailAndPassword(auth, email.trim(), password)).user;
      await runTransaction(db, async transaction => {
        const usernameReference = doc(db, 'usernames', normalizedUsername);
        if ((await transaction.get(usernameReference)).exists()) throw new Error('USERNAME_TAKEN');
        transaction.set(usernameReference, { uid: createdUser!.uid, created_at: serverTimestamp() });
        transaction.set(doc(db, 'accounts', createdUser!.uid), {
          username: cleanUsername,
          username_normalized: normalizedUsername,
          date_of_birth: dateOfBirth,
          email: createdUser!.email,
          email_verified: false,
          requires_email_verification: true,
          created_at: serverTimestamp(),
        });
      });
      profileCreated = true;
      await updateProfile(createdUser, { displayName: cleanUsername });
      await sendEmailVerification(createdUser);
      await signOut(auth);
      setMode('sign-in');
      setPassword('');
      setConfirmPassword('');
      setMessageType('success');
      setMessage(copy.auth.created);
    } catch (error) {
      if (createdUser && !profileCreated) await deleteUser(createdUser).catch(() => undefined);
      const code = authErrorCode(error);
      setMessageType('error');
      setMessage(isMissingFirestore(error) ? copy.auth.firestoreMissing : error instanceof Error && error.message === 'USERNAME_TAKEN' ? copy.auth.usernameTaken : code === 'auth/email-already-in-use' ? copy.auth.emailUsed : copy.auth.createFailed);
    } finally {
      onRegistrationState(false);
      setCreating(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    setResetting(true);
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessageType('success');
      setMessage(copy.auth.resetSent);
    } catch {
      setMessageType('error');
      setMessage(copy.auth.resetFailed);
    } finally {
      setResetting(false);
    }
  }

  function showMode(value: AuthMode) {
    setMode(value);
    setMessage('');
  }

  const cardClass = `login-card${signingIn ? ' signing-in' : ''}${mode === 'sign-up' ? ' signup-card' : ''}`;
  return (
    <main className="login-shell">
      <div className="auth-corner-tools">
        <LiveClock use24Hour={use24Hour} showSeconds={showSeconds} copy={copy} />
        <button className="auth-settings-button" onClick={() => setSettingsOpen(true)} aria-label={copy.auth.openSettings}>⚙</button>
      </div>

      <div className="login-stage">
        <section className="login-hero-showcase">
          <div className="hero-brand-badge">
            <div className="hero-logo-icon">
              <span className="hero-hex-icon" aria-hidden="true">⬡</span>
            </div>
            <div className="hero-brand-meta">
              <span className="hero-product-name">SIC SMART ATTENDANCE</span>
              <span className="hero-version-pill">{copy.auth.badgeEnterprise}</span>
            </div>
          </div>

          <div className="hero-headline-block">
            <h1 className="hero-main-title">{copy.auth.heroTitle}</h1>
            <p className="hero-main-subtitle">{copy.auth.heroSubtitle}</p>
          </div>

          <div className="hero-stats-grid">
            <div className="hero-stat-card">
              <div className="stat-card-icon">📹</div>
              <div className="stat-card-text">
                <strong>{copy.auth.featureMultiCam}</strong>
                <span>Camera 1 · Camera 2 · Camera 3</span>
              </div>
              <span className="stat-pulse-dot" title="Active stream">●</span>
            </div>

            <div className="hero-stat-card">
              <div className="stat-card-icon">⚡</div>
              <div className="stat-card-text">
                <strong>{copy.auth.featureSpeed}</strong>
                <span>buffalo_sc · MBF ONNX</span>
              </div>
            </div>

            <div className="hero-stat-card">
              <div className="stat-card-icon">🛡</div>
              <div className="stat-card-text">
                <strong>{copy.auth.featureSecurity}</strong>
                <span>Zero raw photo storage</span>
              </div>
            </div>
          </div>

          <div className="hero-quote-card">
            <p className="hero-quote-text">"{copy.auth.featureTagline}"</p>
          </div>
        </section>

        <div className="login-form-wrapper">
          <section className={cardClass}>
            <div className="login-card-header">
              <p className="eyebrow">{copy.auth.system}</p>
              <span className="login-card-status">
                <span className="dot good"></span>
                {copy.common.online}
              </span>
            </div>

            {mode !== 'reset' && (
              <div className="auth-tabs" data-mode={mode} role="tablist" aria-label={copy.auth.access}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'sign-in'}
                  className={mode === 'sign-in' ? 'active' : ''}
                  onClick={() => showMode('sign-in')}
                >
                  {copy.auth.signIn}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'sign-up'}
                  className={mode === 'sign-up' ? 'active' : ''}
                  onClick={() => showMode('sign-up')}
                >
                  {copy.auth.signUp}
                </button>
              </div>
            )}

            {mode === 'sign-in' && (
              <div className="auth-view">
                <div className="auth-title-group">
                  <h2 className="auth-main-heading">{copy.auth.welcomeBack}</h2>
                  <p className="muted">{copy.auth.signInHint}</p>
                </div>
                <form onSubmit={submitSignIn} className="auth-form-styled">
                  <label className="auth-input-label">
                    <span>{copy.auth.email}</span>
                    <div className="input-with-icon">
                      <span className="input-icon" aria-hidden="true">✉</span>
                      <input
                        value={email}
                        type="email"
                        placeholder="name@example.com"
                        onChange={event => setEmail(event.target.value)}
                        disabled={signingIn}
                        autoComplete="email"
                        required
                      />
                    </div>
                  </label>

                  <label className="auth-input-label">
                    <div className="label-row-between">
                      <span>{copy.auth.password}</span>
                      <button
                        type="button"
                        className="text-button auth-link-inline"
                        disabled={signingIn}
                        onClick={() => showMode('reset')}
                      >
                        {copy.auth.forgot}
                      </button>
                    </div>
                    <div className="input-with-icon">
                      <span className="input-icon" aria-hidden="true">🔒</span>
                      <input
                        value={password}
                        type={showPass ? 'text' : 'password'}
                        placeholder="••••••••"
                        onChange={event => setPassword(event.target.value)}
                        disabled={signingIn}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="pass-visibility-btn"
                        onClick={() => setShowPass(s => !s)}
                        title={showPass ? copy.auth.hidePassword : copy.auth.showPassword}
                        tabIndex={-1}
                      >
                        {showPass ? '👁‍🗨' : '👁'}
                      </button>
                    </div>
                  </label>

                  <button type="submit" className="auth-submit-btn" disabled={signingIn}>
                    {signingIn ? (
                      <span className="signing-label">
                        <i className="login-spinner" aria-hidden="true" />
                        {copy.auth.signingIn}
                      </span>
                    ) : (
                      copy.auth.signIn
                    )}
                  </button>

                  {message && <div className={`auth-notice ${messageType}`} role="alert">{message}</div>}
                </form>
              </div>
            )}

            {mode === 'sign-up' && (
              <div className="auth-view">
                <div className="auth-title-group">
                  <h2 className="auth-main-heading">{copy.auth.welcome}</h2>
                  <p className="muted">{copy.auth.signUpHint}</p>
                </div>
                <form onSubmit={submitSignUp} className="auth-form-styled">
                  <label className="auth-input-label">
                    <span>{copy.auth.username}</span>
                    <div className="input-with-icon">
                      <span className="input-icon" aria-hidden="true">👤</span>
                      <input
                        value={username}
                        placeholder="username"
                        onChange={event => setUsername(event.target.value)}
                        minLength={3}
                        maxLength={24}
                        pattern="[A-Za-z0-9_]+"
                        autoComplete="username"
                        required
                      />
                    </div>
                  </label>

                  <DatePicker
                    label={copy.auth.dob}
                    value={dateOfBirth}
                    onChange={setDateOfBirth}
                    max={today()}
                    defaultViewYear={new Date().getFullYear() - 18}
                    yearStart={new Date().getFullYear() - 100}
                    yearEnd={new Date().getFullYear()}
                    showToday={false}
                    language={language}
                  />

                  <label className="auth-input-label">
                    <span>{copy.auth.email}</span>
                    <div className="input-with-icon">
                      <span className="input-icon" aria-hidden="true">✉</span>
                      <input
                        value={email}
                        type="email"
                        placeholder="name@example.com"
                        onChange={event => setEmail(event.target.value)}
                        autoComplete="email"
                        required
                      />
                    </div>
                  </label>

                  <div className="signup-passwords">
                    <label className="auth-input-label">
                      <span>{copy.auth.password}</span>
                      <div className="input-with-icon">
                        <span className="input-icon" aria-hidden="true">🔒</span>
                        <input
                          value={password}
                          type={showPass ? 'text' : 'password'}
                          minLength={6}
                          placeholder="••••••"
                          onChange={event => setPassword(event.target.value)}
                          autoComplete="new-password"
                          required
                        />
                      </div>
                    </label>
                    <label className="auth-input-label">
                      <span>{copy.auth.confirmPassword}</span>
                      <div className="input-with-icon">
                        <span className="input-icon" aria-hidden="true">🔒</span>
                        <input
                          value={confirmPassword}
                          type={showPass ? 'text' : 'password'}
                          minLength={6}
                          placeholder="••••••"
                          onChange={event => setConfirmPassword(event.target.value)}
                          autoComplete="new-password"
                          required
                        />
                      </div>
                    </label>
                  </div>

                  <button type="submit" className="auth-submit-btn" disabled={creating}>
                    {creating ? copy.auth.creating : copy.auth.create}
                  </button>

                  <small className="signup-help">{copy.auth.signUpHelp}</small>
                  {message && <div className={`auth-notice ${messageType}`} role="alert">{message}</div>}
                </form>
              </div>
            )}

            {mode === 'reset' && (
              <div className="auth-view">
                <div className="auth-title-group">
                  <h2 className="auth-main-heading">{copy.auth.resetTitle}</h2>
                  <p className="muted">{copy.auth.resetHint}</p>
                </div>
                <form onSubmit={submitReset} className="auth-form-styled">
                  <label className="auth-input-label">
                    <span>{copy.auth.email}</span>
                    <div className="input-with-icon">
                      <span className="input-icon" aria-hidden="true">✉</span>
                      <input
                        value={email}
                        type="email"
                        placeholder="name@example.com"
                        onChange={event => setEmail(event.target.value)}
                        autoFocus
                        required
                      />
                    </div>
                  </label>
                  <button type="submit" className="auth-submit-btn" disabled={resetting}>
                    {resetting ? copy.auth.sendingReset : copy.auth.sendReset}
                  </button>
                  <button type="button" className="text-button auth-link" onClick={() => showMode('sign-in')}>
                    {copy.auth.back}
                  </button>
                  {message && <div className={`auth-notice ${messageType}`} role="status">{message}</div>}
                </form>
              </div>
            )}
          </section>

          <LegalFooter copy={copy} onOpenPrivacy={() => setPrivacyOpen(true)} />
        </div>
      </div>

      {settingsOpen && (
        <SettingsDialog
          copy={copy}
          language={language}
          themeSetting={themeSetting}
          layoutMode={layoutMode}
          use24Hour={use24Hour}
          showSeconds={showSeconds}
          demoMode={demoMode}
          onLanguage={onLanguage}
          onThemeSetting={onThemeSetting}
          onLayoutMode={onLayoutMode}
          onUse24Hour={onUse24Hour}
          onShowSeconds={onShowSeconds}
          onDemoMode={onDemoMode}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {privacyOpen && (
        <PrivacyDialog copy={copy} onClose={() => setPrivacyOpen(false)} />
      )}
    </main>
  );
}

function App() {
  const registering = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [tab, setTab] = useState<Tab>(() => (tabs.includes(localStorage.getItem('smartattend-tab') as Tab) ? localStorage.getItem('smartattend-tab') as Tab : 'overview'));
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [unknown, setUnknown] = useState<UnknownEvent[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [, setCamerasLoaded] = useState(false);
  const [heartbeatNow, setHeartbeatNow] = useState(() => Date.now());
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState<LoadingState>({ attendance: false, unknown: false, cameras: false, users: false });
  const [piOnline, setPiOnline] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [date, setDate] = useState(today());
  const [attendanceRange, setAttendanceRange] = useState<AttendanceRange>('today');
  const [search, setSearch] = useState('');
  const [cameraFilter, setCameraFilter] = useState<string>('all');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(() => {
    const saved = localStorage.getItem('smartattend-theme-setting');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'dark';
  });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => (localStorage.getItem('smartattend-layout-mode') as LayoutMode) || 'bento');
  const resolvedTheme: Theme = themeSetting;

  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('smartattend-language') === 'vi' ? 'vi' : 'en');
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem('smartattend-demo') === 'true');
  const [use24Hour, setUse24Hour] = useState(() => localStorage.getItem('smartattend-clock-24') === 'true');
  const [showSeconds, setShowSeconds] = useState(() => localStorage.getItem('smartattend-clock-seconds') === 'true');
  const [userPfp, setUserPfp] = useState<string | null>(() => {
    const savedUid = user?.uid;
    if (savedUid) {
      return localStorage.getItem(`smartattend-pfp-${savedUid}`) || user?.photoURL || null;
    }
    return null;
  });

  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`smartattend-pfp-${user.uid}`) || user.photoURL || null;
      setUserPfp(saved);
    } else {
      setUserPfp(null);
    }
  }, [user]);

  const copy = translations[language];

  const mock = useMemo(() => createMockData(language), [language]);
  const visibleTabs = useMemo(() => isAdmin ? tabs : tabs.filter(key => key !== 'users' && key !== 'unknown' && key !== 'admin' && key !== 'recog'), [isAdmin]);
  const notify = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, message, type }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 3200);
  }, []);

  const handleUpdateAvatar = useCallback((dataUrl: string | null) => {
    if (!user) return;
    if (dataUrl) {
      try {
        localStorage.setItem(`smartattend-pfp-${user.uid}`, dataUrl);
      } catch {
        // quota safety
      }
      setUserPfp(dataUrl);
      if (auth.currentUser) {
        updateProfile(auth.currentUser, { photoURL: dataUrl.length <= 2000 ? dataUrl : undefined }).catch(() => {});
      }
      notify(copy.settings.pfpUpdated, 'success');
    } else {
      try {
        localStorage.removeItem(`smartattend-pfp-${user.uid}`);
      } catch {
        // safety
      }
      setUserPfp(null);
      if (auth.currentUser) {
        updateProfile(auth.currentUser, { photoURL: '' }).catch(() => {});
      }
      notify(copy.settings.pfpRemoved, 'info');
    }
  }, [user, copy.settings.pfpUpdated, copy.settings.pfpRemoved, notify]);

  const [resendingEmail, setResendingEmail] = useState(false);
  const handleResendVerification = useCallback(async () => {
    if (!user) return;
    setResendingEmail(true);
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        setUser(auth.currentUser);
        notify('Email is now verified!', 'success');
        return;
      }
      await sendEmailVerification(user);
      notify('Verification email sent!', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to send verification email', 'error');
    } finally {
      setResendingEmail(false);
    }
  }, [user, notify]);

  useEffect(() => {
    if (!user || user.emailVerified) return;
    const checkVerified = async () => {
      await user.reload().catch(() => undefined);
      if (auth.currentUser?.emailVerified) {
        setUser(auth.currentUser);
      }
    };
    window.addEventListener('focus', checkVerified);
    return () => window.removeEventListener('focus', checkVerified);
  }, [user]);

  useEffect(() => onAuthStateChanged(auth, currentUser => {
    if (registering.current) return;
    setUser(currentUser);
    setAttendance([]); setUnknown([]); setUsers([]); setCameras([]); setCamerasLoaded(false);
    setIsAdmin(false);
    setRoleChecked(!currentUser);
    if (currentUser) {
      void currentUser.getIdTokenResult().then(token => {
        if (auth.currentUser?.uid === currentUser.uid) {
          setIsAdmin(token.claims.admin === true);
          setRoleChecked(true);
        }
      }).catch(() => {
        if (auth.currentUser?.uid === currentUser.uid) { setIsAdmin(false); setRoleChecked(true); }
      });
    }
  }), []);

  useEffect(() => {
    if (shouldResetTab(tab, isAdmin, roleChecked)) setTab('overview');
  }, [isAdmin, roleChecked, tab]);

  useEffect(() => {
    if (!user || (!user.emailVerified && !isAdmin)) return;
    let active = true;
    const reportPresence = () => {
      if (!active) return;
      void setDoc(doc(db, 'sessions', user.uid), {
        uid: user.uid,
        email: user.email ?? '',
        display_name: user.displayName ?? user.email?.split('@')[0] ?? copy.common.user,
        current_tab: presenceTab(tab),
        visibility: document.visibilityState === 'visible' ? 'active' : 'hidden',
        last_seen: serverTimestamp(),
      }).catch(() => undefined);
    };
    reportPresence();
    const timer = window.setInterval(reportPresence, 20_000);
    document.addEventListener('visibilitychange', reportPresence);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reportPresence);
    };
  }, [user, isAdmin, tab, copy.common.user]);

  useEffect(() => {
    if (piDataMode || !user || (!user.emailVerified && !isAdmin) || demoMode || (tab !== 'overview' && tab !== 'attendance')) {
      setLoading(current => ({ ...current, attendance: false }));
      return;
    }
    setLoading(current => ({ ...current, attendance: true }));
    const bounds = attendanceBounds(tab, attendanceRange, date);
    const attendanceQuery = bounds.start === bounds.end
      ? query(collection(db, 'attendance'), where('date', '==', bounds.start), orderBy('timestamp', 'desc'), limit(200))
      : query(collection(db, 'attendance'), where('date', '>=', bounds.start), where('date', '<=', bounds.end), orderBy('date', 'desc'), orderBy('timestamp', 'desc'), limit(500));
    return onSnapshot(attendanceQuery, snapshot => {
      setAttendance(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Attendance)));
      setLoading(current => ({ ...current, attendance: false }));
    }, failure => {
      setError(dataError(failure, copy));
      setLoading(current => ({ ...current, attendance: false }));
    });
  }, [user, isAdmin, demoMode, tab, attendanceRange, date, copy]);

  useEffect(() => {
    if (piDataMode || !user || !isAdmin || demoMode || (tab !== 'overview' && tab !== 'unknown')) {
      setLoading(current => ({ ...current, unknown: false }));
      return;
    }
    setLoading(current => ({ ...current, unknown: true }));
    const unknownQuery = query(collection(db, 'unknown_events'), orderBy('timestamp', 'desc'), limit(100));
    return onSnapshot(unknownQuery, snapshot => {
      setUnknown(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as UnknownEvent)));
      setLoading(current => ({ ...current, unknown: false }));
    }, failure => {
      setError(dataError(failure, copy));
      setLoading(current => ({ ...current, unknown: false }));
    });
  }, [user, isAdmin, demoMode, tab, copy]);

  useEffect(() => {
    if (!user || !isAdmin || tab !== 'admin') {
      setSessions([]);
      return;
    }
    return onSnapshot(query(collection(db, 'sessions')), snapshot => {
      setSessions(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as UserSession)));
    }, failure => setError(dataError(failure, copy)));
  }, [user, isAdmin, tab, copy]);

  useEffect(() => {
    if (piDataMode || !user || (!user.emailVerified && !isAdmin) || demoMode) {
      setCamerasLoaded(false);
      setLoading(current => ({ ...current, cameras: false }));
      return;
    }
    setLoading(current => ({ ...current, cameras: true }));
    const cameraQuery = query(collection(db, 'cameras'), orderBy('name'));
    return onSnapshot(cameraQuery, snapshot => {
      setCameras(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Camera)));
      setCamerasLoaded(true);
      setLoading(current => ({ ...current, cameras: false }));
    }, failure => {
      setError(dataError(failure, copy));
      setCamerasLoaded(true);
      setLoading(current => ({ ...current, cameras: false }));
    });
  }, [user, isAdmin, demoMode, copy]);

  useEffect(() => {
    if (!user) return;
    setHeartbeatNow(Date.now());
    const timer = window.setInterval(() => setHeartbeatNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [user]);

  const refreshUsers = useCallback(async () => {
    if (!roleChecked || !isAdmin || demoMode || (piDataMode ? !piOnline : apiOnline !== true)) return;
    const expectedUid = auth.currentUser?.uid;
    setLoading(current => ({ ...current, users: true }));
    try {
      const rows = await getUsers();
      if (auth.currentUser?.uid === expectedUid) setUsers(rows);
    } catch {
      setUsers([]);
    } finally {
      setLoading(current => ({ ...current, users: false }));
    }
  }, [roleChecked, isAdmin, demoMode, apiOnline, piOnline]);

  useEffect(() => {
    if (piDataMode || !user || !isAdmin || demoMode || apiOnline !== true || (tab !== 'overview' && tab !== 'users')) {
      setLoading(current => ({ ...current, users: false }));
      return;
    }
    void refreshUsers();
  }, [user, isAdmin, demoMode, apiOnline, tab, refreshUsers]);

  useEffect(() => {
    if (!piDataMode) return;
    if (!user || !roleChecked || !isAdmin || demoMode) {
      setAttendance([]); setUnknown([]); setUsers([]); setCameras([]); setPiOnline(false);
      setLoading({ attendance: false, unknown: false, cameras: false, users: false });
      return;
    }
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    setAttendance([]); setUnknown([]);
    setLoading({ attendance: true, unknown: true, cameras: true, users: true });
    const poll = async () => {
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 30_000);
      const bounds = attendanceBounds(tab, attendanceRange, date);
      try {
        const data = await getPiDashboard(bounds.start, bounds.end, controller.signal);
        if (!active) return;
        setAttendance(data.attendance); setUnknown(data.unknown); setCameras(data.cameras); setUsers(data.users);
        setCamerasLoaded(true); setPiOnline(true); setError('');
      } catch (failure) {
        if (!active) return;
        setPiOnline(false);
        setError(failure instanceof Error ? failure.message : 'Pi dashboard unavailable');
      } finally {
        window.clearTimeout(timeout);
        if (active) {
          setLoading({ attendance: false, unknown: false, cameras: false, users: false });
          timer = window.setTimeout(poll, 10_000);
        }
      }
    };
    void poll();
    return () => { active = false; controller?.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [user, roleChecked, isAdmin, demoMode, tab, attendanceRange, date]);

  useEffect(() => {
    if (!user) {
      setApiOnline(null);
      return;
    }
    let active = true;
    const check = async () => {
      const online = await checkApiHealth();
      if (active) setApiOnline(online);
    };
    void check();
    const timer = window.setInterval(check, 15_000);
    window.addEventListener('online', check);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', check);
    };
  }, [user]);

  useEffect(() => setError(''), [tab, demoMode]);

  useEffect(() => {
    if (!user) return setUsername('');
    getDoc(doc(db, 'accounts', user.uid)).then(account => setUsername(account.exists() ? String(account.data().username) : user.displayName || user.email?.split('@')[0] || copy.common.user)).catch(() => setUsername(user.displayName || user.email?.split('@')[0] || copy.common.user));
  }, [user, copy.common.user]);

  useEffect(() => localStorage.setItem('smartattend-clock-24', String(use24Hour)), [use24Hour]);
  useEffect(() => localStorage.setItem('smartattend-clock-seconds', String(showSeconds)), [showSeconds]);
  useEffect(() => localStorage.setItem('smartattend-demo', String(demoMode)), [demoMode]);
  useEffect(() => localStorage.setItem('smartattend-tab', tab), [tab]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem('smartattend-theme', resolvedTheme);
    localStorage.setItem('smartattend-theme-setting', themeSetting);
  }, [resolvedTheme, themeSetting]);
  useEffect(() => {
    localStorage.setItem('smartattend-layout-mode', layoutMode);
  }, [layoutMode]);
  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem('smartattend-language', language);
  }, [language]);
  useEffect(() => {
    document.title = `SmartAttend · ${user ? tabLabel(copy, tab) : copy.auth.signIn}`;
  }, [user, tab, copy]);
  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setNavigationOpen(false);
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [navigationOpen]);

  function changeLanguage(value: Language) {
    setLanguage(value);
    notify(translations[value].toast.language, 'info');
  }

  function changeThemeSetting(value: ThemeSetting) {
    setThemeSetting(value);
    notify(copy.toast.theme, 'info');
  }

  function changeLayoutMode(value: LayoutMode) {
    setLayoutMode(value);
    notify(value === 'bento' ? copy.bento.switchToBento : copy.bento.revertToClassic, 'info');
  }

  function changeDemoMode(value: boolean) {
    setDemoMode(value);
    notify(value ? copy.toast.demoOn : copy.toast.demoOff, 'info');
  }

  const bounds = attendanceBounds(tab, attendanceRange, date);
  const canReadPi = !piDataMode || (roleChecked && isAdmin);
  const sourceAttendance = demoMode ? mock.attendance.filter(item => item.date >= bounds.start && item.date <= bounds.end) : canReadPi ? attendance : [];
  const sourceUnknown = demoMode ? mock.unknown : canReadPi ? unknown : [];
  const sourceCameras = demoMode
    ? mock.cameras
    : (canReadPi ? cameras : []).map(camera => ({ ...camera, status: cameraHeartbeatOnline(camera, heartbeatNow) ? 'online' as const : 'offline' as const }));
  const overviewAttendance = piDataMode && !demoMode ? sourceAttendance.filter(entry => entry.date === today()) : sourceAttendance;
  const overviewUnknown = piDataMode && !demoMode ? sourceUnknown.filter(entry => entry.timestamp && piIsoDate(entry.timestamp.toDate()) === today()) : sourceUnknown;
  const sourceUsers = demoMode ? mock.users : canReadPi ? users : [];
  const deferredSearch = useDeferredValue(search);
  const filteredAttendance = useMemo(() => sourceAttendance.filter(item => {
    const matchesSearch = `${item.name} ${item.user_id} ${item.camera_id}`.toLowerCase().includes(deferredSearch.toLowerCase());
    const matchesCamera = cameraFilter === 'all' || (item.camera_ids ?? [item.camera_id]).includes(cameraFilter);
    return matchesSearch && matchesCamera;
  }), [sourceAttendance, deferredSearch, cameraFilter]);
  const online = sourceCameras.filter(camera => camera.status === 'online').length;
  const totalCameras = sourceCameras.length > 0 ? sourceCameras.length : piDataMode ? 0 : 3;
  const settings = <SettingsDialog copy={copy} language={language} themeSetting={themeSetting} layoutMode={layoutMode} use24Hour={use24Hour} showSeconds={showSeconds} demoMode={demoMode} user={user} username={username} userPfp={userPfp} onLanguage={changeLanguage} onThemeSetting={changeThemeSetting} onLayoutMode={changeLayoutMode} onUse24Hour={setUse24Hour} onShowSeconds={setShowSeconds} onDemoMode={changeDemoMode} onUpdateAvatar={handleUpdateAvatar} onSignOut={user ? () => signOut(auth) : undefined} onClose={() => setSettingsOpen(false)} />;

  if (!user) return <><Login copy={copy} language={language} themeSetting={themeSetting} layoutMode={layoutMode} use24Hour={use24Hour} showSeconds={showSeconds} demoMode={demoMode} onLanguage={changeLanguage} onThemeSetting={changeThemeSetting} onLayoutMode={changeLayoutMode} onUse24Hour={setUse24Hour} onShowSeconds={setShowSeconds} onDemoMode={changeDemoMode} onRegistrationState={value => { registering.current = value; }} /><ToastViewport toasts={toasts} /></>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/sic-ai-mark.svg" alt="" /><div><strong>SIC Smart Attendance</strong><small>{copy.dashboard.subtitle}</small></div></div>
      <div className="mobile-header-tools">
        <button
          type="button"
          className="mobile-avatar-btn"
          onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}
          title={copy.settings.pfpChange}
          aria-label={copy.common.settings}
        >
          <div className="mobile-avatar-circle">
            {userPfp ? (
              <img src={userPfp} alt="" className="mobile-avatar-img" />
            ) : (
              ((username || user.displayName || user.email || 'U').slice(0, 2)).toUpperCase()
            )}
          </div>
          <span className="mobile-avatar-dot" />
        </button>
        <button className="menu-button" type="button" aria-label={navigationOpen ? copy.dashboard.closeNav : copy.dashboard.openNav} aria-controls="dashboard-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(value => !value)}><span /><span /><span /></button>
      </div>
      <div id="dashboard-navigation" className={navigationOpen ? 'sidebar-drawer open' : 'sidebar-drawer'}>
        <div className="drawer-brand"><img className="drawer-brand-logo" src="/sic-ai-mark.svg" alt="" /><div><strong>SIC Smart Attendance</strong><small>{copy.dashboard.subtitle}</small></div></div>
        <nav>{visibleTabs.map(key => <button key={key} className={tab === key ? 'nav active' : 'nav'} onClick={() => { setTab(key); setNavigationOpen(false); }}>{tabLabel(copy, key)}</button>)}</nav>
        <div className="sidebar-footer">
          <div className="user-profile-widget">
            <div className="profile-widget-top">
              <div
                className="profile-avatar-wrap"
                onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}
                style={{ cursor: 'pointer' }}
                title={copy.settings.pfpChange}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setSettingsOpen(true); setNavigationOpen(false); } }}
              >
                <div className="profile-avatar">
                  {userPfp ? (
                    <img src={userPfp} alt="" className="profile-avatar-img" />
                  ) : (
                    ((username || user.displayName || user.email || 'U').slice(0, 2)).toUpperCase()
                  )}
                </div>
                <span className="profile-status-dot" title="Active" aria-label="Active" />
              </div>
              <div className="profile-details">
                <div className="profile-name-row">
                  <strong className="profile-name" title={username || user.displayName || copy.common.user}>
                    {username || user.displayName || copy.common.user}
                  </strong>
                  <span className={`profile-role-badge ${isAdmin ? 'admin' : 'viewer'}`}>
                    {isAdmin ? copy.common.administrator : copy.common.viewer}
                  </span>
                </div>
                <span className="profile-email" title={user.email || ''}>
                  {user.email}
                </span>
              </div>
            </div>
            <div className="profile-widget-actions">
              <button
                type="button"
                className="profile-action-btn"
                onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}
                title={copy.common.settings}
                aria-label={copy.common.settings}
              >
                <span aria-hidden="true">⚙</span>
                <span>{copy.common.settings}</span>
              </button>
              <button
                type="button"
                className="profile-action-btn signout-btn"
                onClick={() => signOut(auth)}
                title={copy.common.signOut}
                aria-label={copy.common.signOut}
              >
                <span aria-hidden="true">⎋</span>
                <span>{copy.common.signOut}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
    {navigationOpen && <button className="mobile-nav-backdrop" aria-label={copy.dashboard.closeNav} onClick={() => setNavigationOpen(false)} />}
    <section className="content">
      <header><div className="page-title-row"><h1>{tabLabel(copy, tab)}</h1>{demoMode && <span className="demo-chip">{copy.common.demo}</span>}</div><div className="header-tools"><LiveClock use24Hour={use24Hour} showSeconds={showSeconds} copy={copy} /><div className="status camera-status"><i className={online === totalCameras && totalCameras > 0 ? 'dot good' : online > 0 ? 'dot warn' : 'dot warn'} /><span className="camera-status-label">{copy.dashboard.camerasOnline}</span><strong className="camera-count">{online}/{totalCameras}</strong></div></div></header>
      {demoMode && <div className="demo-banner"><span aria-hidden="true">◆</span><span>{copy.dashboard.demoBanner}</span></div>}
      {user.emailVerified === false && (
        <div className="unverified-banner" role="alert">
          <span>Please verify your email address. A verification link was sent to your email.</span>
          <button type="button" className="secondary" disabled={resendingEmail} onClick={handleResendVerification}>
            {resendingEmail ? 'Sending…' : 'Resend Verification Email'}
          </button>
        </div>
      )}
      {error && <div className="notice">{error}<button onClick={() => setError('')} aria-label={copy.common.close}>×</button></div>}
      <div className="tab-stage" key={tab}>
        {tab === 'overview' && (layoutMode === 'bento'
          ? <PersonalizedBentoDashboard user={user} username={username} isAdmin={isAdmin} attendance={overviewAttendance} trendAttendance={piDataMode && !demoMode ? sourceAttendance : undefined} cameras={sourceCameras} unknown={overviewUnknown} users={sourceUsers} copy={copy} language={language} totalCameras={totalCameras} loading={!demoMode && (loading.attendance || loading.cameras || (isAdmin && (loading.unknown || loading.users)))} onNavigateTab={key => setTab(key)} onExportCsv={() => exportAttendanceCsv(overviewAttendance, copy, today(), notify)} onNotify={notify} />
          : <Overview copy={copy} attendance={overviewAttendance} unknown={overviewUnknown} cameras={sourceCameras} users={sourceUsers} isAdmin={isAdmin} totalCameras={totalCameras} loading={!demoMode && (loading.attendance || loading.cameras || (isAdmin && (loading.unknown || loading.users)))} />
        )}
        {tab === 'attendance' && <AttendanceView copy={copy} language={language} date={date} setDate={setDate} range={attendanceRange} setRange={setAttendanceRange} search={search} setSearch={setSearch} cameraFilter={cameraFilter} setCameraFilter={setCameraFilter} cameras={sourceCameras} entries={filteredAttendance} loading={!demoMode && loading.attendance} onNotify={notify} />}
        {isAdmin && tab === 'users' && <Suspense fallback={<Skeleton rows={5} />}><UsersView copy={copy} users={sourceUsers} apiOnline={piDataMode ? piOnline : apiOnline} demoMode={demoMode} loading={!demoMode && loading.users} onRefresh={async () => { await refreshUsers(); notify(copy.users.refreshed, 'info'); }} onChanged={refreshUsers} onError={setError} onNotify={notify} /></Suspense>}
        {isAdmin && tab === 'unknown' && <Suspense fallback={<Skeleton rows={5} />}><UnknownView copy={copy} events={sourceUnknown} piMode={piDataMode && !demoMode} loading={!demoMode && loading.unknown} apiOnline={(piDataMode ? piOnline : apiOnline === true) && !demoMode} demoMode={demoMode} onError={setError} onNotify={notify} /></Suspense>}
        {tab === 'devices' && <DeviceView copy={copy} cameras={sourceCameras} loading={!demoMode && loading.cameras} />}
        {isAdmin && tab === 'recog' && <Suspense fallback={<Skeleton rows={5} />}><PiPanel uid={user.uid} locale={copy.locale} /></Suspense>}
        {isAdmin && tab === 'admin' && <Suspense fallback={<Skeleton rows={5} />}><AdminView copy={copy} currentUid={user.uid} sessions={sessions} apiOnline={apiOnline === true} onError={setError} onNotify={notify} /></Suspense>}
      </div>
      <LegalFooter copy={copy} onOpenPrivacy={() => setPrivacyOpen(true)} />
    </section>

    {/* Mobile Native-Style Bottom Navigation Bar */}
    <nav className="mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
      <button
        type="button"
        className={`bottom-nav-item ${tab === 'overview' ? 'active' : ''}`}
        onClick={() => { setTab('overview'); setNavigationOpen(false); }}
      >
        <div className="bottom-nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </div>
        <span>{tabLabel(copy, 'overview')}</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${tab === 'attendance' ? 'active' : ''}`}
        onClick={() => { setTab('attendance'); setNavigationOpen(false); }}
      >
        <div className="bottom-nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <span>{tabLabel(copy, 'attendance')}</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${tab === 'devices' ? 'active' : ''}`}
        onClick={() => { setTab('devices'); setNavigationOpen(false); }}
      >
        <div className="bottom-nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <span>{tabLabel(copy, 'devices')}</span>
      </button>

      {isAdmin ? (
        <button
          type="button"
          className={`bottom-nav-item ${tab === 'users' ? 'active' : ''}`}
          onClick={() => { setTab('users'); setNavigationOpen(false); }}
        >
          <div className="bottom-nav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <span>{tabLabel(copy, 'users')}</span>
        </button>
      ) : (
        <button
          type="button"
          className="bottom-nav-item"
          onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}
        >
          <div className="bottom-nav-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <span>{copy.common.settings}</span>
        </button>
      )}

      <button
        type="button"
        className={`bottom-nav-item ${navigationOpen || (tab === 'unknown' || tab === 'admin' || tab === 'recog') ? 'active' : ''}`}
        onClick={() => setNavigationOpen(value => !value)}
        aria-label={navigationOpen ? copy.dashboard.closeNav : copy.dashboard.openNav}
      >
        <div className="bottom-nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </div>
        <span>{copy.common.menu}</span>
      </button>
    </nav>

    <button className="floating-settings" type="button" aria-label={copy.common.settings} title={copy.common.settings} onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}><span aria-hidden="true">⚙</span></button>
    {settingsOpen && settings}
    {privacyOpen && <PrivacyDialog copy={copy} onClose={() => setPrivacyOpen(false)} />}
    <ToastViewport toasts={toasts} />
  </main>;
}

function Overview({ copy, attendance, unknown, cameras, users, isAdmin, loading, totalCameras }: { copy: Copy; attendance: Attendance[]; unknown: UnknownEvent[]; cameras: Camera[]; users: ManagedUser[]; isAdmin: boolean; loading: boolean; totalCameras: number }) {
  const publicCards = [
    [copy.overview.recognized, attendance.length, copy.overview.recognizedHint],
    [copy.overview.cameraHealth, `${cameras.filter(camera => camera.status === 'online').length}/${totalCameras}`, copy.overview.cameraHealthHint],
  ];
  const adminCards = [
    [copy.overview.unknown, unknown.length, copy.overview.unknownHint],
    [copy.overview.activeUsers, users.filter(user => user.status === 'active').length, copy.overview.activeUsersHint],
  ];
  const cards = isAdmin ? [publicCards[0], ...adminCards, publicCards[1]] : publicCards;
  return <>
    <div className={isAdmin ? 'card-grid' : 'card-grid viewer-grid'}>{cards.map(([label, value, hint]) => <article className="metric" key={String(label)}><span>{label}</span><strong>{loading ? '...' : value}</strong><small>{hint}</small></article>)}</div>
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>{copy.overview.todayTitle}</h2>
          <p>{copy.overview.todayHint}</p>
        </div>
      </div>
      <AttendanceRows copy={copy} entries={attendance.slice(0, 10)} loading={loading} />
    </section>
  </>;
}

function AttendanceView({ copy, language, date, setDate, range, setRange, search, setSearch, cameraFilter, setCameraFilter, cameras, entries, loading, onNotify }: { copy: Copy; language: Language; date: string; setDate: (value: string) => void; range: AttendanceRange; setRange: (value: AttendanceRange) => void; search: string; setSearch: (value: string) => void; cameraFilter: string; setCameraFilter: (value: string) => void; cameras: Camera[]; entries: Attendance[]; loading: boolean; onNotify: (message: string, type?: Toast['type']) => void }) {
  const pagination = useTablePagination(entries, row => row.id, row => timestampMillis(row.timestamp), `${range}/${date}/${search}/${cameraFilter}`);
  const availableCameraIds = useMemo(() => {
    const ids = new Set<string>(piDataMode ? [] : ['camera-1', 'camera-2', 'camera-3']);
    cameras.forEach(c => ids.add(c.camera_id || c.id));
    entries.forEach(e => (e.camera_ids ?? [e.camera_id]).forEach(id => { if (id) ids.add(id); }));
    return Array.from(ids).sort();
  }, [cameras, entries]);

  function exportCsv() {
    const csv = `${copy.attendance.person},${copy.users.userId},${copy.common.camera},${copy.common.time}\n` + entries.map(row => [row.name, row.user_id, row.camera_id, asDate(row.timestamp, copy)].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `attendance-${date}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    onNotify(copy.attendance.exported);
  }
  const quickFilters: [AttendanceRange, string][] = [['today', copy.attendance.today], ['yesterday', copy.attendance.yesterday], ['week', copy.attendance.week], ['custom', copy.attendance.custom]];
  return <section className="panel attendance-panel">
    <div className="quick-filter" role="group" aria-label={copy.attendance.date}>{quickFilters.map(([key, label]) => <button key={key} className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{label}</button>)}</div>
    <div className="toolbar">
      {range === 'custom' && <DatePicker label={copy.attendance.date} value={date} onChange={value => { setDate(value); setRange('custom'); }} yearStart={new Date().getFullYear() - 5} yearEnd={new Date().getFullYear() + 1} language={language} />}
      <label>{copy.attendance.cameraFilter}<select value={cameraFilter} onChange={event => setCameraFilter(event.target.value)} className="camera-filter-select"><option value="all">{copy.attendance.allCameras}</option>{availableCameraIds.map(id => { const label = id === 'camera-1' ? 'Camera 1' : id === 'camera-2' ? 'Camera 2' : id === 'camera-3' ? 'Camera 3' : id; return <option key={id} value={id}>{label}</option>; })}</select></label>
      <label className="grow">{copy.attendance.search}<div className="search-field"><input placeholder={copy.attendance.searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch('')} aria-label={copy.datePicker.clear}>×</button>}</div></label>
      <span className="record-count">{copy.attendance.showing(entries.length)}</span>
      <button className="secondary" onClick={exportCsv} disabled={!entries.length}>{copy.attendance.export}</button>
    </div>
    <AttendanceRows copy={copy} entries={pagination.rows} loading={loading} />
    {!loading && <TablePagination pagination={pagination} locale={copy.locale} />}
  </section>;
}

function AttendanceRows({ copy, entries, loading }: { copy: Copy; entries: Attendance[]; loading: boolean }) {
  if (loading) return <Skeleton rows={5} />;
  return <div className="table-wrap overview-table"><table><thead><tr><th>{copy.attendance.person}</th><th>{copy.common.camera}</th><th>{copy.common.time}</th><th>{copy.common.status}</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.name}</strong><small>{entry.user_id}</small></td><td>{entry.camera_id}</td><td>{asDate(entry.timestamp, copy)}</td><td><span className="pill success">{copy.attendance.recognized}</span></td></tr>)}{!entries.length && <tr><td colSpan={4} className="empty">{copy.attendance.empty}</td></tr>}</tbody></table></div>;
}

function DeviceView({ copy, cameras, loading }: { copy: Copy; cameras: Camera[]; loading: boolean }) {
  if (loading) return <div className="device-grid"><section className="panel"><Skeleton rows={4} /></section><section className="panel"><Skeleton rows={4} /></section><section className="panel"><Skeleton rows={4} /></section></div>;
  return <div className="device-grid">{cameras.map((camera, index) => {
    const displayName = piDataMode ? camera.name : camera.camera_id === 'camera-1' || camera.id === 'camera-1' || index === 0
      ? 'Camera 1'
      : camera.camera_id === 'camera-2' || camera.id === 'camera-2' || index === 1
      ? 'Camera 2'
      : camera.camera_id === 'camera-3' || camera.id === 'camera-3' || index === 2
      ? 'Camera 3'
      : camera.name || `Camera ${index + 1}`;
    return <section className="panel device" key={camera.id}><div className="device-top"><div className="camera-icon">◉</div><span className={camera.status === 'online' ? 'pill success' : 'pill warning'}>{camera.status === 'online' ? copy.common.online : copy.common.offline}</span></div><h2>{displayName}</h2><p>{camera.id} · {camera.raspberry_pi_id || copy.devices.piMissing}</p><dl>{camera.location && <><dt>{copy.common.location}</dt><dd>{camera.location}</dd></>}<dt>{copy.devices.heartbeat}</dt><dd>{asDate(camera.last_seen, copy)}</dd>{camera.last_error && <><dt>{copy.devices.lastError}</dt><dd className="danger">{camera.last_error}</dd></>}</dl></section>;
  })}{!cameras.length && <section className="panel"><p className="empty">{copy.devices.empty}</p></section>}</div>;
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return <div className="toast-viewport" aria-live="polite" aria-atomic="false">{toasts.map(toast => <div className={`toast ${toast.type}`} key={toast.id}><i aria-hidden="true">{toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}</i><span>{toast.message}</span></div>)}</div>;
}

export default App;
