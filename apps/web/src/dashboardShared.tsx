import type { Copy } from './i18n';

export type Tab = 'overview' | 'attendance' | 'users' | 'unknown' | 'devices' | 'admin';
export type AttendanceRange = 'today' | 'yesterday' | 'week' | 'custom';
export type Toast = { id: number; message: string; type: 'success' | 'info' | 'warning' | 'error' };

export function tabLabel(copy: Copy, tab: Tab) {
  return copy.nav[tab];
}

export function asDate(timestamp: { toDate: () => Date } | undefined, copy: Copy) {
  return timestamp?.toDate()?.toLocaleString(copy.locale) ?? copy.common.waitingTimestamp;
}

export function timestampMillis(timestamp: { toDate: () => Date } | undefined) {
  return timestamp?.toDate()?.getTime() ?? 0;
}

export function apiActionError(error: unknown, fallback: string, copy: Copy) {
  const message = error instanceof Error ? error.message : fallback;
  const photo = message.match(/^Photo\s+(\d+)(?:\s+\(([^)]+)\))?:/i);
  const withPhoto = (translated: string) => photo ? `${copy.users.photoProblem(photo[1], photo[2] ?? '')}: ${translated}` : translated;
  if (/failed to fetch|VITE_API_BASE_URL is not configured/i.test(message)) return copy.users.apiOffline;
  if (/administrator access is required/i.test(message)) return copy.users.adminRequired;
  if (/must be JPEG, PNG, or WebP/i.test(message)) return copy.users.photoFormat;
  if (/at most 8 MB/i.test(message)) return copy.users.photoLarge;
  if (/could not be decoded/i.test(message)) return copy.users.photoDecode;
  if (/no face was detected/i.test(message)) return withPhoto(copy.users.noFace);
  if (/confidence is too low/i.test(message)) return withPhoto(copy.users.lowConfidence);
  if (/requires 3 to 8/i.test(message)) return copy.users.sampleCountError;
  if (/too blurry/i.test(message)) return withPhoto(copy.users.photoBlurry);
  if (/face is too small/i.test(message)) return withPhoto(copy.users.faceSmall);
  if (/too dark/i.test(message)) return withPhoto(copy.users.photoDark);
  if (/overexposed/i.test(message)) return withPhoto(copy.users.photoBright);
  if (/photos are inconsistent/i.test(message)) return copy.users.inconsistentPhotos;
  if (/student ID already exists|with this student ID already exists/i.test(message)) return copy.users.idExists;
  return message;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

export function exportAttendanceCsv(entries: { name: string; user_id: string; camera_id: string; timestamp?: { toDate: () => Date } }[], copy: Copy, date: string, onNotify?: (msg: string) => void) {
  const csv = `${copy.attendance.person},${copy.users.userId},${copy.common.camera},${copy.common.time}\n` + entries.map(row => [row.name, row.user_id, row.camera_id, asDate(row.timestamp, copy)].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `attendance-${date}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  if (onNotify) onNotify(copy.attendance.exported);
}

