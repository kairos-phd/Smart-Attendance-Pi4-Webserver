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
import { checkApiHealth, getUsers } from './api';
import DatePicker from './DatePicker';
import { asDate, Skeleton, tabLabel, timestampMillis, type AttendanceRange, type Tab, type Toast } from './dashboardShared';
import { auth, db } from './firebase';
import { translations, type Copy, type Language } from './i18n';
import { createMockData, localIsoDate, offsetIsoDate, startOfCurrentWeek } from './mockData';
import './connection-status.css';
import './qol.css';
import type { Attendance, Camera, ManagedUser, UnknownEvent, UserSession } from './types';

type Theme = 'dark' | 'light';
type AuthMode = 'sign-in' | 'sign-up' | 'reset';
type LoadingState = { attendance: boolean; unknown: boolean; cameras: boolean; users: boolean };

const tabs: Tab[] = ['overview', 'attendance', 'users', 'unknown', 'devices', 'admin'];
const CAMERA_HEARTBEAT_TIMEOUT_MS = 35_000;
const today = () => localIsoDate();
const UsersView = lazy(() => import('./views/UsersView'));
const UnknownView = lazy(() => import('./views/UnknownView'));
const AdminView = lazy(() => import('./views/AdminView'));

function cameraHeartbeatOnline(camera: Camera, now: number) {
  const lastSeen = timestampMillis(camera.last_seen);
  return camera.status === 'online' && lastSeen > 0 && now - lastSeen <= CAMERA_HEARTBEAT_TIMEOUT_MS;
}

function attendanceBounds(tab: Tab, range: AttendanceRange, customDate: string) {
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

function LegalFooter({ copy }: { copy: Copy }) {
  return <footer className="legal-footer"><a href="/privacy.html">{copy.legal.privacy}</a></footer>;
}

function SettingsDialog({ copy, language, theme, use24Hour, showSeconds, demoMode, onLanguage, onTheme, onUse24Hour, onShowSeconds, onDemoMode, onSignOut, onClose }: {
  copy: Copy;
  language: Language;
  theme: Theme;
  use24Hour: boolean;
  showSeconds: boolean;
  demoMode: boolean;
  onLanguage: (value: Language) => void;
  onTheme: (value: Theme) => void;
  onUse24Hour: (value: boolean) => void;
  onShowSeconds: (value: boolean) => void;
  onDemoMode: (value: boolean) => void;
  onSignOut?: () => void;
  onClose: () => void;
}) {
  return <div className="settings-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-title">
        <div><p className="eyebrow">{copy.settings.eyebrow}</p><h2 id="settings-title">{copy.settings.title}</h2></div>
        <button className="settings-close" onClick={onClose} aria-label={copy.common.close}>×</button>
      </div>
      <div className="theme-setting">
        <strong>{copy.settings.appearance}</strong><small>{copy.settings.appearanceHint}</small>
        <div className="theme-options" role="group" aria-label={copy.settings.colorTheme}>
          <button className={theme === 'dark' ? 'theme-option active' : 'theme-option'} onClick={() => onTheme('dark')} aria-pressed={theme === 'dark'}><span aria-hidden="true">☾</span>{copy.settings.dark}</button>
          <button className={theme === 'light' ? 'theme-option active' : 'theme-option'} onClick={() => onTheme('light')} aria-pressed={theme === 'light'}><span aria-hidden="true">☀</span>{copy.settings.light}</button>
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

function Login({ copy, language, theme, use24Hour, showSeconds, demoMode, onLanguage, onTheme, onUse24Hour, onShowSeconds, onDemoMode, onRegistrationState }: {
  copy: Copy;
  language: Language;
  theme: Theme;
  use24Hour: boolean;
  showSeconds: boolean;
  demoMode: boolean;
  onLanguage: (value: Language) => void;
  onTheme: (value: Theme) => void;
  onUse24Hour: (value: boolean) => void;
  onShowSeconds: (value: boolean) => void;
  onDemoMode: (value: boolean) => void;
  onRegistrationState: (value: boolean) => void;
}) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  return <main className="login-shell">
    <div className="auth-corner-tools"><LiveClock use24Hour={use24Hour} showSeconds={showSeconds} copy={copy} /><button className="auth-settings-button" onClick={() => setSettingsOpen(true)} aria-label={copy.auth.openSettings}>⚙</button></div>
    <section className={cardClass}>
      <p className="eyebrow">{copy.auth.system}</p>
      {mode !== 'reset' && <div className="auth-tabs" data-mode={mode} role="tablist" aria-label={copy.auth.access}><button type="button" role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'active' : ''} onClick={() => showMode('sign-in')}>{copy.auth.signIn}</button><button type="button" role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'active' : ''} onClick={() => showMode('sign-up')}>{copy.auth.signUp}</button></div>}
      {mode === 'sign-in' && <div className="auth-view"><h1>{copy.auth.welcomeBack}</h1><p className="muted">{copy.auth.signInHint}</p><form onSubmit={submitSignIn}><label>{copy.auth.email}<input value={email} type="email" onChange={event => setEmail(event.target.value)} disabled={signingIn} autoComplete="email" required /></label><label>{copy.auth.password}<input value={password} type="password" onChange={event => setPassword(event.target.value)} disabled={signingIn} autoComplete="current-password" required /></label><button disabled={signingIn}>{signingIn ? <span className="signing-label"><i className="login-spinner" aria-hidden="true" />{copy.auth.signingIn}</span> : copy.auth.signIn}</button><button type="button" className="text-button auth-link" disabled={signingIn} onClick={() => showMode('reset')}>{copy.auth.forgot}</button>{message && <div className={`auth-notice ${messageType}`} role="alert">{message}</div>}</form></div>}
      {mode === 'sign-up' && <div className="auth-view"><h1>{copy.auth.welcome}</h1><p className="muted">{copy.auth.signUpHint}</p><form onSubmit={submitSignUp}><label>{copy.auth.username}<input value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="username" required /></label><DatePicker label={copy.auth.dob} value={dateOfBirth} onChange={setDateOfBirth} max={today()} defaultViewYear={new Date().getFullYear() - 18} yearStart={new Date().getFullYear() - 100} yearEnd={new Date().getFullYear()} showToday={false} language={language} /><label>{copy.auth.email}<input value={email} type="email" onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label><div className="signup-passwords"><label>{copy.auth.password}<input value={password} type="password" minLength={6} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required /></label><label>{copy.auth.confirmPassword}<input value={confirmPassword} type="password" minLength={6} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label></div><button disabled={creating}>{creating ? copy.auth.creating : copy.auth.create}</button><small className="signup-help">{copy.auth.signUpHelp}</small>{message && <div className={`auth-notice ${messageType}`} role="alert">{message}</div>}</form></div>}
      {mode === 'reset' && <div className="auth-view"><h1>{copy.auth.resetTitle}</h1><p className="muted">{copy.auth.resetHint}</p><form onSubmit={submitReset}><label>{copy.auth.email}<input value={email} type="email" onChange={event => setEmail(event.target.value)} autoFocus required /></label><button disabled={resetting}>{resetting ? copy.auth.sendingReset : copy.auth.sendReset}</button><button type="button" className="text-button auth-link" onClick={() => showMode('sign-in')}>{copy.auth.back}</button>{message && <div className={`auth-notice ${messageType}`} role="status">{message}</div>}</form></div>}
    </section>
    <LegalFooter copy={copy} />
    {settingsOpen && <SettingsDialog copy={copy} language={language} theme={theme} use24Hour={use24Hour} showSeconds={showSeconds} demoMode={demoMode} onLanguage={onLanguage} onTheme={onTheme} onUse24Hour={onUse24Hour} onShowSeconds={onShowSeconds} onDemoMode={onDemoMode} onClose={() => setSettingsOpen(false)} />}
  </main>;
}

function App() {
  const registering = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [date, setDate] = useState(today());
  const [attendanceRange, setAttendanceRange] = useState<AttendanceRange>('today');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('smartattend-theme') === 'light' ? 'light' : 'dark');
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('smartattend-language') === 'vi' ? 'vi' : 'en');
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem('smartattend-demo') === 'true');
  const [use24Hour, setUse24Hour] = useState(() => localStorage.getItem('smartattend-clock-24') === 'true');
  const [showSeconds, setShowSeconds] = useState(() => localStorage.getItem('smartattend-clock-seconds') === 'true');
  const copy = translations[language];
  const mock = useMemo(() => createMockData(language), [language]);
  const visibleTabs = useMemo(() => isAdmin ? tabs : tabs.filter(key => key !== 'users' && key !== 'unknown' && key !== 'admin'), [isAdmin]);
  const notify = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, message, type }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 3200);
  }, []);

  useEffect(() => onAuthStateChanged(auth, currentUser => {
    if (registering.current) return;
    setUser(currentUser);
    setIsAdmin(false);
    if (currentUser) {
      void currentUser.getIdTokenResult().then(token => {
        if (auth.currentUser?.uid === currentUser.uid) setIsAdmin(token.claims.admin === true);
      }).catch(() => setIsAdmin(false));
    }
  }), []);

  useEffect(() => {
    if (!isAdmin && (tab === 'users' || tab === 'unknown' || tab === 'admin')) setTab('overview');
  }, [isAdmin, tab]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const reportPresence = () => {
      if (!active) return;
      void setDoc(doc(db, 'sessions', user.uid), {
        uid: user.uid,
        email: user.email ?? '',
        display_name: user.displayName ?? user.email?.split('@')[0] ?? copy.common.user,
        current_tab: tab,
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
  }, [user, tab, copy.common.user]);

  useEffect(() => {
    if (!user || demoMode || (tab !== 'overview' && tab !== 'attendance')) {
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
  }, [user, demoMode, tab, attendanceRange, date, copy]);

  useEffect(() => {
    if (!user || !isAdmin || demoMode || (tab !== 'overview' && tab !== 'unknown')) {
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
    if (!user || demoMode) {
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
  }, [user, demoMode, copy]);

  useEffect(() => {
    if (!user) return;
    setHeartbeatNow(Date.now());
    const timer = window.setInterval(() => setHeartbeatNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [user]);

  const refreshUsers = useCallback(async () => {
    if (!isAdmin || demoMode || apiOnline !== true) return;
    setLoading(current => ({ ...current, users: true }));
    try {
      setUsers(await getUsers());
    } catch {
      setUsers([]);
    } finally {
      setLoading(current => ({ ...current, users: false }));
    }
  }, [isAdmin, demoMode, apiOnline]);

  useEffect(() => {
    if (!user || !isAdmin || demoMode || apiOnline !== true || (tab !== 'overview' && tab !== 'users')) {
      setLoading(current => ({ ...current, users: false }));
      return;
    }
    void refreshUsers();
  }, [user, isAdmin, demoMode, apiOnline, tab, refreshUsers]);

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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('smartattend-theme', theme);
  }, [theme]);
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

  function changeTheme(value: Theme) {
    setTheme(value);
    notify(copy.toast.theme, 'info');
  }

  function changeDemoMode(value: boolean) {
    setDemoMode(value);
    notify(value ? copy.toast.demoOn : copy.toast.demoOff, 'info');
  }

  const bounds = attendanceBounds(tab, attendanceRange, date);
  const sourceAttendance = demoMode ? mock.attendance.filter(item => item.date >= bounds.start && item.date <= bounds.end) : attendance;
  const sourceUnknown = demoMode ? mock.unknown : unknown;
  const sourceCameras = demoMode
    ? mock.cameras
    : cameras.map(camera => ({ ...camera, status: cameraHeartbeatOnline(camera, heartbeatNow) ? 'online' as const : 'offline' as const }));
  const sourceUsers = demoMode ? mock.users : users;
  const deferredSearch = useDeferredValue(search);
  const filteredAttendance = useMemo(() => sourceAttendance.filter(item => `${item.name} ${item.user_id} ${item.camera_id}`.toLowerCase().includes(deferredSearch.toLowerCase())), [sourceAttendance, deferredSearch]);
  const online = sourceCameras.filter(camera => camera.status === 'online').length;
  const settings = <SettingsDialog copy={copy} language={language} theme={theme} use24Hour={use24Hour} showSeconds={showSeconds} demoMode={demoMode} onLanguage={changeLanguage} onTheme={changeTheme} onUse24Hour={setUse24Hour} onShowSeconds={setShowSeconds} onDemoMode={changeDemoMode} onSignOut={user ? () => signOut(auth) : undefined} onClose={() => setSettingsOpen(false)} />;

  if (!user) return <><Login copy={copy} language={language} theme={theme} use24Hour={use24Hour} showSeconds={showSeconds} demoMode={demoMode} onLanguage={changeLanguage} onTheme={changeTheme} onUse24Hour={setUse24Hour} onShowSeconds={setShowSeconds} onDemoMode={changeDemoMode} onRegistrationState={value => { registering.current = value; }} /><ToastViewport toasts={toasts} /></>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/sic-ai-mark.svg" alt="" /><div><strong>SIC Smart Attendance</strong><small>{copy.dashboard.subtitle}</small></div></div>
      <button className="menu-button" type="button" aria-label={navigationOpen ? copy.dashboard.closeNav : copy.dashboard.openNav} aria-controls="dashboard-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(value => !value)}><span /><span /><span /></button>
      <div id="dashboard-navigation" className={navigationOpen ? 'sidebar-drawer open' : 'sidebar-drawer'}>
        <div className="drawer-brand"><img className="drawer-brand-logo" src="/sic-ai-mark.svg" alt="" /><div><strong>SIC Smart Attendance</strong><small>{copy.dashboard.subtitle}</small></div></div>
        <nav>{visibleTabs.map(key => <button key={key} className={tab === key ? 'nav active' : 'nav'} onClick={() => { setTab(key); setNavigationOpen(false); }}>{tabLabel(copy, key)}</button>)}</nav>
        <div className="sidebar-footer"><div className="sidebar-actions"><span className="user-chip" title={user.email || username}><span aria-hidden="true">●</span>{username || copy.common.user}<em className={isAdmin ? 'role-chip admin' : 'role-chip'}>{isAdmin ? copy.common.administrator : copy.common.viewer}</em></span></div><div className="account"><span>{user.email}</span><button className="text-button" onClick={() => signOut(auth)}>{copy.common.signOut}</button></div></div>
      </div>
    </aside>
    {navigationOpen && <button className="mobile-nav-backdrop" aria-label={copy.dashboard.closeNav} onClick={() => setNavigationOpen(false)} />}
    <section className="content">
      <header><div className="page-title-row"><h1>{tabLabel(copy, tab)}</h1>{demoMode && <span className="demo-chip">{copy.common.demo}</span>}</div><div className="header-tools"><LiveClock use24Hour={use24Hour} showSeconds={showSeconds} copy={copy} /><div className="status camera-status"><i className={online === 2 ? 'dot good' : 'dot warn'} /><span className="camera-status-label">{copy.dashboard.camerasOnline}</span><strong className="camera-count">{online}/2</strong></div></div></header>
      {demoMode && <div className="demo-banner"><span aria-hidden="true">◆</span><span>{copy.dashboard.demoBanner}</span></div>}
      {error && <div className="notice">{error}<button onClick={() => setError('')} aria-label={copy.common.close}>×</button></div>}
      <div className="tab-stage" key={tab}>
        {tab === 'overview' && <Overview copy={copy} attendance={sourceAttendance} unknown={sourceUnknown} cameras={sourceCameras} users={sourceUsers} isAdmin={isAdmin} loading={!demoMode && (loading.attendance || loading.cameras || (isAdmin && (loading.unknown || loading.users)))} />}
        {tab === 'attendance' && <AttendanceView copy={copy} language={language} date={date} setDate={setDate} range={attendanceRange} setRange={setAttendanceRange} search={search} setSearch={setSearch} entries={filteredAttendance} loading={!demoMode && loading.attendance} onNotify={notify} />}
        {isAdmin && tab === 'users' && <Suspense fallback={<Skeleton rows={5} />}><UsersView copy={copy} users={sourceUsers} apiOnline={apiOnline} demoMode={demoMode} loading={!demoMode && loading.users} onRefresh={async () => { await refreshUsers(); notify(copy.users.refreshed, 'info'); }} onChanged={refreshUsers} onError={setError} onNotify={notify} /></Suspense>}
        {isAdmin && tab === 'unknown' && <Suspense fallback={<Skeleton rows={5} />}><UnknownView copy={copy} events={sourceUnknown} loading={!demoMode && loading.unknown} apiOnline={apiOnline === true && !demoMode} demoMode={demoMode} onError={setError} onNotify={notify} /></Suspense>}
        {tab === 'devices' && <DeviceView copy={copy} cameras={sourceCameras} loading={!demoMode && loading.cameras} />}
        {isAdmin && tab === 'admin' && <Suspense fallback={<Skeleton rows={5} />}><AdminView copy={copy} currentUid={user.uid} sessions={sessions} apiOnline={apiOnline === true} onError={setError} onNotify={notify} /></Suspense>}
      </div>
      <LegalFooter copy={copy} />
    </section>
    <button className="floating-settings" type="button" aria-label={copy.common.settings} title={copy.common.settings} onClick={() => { setSettingsOpen(true); setNavigationOpen(false); }}><span aria-hidden="true">⚙</span></button>
    {settingsOpen && settings}
    <ToastViewport toasts={toasts} />
  </main>;
}

function Overview({ copy, attendance, unknown, cameras, users, isAdmin, loading }: { copy: Copy; attendance: Attendance[]; unknown: UnknownEvent[]; cameras: Camera[]; users: ManagedUser[]; isAdmin: boolean; loading: boolean }) {
  const publicCards = [
    [copy.overview.recognized, attendance.length, copy.overview.recognizedHint],
    [copy.overview.cameraHealth, `${cameras.filter(camera => camera.status === 'online').length}/2`, copy.overview.cameraHealthHint],
  ];
  const adminCards = [
    [copy.overview.unknown, unknown.length, copy.overview.unknownHint],
    [copy.overview.activeUsers, users.filter(user => user.status === 'active').length, copy.overview.activeUsersHint],
  ];
  const cards = isAdmin ? [publicCards[0], ...adminCards, publicCards[1]] : publicCards;
  return <><div className={isAdmin ? 'card-grid' : 'card-grid viewer-grid'}>{cards.map(([label, value, hint]) => <article className="metric" key={String(label)}><span>{label}</span><strong>{loading ? '...' : value}</strong><small>{hint}</small></article>)}</div><section className="panel"><div className="panel-title"><div><h2>{copy.overview.todayTitle}</h2><p>{copy.overview.todayHint}</p></div></div><AttendanceRows copy={copy} entries={attendance.slice(0, 8)} loading={loading} /></section></>;
}

function AttendanceView({ copy, language, date, setDate, range, setRange, search, setSearch, entries, loading, onNotify }: { copy: Copy; language: Language; date: string; setDate: (value: string) => void; range: AttendanceRange; setRange: (value: AttendanceRange) => void; search: string; setSearch: (value: string) => void; entries: Attendance[]; loading: boolean; onNotify: (message: string, type?: Toast['type']) => void }) {
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
      <label className="grow">{copy.attendance.search}<div className="search-field"><input placeholder={copy.attendance.searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" onClick={() => setSearch('')} aria-label={copy.datePicker.clear}>×</button>}</div></label>
      <span className="record-count">{copy.attendance.showing(entries.length)}</span>
      <button className="secondary" onClick={exportCsv} disabled={!entries.length}>{copy.attendance.export}</button>
    </div>
    <AttendanceRows copy={copy} entries={entries} loading={loading} />
  </section>;
}

function AttendanceRows({ copy, entries, loading }: { copy: Copy; entries: Attendance[]; loading: boolean }) {
  if (loading) return <Skeleton rows={5} />;
  return <div className="table-wrap overview-table"><table><thead><tr><th>{copy.attendance.person}</th><th>{copy.common.camera}</th><th>{copy.common.time}</th><th>{copy.common.status}</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><strong>{entry.name}</strong><small>{entry.user_id}</small></td><td>{entry.camera_id}</td><td>{asDate(entry.timestamp, copy)}</td><td><span className="pill success">{copy.attendance.recognized}</span></td></tr>)}{!entries.length && <tr><td colSpan={4} className="empty">{copy.attendance.empty}</td></tr>}</tbody></table></div>;
}

function DeviceView({ copy, cameras, loading }: { copy: Copy; cameras: Camera[]; loading: boolean }) {
  if (loading) return <div className="device-grid"><section className="panel"><Skeleton rows={4} /></section><section className="panel"><Skeleton rows={4} /></section></div>;
  return <div className="device-grid">{cameras.map(camera => <section className="panel device" key={camera.id}><div className="device-top"><div className="camera-icon">◉</div><span className={camera.status === 'online' ? 'pill success' : 'pill warning'}>{camera.status === 'online' ? copy.common.online : copy.common.offline}</span></div><h2>{camera.name}</h2><p>{camera.id} · {camera.raspberry_pi_id || copy.devices.piMissing}</p><dl><dt>{copy.devices.heartbeat}</dt><dd>{asDate(camera.last_seen, copy)}</dd>{camera.last_error && <><dt>{copy.devices.lastError}</dt><dd className="danger">{camera.last_error}</dd></>}</dl></section>)}{!cameras.length && <section className="panel"><p className="empty">{copy.devices.empty}</p></section>}</div>;
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return <div className="toast-viewport" aria-live="polite" aria-atomic="false">{toasts.map(toast => <div className={`toast ${toast.type}`} key={toast.id}><i aria-hidden="true">{toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}</i><span>{toast.message}</span></div>)}</div>;
}

export default App;
