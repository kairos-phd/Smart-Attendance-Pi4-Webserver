import { auth } from './firebase';
import type { AdminAccount, ManagedUser } from './types';
import { loadPiDashboard, type PiDashboard } from './piData';
export const piDataMode = import.meta.env.VITE_DATA_SOURCE === 'pi';

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
const piBase = import.meta.env.VITE_PI_API_BASE_URL?.replace(/\/$/, '') || base;

export async function checkApiHealth(timeoutMs = 3000): Promise<boolean> {
  const origin = piDataMode ? piBase : base;
  if (!origin) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => ({}));
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function request(path: string, init: RequestInit = {}, origin = piDataMode ? piBase : base) {
  if (!origin) throw new Error('API origin is not configured');
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first');
  const send = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(`${origin}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  };
  let response = await send(false);
  // A token can remain cached across a role change. Refresh it once before
  // asking the user to sign in again.
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response;
}

export async function getUsers(): Promise<ManagedUser[]> {
  const rows = await (await request(piDataMode ? '/api/pi/users' : '/api/users')).json();
  return Array.isArray(rows) ? rows : rows.users;
}

export async function enrollUser(name: string, studentId: string, photos: File[]): Promise<ManagedUser> {
  const body = new FormData();
  body.append('name', name);
  body.append('student_id', studentId);
  photos.forEach(photo => body.append('face_images', photo));
  return (await request(piDataMode ? '/api/pi/users' : '/api/users', { method: 'POST', body })).json();
}

export async function deactivateUser(id: string): Promise<void> {
  await request(`${piDataMode ? '/api/pi/users' : '/api/users'}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getUnknownImage(eventId: string): Promise<Blob> {
  return (await request(`/api/unknown-events/${eventId}/image`, { cache: 'no-store' })).blob();
}

export async function reviewUnknownEvent(eventId: string, decision: 'reviewed' | 'dismissed'): Promise<void> {
  await request(`/api/unknown-events/${eventId}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
}

export async function deleteUnknownImage(eventId: string): Promise<void> {
  await request(`/api/unknown-events/${eventId}/image`, { method: 'DELETE' });
}

export async function getAdminAccounts(): Promise<AdminAccount[]> {
  return (await request(piDataMode ? '/api/pi/admin/accounts' : '/api/admin/accounts')).json();
}

export async function updateAdminAccount(id: string, changes: { role?: 'admin' | 'viewer'; disabled?: boolean }): Promise<AdminAccount> {
  return (await request(`${piDataMode ? '/api/pi/admin/accounts' : '/api/admin/accounts'}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })).json();
}

export type PiControl = { recognition_enabled: boolean; selected_camera_id?: string };
export type PiStatus = { pi_id: string; camera_ids: string[]; health: unknown; control: PiControl };
export type PiAttendance = { attendance_id: string | number; session_id?: string; user_id: string; name: string; student_id?: string | null; occurred_at: string; camera_ids: string[]; similarity?: number | null; sync_state: string };
export async function getPiAttendance(): Promise<PiAttendance[]> {
  const result = await (await piRequest('/api/pi/attendance?limit=100')).json();
  return Array.isArray(result) ? result : result.attendance ?? [];
}

export type PiEvent = { observation_id: string; occurred_at: string; name?: string | null; student_id?: string | null; camera_ids: string[]; similarity?: number | null; status: string; display_status: string; reason: string; model_version?: string };
async function piRequest(path: string, init: RequestInit = {}) { return request(path, init, piBase); }

export async function getPiStatus(): Promise<PiStatus> { return (await piRequest('/api/pi/status')).json(); }
export async function updatePiControl(update: { recognition_enabled?: boolean; camera_id?: string }): Promise<PiControl> {
  return (await piRequest('/api/pi/control', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) })).json();
}
export async function getPiEvents(): Promise<PiEvent[]> {
  const result = await (await piRequest('/api/pi/recognition-events?limit=100')).json();
  return Array.isArray(result) ? result : result.events ?? [];
}

export async function createPiSession(cameraId: string, sdp: string): Promise<{ session_id: string }> {
  return (await piRequest('/api/pi/webrtc-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ camera_id: cameraId, offer: { type: 'offer', sdp } }) })).json();
}
export async function deletePiSession(sessionId: string): Promise<void> {
  await piRequest(`/api/pi/webrtc-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function getPiDashboard(start: string, end: string, signal: AbortSignal) {
  return loadPiDashboard(async (attendanceCursor, unknownCursor) => {
    const params = new URLSearchParams({ start_date: start, end_date: end, after_attendance_id: String(attendanceCursor), after_unknown_rowid: String(unknownCursor), limit: '500' });
    return (await piRequest(`/api/pi/dashboard?${params}`, { signal, cache: 'no-store' })).json() as Promise<PiDashboard>;
  });
}
