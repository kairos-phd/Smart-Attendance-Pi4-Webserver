import { auth } from './firebase';
import type { AdminAccount, ManagedUser } from './types';

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');

export async function checkApiHealth(timeoutMs = 3000): Promise<boolean> {
  if (!base) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/health`, {
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

async function request(path: string, init: RequestInit = {}) {
  if (!base) throw new Error('VITE_API_BASE_URL is not configured');
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first');
  const send = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(`${base}${path}`, {
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
  return (await request('/api/users')).json();
}

export async function enrollUser(name: string, studentId: string, photos: File[]): Promise<ManagedUser> {
  const body = new FormData();
  body.append('name', name);
  body.append('student_id', studentId);
  photos.forEach(photo => body.append('face_images', photo));
  return (await request('/api/users', { method: 'POST', body })).json();
}

export async function deactivateUser(id: string): Promise<void> {
  await request(`/api/users/${id}`, { method: 'DELETE' });
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
  return (await request('/api/admin/accounts')).json();
}

export async function updateAdminAccount(id: string, changes: { role?: 'admin' | 'viewer'; disabled?: boolean }): Promise<AdminAccount> {
  return (await request(`/api/admin/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })).json();
}

export type PiControl = { recognition_enabled: boolean; selected_camera_id?: string };
export type PiStatus = { pi_id: string; camera_ids: string[]; health: unknown; control: PiControl };
export type PiEvent = { observation_id: string; occurred_at: string; name?: string | null; student_id?: string | null; camera_ids: string[]; similarity?: number | null; status: string; display_status: string; reason: string; model_version?: string };
export async function getPiStatus(): Promise<PiStatus> { return (await request('/api/pi/status')).json(); }
export async function updatePiControl(update: { recognition_enabled?: boolean; camera_id?: string }): Promise<PiControl> {
  return (await request('/api/pi/control', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) })).json();
}
export async function getPiEvents(): Promise<PiEvent[]> {
  const result = await (await request('/api/pi/recognition-events?limit=100')).json();
  return Array.isArray(result) ? result : result.events ?? [];
}

export async function createPiSession(cameraId: string, sdp: string): Promise<{ session_id: string }> {
  return (await request('/api/pi/webrtc-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ camera_id: cameraId, offer: { type: 'offer', sdp } }) })).json();
}
export async function deletePiSession(sessionId: string): Promise<void> {
  await request(`/api/pi/webrtc-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}
