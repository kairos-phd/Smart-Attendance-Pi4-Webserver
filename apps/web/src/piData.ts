import type { Attendance, Camera, ManagedUser, UnknownEvent } from './types';

export type PiDashboard = {
  pi_id: string; fetched_at: string;
  health: { status?: string; online?: boolean; camera_status?: { camera_id: string; name?: string; status: string; last_error?: string }[] };
  users: { user_id: string; name: string; student_id?: string; status: string; created_at?: string }[];
  attendance: { attendance_id: number; user_id: string; name: string; occurred_at: string; camera_ids: string[]; similarity?: number | null }[];
  unknown: { observation_id: string; occurred_at: string; camera_id: string; similarity?: number | null; reason: string; model_version?: string; review_status?: 'pending' | 'reviewed' | 'dismissed'; reviewed_at?: string | null; reviewed_by?: string | null }[];
  next_attendance_id: number | null; next_unknown_rowid: number | null;
};
export function piIsoDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function piDateBounds(range: string, customDate: string, now = new Date()) {
  const end = piIsoDate(now);
  const day = new Date(`${end}T12:00:00Z`);
  if (range === 'custom') return { start: customDate, end: customDate };
  if (range === 'yesterday') { day.setUTCDate(day.getUTCDate() - 1); const date = day.toISOString().slice(0, 10); return { start: date, end: date }; }
  if (range === 'overview') { day.setUTCDate(day.getUTCDate() - 6); return { start: day.toISOString().slice(0, 10), end }; }
  if (range === 'week') { day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); return { start: day.toISOString().slice(0, 10), end }; }
  return { start: end, end };
}
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
export function piUsers(rows: PiDashboard['users']): ManagedUser[] {
  return rows.map(row => ({ id: row.user_id, name: row.name, student_id: row.student_id, status: row.status, registration_date: row.created_at }));
}
export function adaptPiDashboard(data: PiDashboard) {
  const prefix = `${data.pi_id}:`;
  const attendance: Attendance[] = data.attendance.map(row => ({
    id: `${prefix}${row.attendance_id}`, attendance_id: String(row.attendance_id), user_id: row.user_id,
    name: row.name, camera_id: row.camera_ids.join(', '), camera_ids: row.camera_ids,
    timestamp: timestamp(row.occurred_at), date: piIsoDate(new Date(row.occurred_at)),
    confidence: row.similarity ?? 0, status: 'recognized', raspberry_pi_id: data.pi_id,
  }));
  const unknown: UnknownEvent[] = data.unknown.map(row => ({ id: `${prefix}${row.observation_id}`, event_id: row.observation_id,
    camera_id: row.camera_id, timestamp: timestamp(row.occurred_at), confidence: row.similarity ?? 0,
    review_status: row.review_status, reviewed_at: row.reviewed_at ? timestamp(row.reviewed_at) : undefined, reviewed_by: row.reviewed_by ?? undefined, recognition_status: 'unknown', reason: row.reason, model_version: row.model_version, raspberry_pi_id: data.pi_id }));
  const cameras: Camera[] = (data.health.camera_status ?? []).map(value => ({
    id: `${prefix}${value.camera_id}`, camera_id: value.camera_id, name: value.name || value.camera_id, raspberry_pi_id: data.pi_id,
    status: value.status === 'online' ? 'online' : 'offline',
    last_seen: timestamp(data.fetched_at), last_error: value.last_error || (value.status === 'online' ? null : value.status),
  }));
  return { attendance, unknown, cameras, users: piUsers(data.users) };
}

/** Read both independently paginated feeds completely; never publish a truncated history. */
export async function loadPiDashboard(fetchPage: (attendanceCursor: number, unknownCursor: number) => Promise<PiDashboard>) {
  let attendanceCursor = 0, unknownCursor = 0;
  const attendance = new Map<string, PiDashboard['attendance'][number]>();
  const unknown = new Map<string, PiDashboard['unknown'][number]>();
  let latest: PiDashboard | undefined;
  for (let page = 0; page < 2000; page++) {
    const result = await fetchPage(attendanceCursor, unknownCursor);
    latest = result;
    result.attendance.forEach(row => attendance.set(`${result.pi_id}:${row.attendance_id}`, row));
    result.unknown.forEach(row => unknown.set(`${result.pi_id}:${row.observation_id}`, row));
    const nextAttendance = result.next_attendance_id ?? -1;
    const nextUnknown = result.next_unknown_rowid ?? -1;
    if (nextAttendance === -1 && nextUnknown === -1) return adaptPiDashboard({ ...latest, attendance: [...attendance.values()].sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)), unknown: [...unknown.values()].sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)) });
    if ((nextAttendance !== -1 && nextAttendance <= attendanceCursor) || (nextUnknown !== -1 && nextUnknown <= unknownCursor)) throw new Error('Pi dashboard pagination did not advance');
    attendanceCursor = nextAttendance; unknownCursor = nextUnknown;
  }
  throw new Error('Pi history is too large to load completely; select a shorter date range');
}

export function piOverviewAttendance(entries: Attendance[], locale: string, now = new Date()) {
  const { start, end } = piDateBounds('overview', '', now);
  const today = entries.filter(entry => entry.date === end);
  const trend: { label: string; dateStr: string; count: number }[] = [];
  const day = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const dateStr = day.toISOString().slice(0, 10);
    trend.push({ label: day.toLocaleDateString(locale, { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' }), dateStr, count: entries.filter(entry => entry.date === dateStr).length });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { today, trend };
}
