import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { auth, db, storage } from './src/firebase';
import { colors, styles } from './src/theme';
import type { Attendance, Camera, Unknown } from './src/types';

type Screen = 'Overview' | 'History' | 'Unknown' | 'Devices' | 'Profile';
const screens: Screen[] = ['Overview', 'History', 'Unknown', 'Devices', 'Profile'];
const dateToday = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const displayTime = (value?: { toDate: () => Date }) => value?.toDate().toLocaleString() ?? 'Waiting for timestamp';
const storagePath = (source?: string | null) => source?.startsWith('gs://') ? source.slice(source.indexOf('/', 5) + 1) : null;

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() { setBusy(true); setError(''); try { await signInWithEmailAndPassword(auth, email, password); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in failed'); } finally { setBusy(false); } }
  return <View style={styles.login}><Text style={styles.eyebrow}>SIC · SMART ATTENDANCE</Text><View style={styles.loginCard}><Text style={styles.title}>Sign in</Text><Text style={styles.subtitle}>Use your Firebase account to see live attendance data.</Text>{error && <Text style={styles.error}>{error}</Text>}<TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /><TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry /><Pressable style={styles.primary} onPress={submit} disabled={busy}><Text style={styles.primaryText}>{busy ? 'Signing in…' : 'Sign in'}</Text></Pressable></View></View>;
}

function App() {
  const [user, setUser] = useState<User | null>(null); const [isAdmin, setIsAdmin] = useState(false); const [screen, setScreen] = useState<Screen>('Overview'); const [attendance, setAttendance] = useState<Attendance[]>([]); const [unknown, setUnknown] = useState<Unknown[]>([]); const [cameras, setCameras] = useState<Camera[]>([]); const [date, setDate] = useState(dateToday()); const [error, setError] = useState('');
  useEffect(() => onAuthStateChanged(auth, currentUser => {
    setUser(currentUser);
    setIsAdmin(false);
    if (currentUser) {
      void currentUser.getIdTokenResult().then(token => {
        if (auth.currentUser?.uid === currentUser.uid) setIsAdmin(token.claims.admin === true);
      }).catch(() => setIsAdmin(false));
    }
  }), []);
  useEffect(() => {
    if (!user) return;
    const cleanups = [
      onSnapshot(query(collection(db, 'attendance'), where('date', '==', date), orderBy('timestamp', 'desc'), limit(100)), snapshot => setAttendance(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance))), failure => setError(failure.message)),
      onSnapshot(query(collection(db, 'cameras'), orderBy('name')), snapshot => setCameras(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Camera))), failure => setError(failure.message)),
    ];
    if (isAdmin) {
      cleanups.push(
        onSnapshot(query(collection(db, 'unknown_events'), orderBy('timestamp', 'desc'), limit(50)), snapshot => setUnknown(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unknown))), failure => setError(failure.message))
      );
    } else {
      setUnknown([]);
    }
    return () => cleanups.forEach(cleanup => cleanup());
  }, [user, date, isAdmin]);
  if (!user) return <Login />;
  const content = screen === 'Overview' ? <Overview attendance={attendance} unknown={unknown} cameras={cameras} /> : screen === 'History' ? <History date={date} setDate={setDate} attendance={attendance} /> : screen === 'Unknown' ? <UnknownEvents events={unknown} /> : screen === 'Devices' ? <Devices cameras={cameras} /> : <Profile user={user} />;
  return <View style={styles.root}><ScrollView contentContainerStyle={styles.screen}><Text style={styles.eyebrow}>LIVE · FIREBASE SYNC</Text><Text style={styles.title}>{screen}</Text>{error && <Text style={styles.error}>{error}</Text>}{content}</ScrollView><View style={styles.nav}>{screens.map(item => <Pressable key={item} onPress={() => setScreen(item)}><Text style={[styles.navItem, screen === item && styles.activeNav]}>{item}</Text></Pressable>)}</View></View>;
}

function Overview({ attendance, unknown, cameras }: { attendance: Attendance[]; unknown: Unknown[]; cameras: Camera[] }) { const online = cameras.filter(camera => camera.status === 'online').length; return <><Text style={styles.subtitle}>A compact mobile companion for the same two-camera edge system.</Text><View style={styles.metricGrid}><Metric label="Today" value={String(attendance.length)} /><Metric label="Unknown" value={String(unknown.length)} /><Metric label="Cameras" value={`${online}/2`} /><Metric label="Match rate" value={attendance.length ? `${Math.round(attendance.reduce((sum, item) => sum + (item.confidence ?? 0), 0) / attendance.length * 100)}%` : 'N/A'} /></View><View style={styles.card}><Text style={styles.heading}>Recent attendance</Text>{attendance.slice(0, 5).map(item => <View key={item.id}><View style={styles.row}><Text style={styles.body}>{item.name}</Text><Text style={styles.small}>{item.camera_id}</Text></View><Text style={styles.small}>{displayTime(item.timestamp)}</Text><View style={styles.divider} /></View>)}{!attendance.length && <Text style={styles.small}>No events for today.</Text>}</View></>; }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function History({ date, setDate, attendance }: { date: string; setDate: (value: string) => void; attendance: Attendance[] }) { const [search, setSearch] = useState(''); const visible = useMemo(() => attendance.filter(item => `${item.name} ${item.user_id} ${item.camera_id}`.toLowerCase().includes(search.toLowerCase())), [attendance, search]); return <><TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} /><TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search name, user ID, camera" placeholderTextColor={colors.muted} />{visible.map(item => <View style={styles.card} key={item.id}><View style={styles.row}><Text style={styles.heading}>{item.name}</Text><Text style={[styles.pill, { backgroundColor: '#163e36', color: colors.green }]}>Recognized</Text></View><Text style={styles.small}>{item.user_id} · {item.camera_id}</Text><Text style={styles.small}>{displayTime(item.timestamp)} · {item.confidence?.toFixed(3) ?? 'N/A'}</Text></View>)}{!visible.length && <Text style={styles.small}>No matching attendance events.</Text>}</>; }
function UnknownImage({ source }: { source?: string | null }) { const [url, setUrl] = useState<string | null>(null); const path = storagePath(source); useEffect(() => { if (path) getDownloadURL(ref(storage, path)).then(setUrl).catch(() => setUrl(null)); }, [path]); return url ? <Pressable onPress={() => Linking.openURL(url)}><Text style={styles.link}>Open authorized image</Text></Pressable> : <Text style={styles.small}>No image available</Text>; }
function UnknownEvents({ events }: { events: Unknown[] }) { return <>{events.map(item => <View style={styles.card} key={item.id}><View style={styles.row}><Text style={styles.heading}>Unknown face</Text><Text style={[styles.pill, { backgroundColor: '#49371c', color: colors.amber }]}>Review</Text></View><Text style={styles.small}>{item.camera_id} · {displayTime(item.timestamp)}</Text><Text style={styles.small}>Best known-user score: {item.confidence?.toFixed(3) ?? 'N/A'}</Text><UnknownImage source={item.image_url} /></View>)}{!events.length && <Text style={styles.small}>No unknown events.</Text>}</>; }
function Devices({ cameras }: { cameras: Camera[] }) { return <>{cameras.map(camera => <View style={styles.card} key={camera.id}><View style={styles.row}><Text style={styles.heading}>{camera.name}</Text><Text style={[styles.pill, { backgroundColor: camera.status === 'online' ? '#163e36' : '#49371c', color: camera.status === 'online' ? colors.green : colors.amber }]}>{camera.status}</Text></View><Text style={styles.small}>{camera.id} · {camera.raspberry_pi_id || 'No Pi ID reported'}</Text><Text style={styles.small}>Last heartbeat: {displayTime(camera.last_seen)}</Text>{camera.last_error && <Text style={{ color: colors.red }}>{camera.last_error}</Text>}</View>)}{!cameras.length && <Text style={styles.small}>No camera status has arrived. Check the Pi edge service.</Text>}</>; }
function Profile({ user }: { user: User }) { return <View style={styles.card}><Text style={styles.heading}>User information</Text><Text style={styles.body}>{user.email}</Text><Text style={styles.small}>UID: {user.uid}</Text><Text style={styles.subtitle}>Face enrollment and user management remain dashboard-only, because they require administrator approval and a protected embedding write.</Text><Pressable style={styles.primary} onPress={() => signOut(auth)}><Text style={styles.primaryText}>Sign out</Text></Pressable></View>; }

export default App;
