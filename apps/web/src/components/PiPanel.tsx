import { useCallback, useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { createStreamGuard } from './piStreamLifecycle';
import { auth, realtimeDb } from '../firebase';
import { createPiSession, deletePiSession, getPiEvents, getPiStatus, getPiAttendance, updatePiControl, type PiAttendance, type PiEvent, type PiStatus } from '../api';

export function piAttendanceCsv(rows: PiAttendance[]): string {
  const columns = ['attendance_id', 'session_id', 'name', 'student_id', 'user_id', 'occurred_at', 'camera_ids', 'similarity', 'sync_state'];
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };
  return columns.join(',') + '\n' + rows.map(row => [row.attendance_id, row.session_id, row.name,
    row.student_id, row.user_id, row.occurred_at, row.camera_ids.join(';'), row.similarity, row.sync_state]
    .map(cell).join(',')).join('\n');
}

function CameraStream({ uid, piId, cameraId, enabled, vi }: { uid: string; piId: string; cameraId: string; enabled: boolean; vi: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!enabled || !realtimeDb) return;
    const database = realtimeDb;
    let sessionId: string | undefined;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    let disposed = false;
    let unsubscribe = () => {};
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let cleanupIce = () => {};
    const stop = () => {
      if (disposed) return;
      disposed = true;
      guard.dispose();
      cleanupIce();
      unsubscribe();
      if (expiry) clearTimeout(expiry);
      peer.getReceivers().forEach(receiver => receiver.track?.stop());
      peer.close();
      if (video.current) video.current.srcObject = null;
      if (sessionId) void deletePiSession(sessionId).catch(() => {});
    };
    const guard = createStreamGuard({ vi, report: setMessage, stop });
    guard.arm();
    peer.ontrack = event => {
      if (disposed || !video.current) return;
      video.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      setMessage('');
    };
    peer.onconnectionstatechange = () => {
      if (disposed) return;
      if (peer.connectionState === 'connected') guard.connected();
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') { setMessage(vi ? 'Không kết nối được; cần TURN nếu mạng chặn WebRTC.' : 'Connection failed; TURN may be needed.'); stop(); }
    };
    const start = async () => {
      setMessage(vi ? 'Đang kết nối…' : 'Connecting…');
      const claims = await auth.currentUser?.getIdTokenResult();
      if (auth.currentUser?.uid !== uid || claims?.claims.admin !== true) throw new Error('Administrator access required');
      peer.addTransceiver('video', { direction: 'recvonly' });
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise<void>((resolve, reject) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', changed); reject(new Error('ICE gathering timed out')); }, 10000);
        cleanupIce = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
        function changed() {
          if (peer.iceGatheringState === 'complete' || peer.signalingState === 'closed') { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); }
        }
        peer.addEventListener('icegatheringstatechange', changed);
      });
      if (disposed) return;
      sessionId = (await createPiSession(cameraId, peer.localDescription!.sdp)).session_id;
      if (disposed) { await deletePiSession(sessionId); return; }
      const session = ref(database, `webrtc/${uid}/${sessionId}`);
      let answering = false;
      unsubscribe = onValue(session, snapshot => {
        const value = snapshot.val();
        if (!guard.session(value)) return;
        const answer = value?.answer;
        if (!disposed && !answering && answer?.type === 'answer' && typeof answer.sdp === 'string' && !peer.currentRemoteDescription) {
          answering = true;
          void peer.setRemoteDescription(answer).catch(() => { setMessage(vi ? 'Không đọc được phản hồi video từ Pi.' : 'Pi video answer could not be applied.'); stop(); });
        }
      }, () => { setMessage(vi ? 'Không đọc được phiên video; kiểm tra quyền Firebase.' : 'Cannot read video session; check Firebase access.'); stop(); });
      if (disposed) { unsubscribe(); return; }
      expiry = setTimeout(() => { setMessage(vi ? 'Phiên hết hạn; tắt/bật Video để kết nối lại.' : 'Session expired; restart Video to reconnect.'); stop(); }, 270000);
    };
    void start().catch(() => { if (!disposed) { setMessage(vi ? 'Không tạo được phiên video; kiểm tra API, quyền và cấu hình Firebase.' : 'Cannot create video session; check API, access and Firebase configuration.'); stop(); } });
    return stop;
  }, [uid, piId, cameraId, enabled, vi]);
  return <article><h3>{cameraId}</h3><video ref={video} autoPlay playsInline muted style={{ width: '100%', background: '#111', aspectRatio: '4 / 3' }} />{message && <p role="status">{message}</p>}</article>;
}

export default function PiPanel({ uid, locale }: { uid: string; locale: string }) {
  const vi = locale.startsWith('vi');
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [error, setError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attendance, setAttendance] = useState<PiAttendance[]>([]);
  const [attendanceError, setAttendanceError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getPiStatus();
      setStatus(nextStatus); setError('');
    } catch (failure) { setError(String(failure)); setStatus(null); setStreaming(false); }
    // Legacy Pi runtimes do not expose observation events. Video uses status
    // independently so this optional feed cannot interrupt a live stream.
    void getPiEvents().then(nextEvents => { setEvents(nextEvents); setEventsError(''); })
      .catch(() => { setEvents([]); setEventsError(vi ? 'Nhật ký nhận diện chưa khả dụng trên Pi này.' : 'Recognition events are unavailable on this Pi.'); });
    void getPiAttendance().then(rows => { setAttendance(rows); setAttendanceError(''); })
      .catch(() => setAttendanceError(vi ? 'Không làm mới được điểm danh đã lưu trên Pi.' : 'Cannot refresh saved Pi attendance.'));
  }, [vi]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function control(update: { recognition_enabled?: boolean; camera_id?: string }) {
    setBusy(true);
    try { const next = await updatePiControl(update); setStatus(current => current ? { ...current, control: next } : current); setError(''); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  function exportSavedAttendance() {
    const url = URL.createObjectURL(new Blob(['\ufeff' + piAttendanceCsv(attendance)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pi-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <section className="panel"><div className="panel-title"><div><h2>{vi ? 'Điểm danh Pi' : 'Pi attendance'}</h2><p>{vi ? 'Video và nhận diện có thể bật/tắt riêng. Điểm danh đã lưu vẫn còn khi tải lại trang.' : 'Video and recognition are independent. Saved attendance remains available after reloading.'}</p></div><button className="secondary" disabled={busy} onClick={() => void refresh()}>{vi ? 'Làm mới' : 'Refresh'}</button></div>
    {error && <p role="alert">{error}</p>}
    {eventsError && <p role="status">{eventsError}</p>}
    {status && <><p>Pi: {status.pi_id}</p><div className="admin-actions"><button disabled={busy} onClick={() => void control({ recognition_enabled: !status.control.recognition_enabled })}>Recog: {status.control.recognition_enabled ? 'ON' : 'OFF'}</button><label>{vi ? 'Camera được chọn ' : 'Selected camera '}<select disabled={busy} value={status.control.selected_camera_id ?? ''} onChange={event => void control({ camera_id: event.target.value })}><option value="" disabled>—</option>{status.camera_ids.map(id => <option key={id} value={id}>{id}</option>)}</select></label><button disabled={!realtimeDb} onClick={() => setStreaming(value => !value)}>Video: {streaming ? 'ON' : 'OFF'}</button></div>
      {!realtimeDb && <p>{vi ? 'Chưa cấu hình Firebase Realtime Database cho video.' : 'Firebase Realtime Database for video is not configured.'}</p>}
      {streaming && <div className="card-grid">{status.camera_ids.map(id => <CameraStream key={`${status.pi_id}/${id}`} uid={uid} piId={status.pi_id} cameraId={id} enabled={streaming} vi={vi} />)}</div>}
      <h3>{vi ? 'Nhật ký nhận diện' : 'Recognition observations'}</h3><div className="table-wrap"><table><thead><tr>{(vi ? ['Thời gian', 'Tên / MSSV', 'Camera', 'Trạng thái', 'Điểm', 'Lý do', 'Mô hình'] : ['Time', 'Name / Student ID', 'Camera', 'Status', 'Score', 'Reason', 'Model']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{events.map(event => <tr key={event.observation_id}><td>{new Date(event.occurred_at).toLocaleString(locale)}</td><td>{event.name || 'Unknown'}<small>{event.student_id || '—'}</small></td><td>{event.camera_ids.join(', ')}</td><td>{event.display_status || event.status}</td><td>{event.similarity?.toFixed(3) ?? '—'}</td><td>{event.reason}</td><td>{event.model_version || '—'}</td></tr>)}{!events.length && <tr><td colSpan={7}>{vi ? 'Chưa có nhật ký' : 'No observations yet'}</td></tr>}</tbody></table></div></>}
    <div className="panel-title"><div><h3>{vi ? 'Điểm danh đã lưu trên Pi' : 'Saved Pi attendance'}</h3><p>{vi ? '100 bản ghi gần nhất. Cột đồng bộ phản ánh trạng thái lưu lên đám mây.' : 'Latest 100 records. Cloud sync reflects each record’s reported synchronization state.'}</p></div><button className="secondary" disabled={!attendance.length} onClick={exportSavedAttendance}>{vi ? 'Xuất CSV' : 'Export CSV'}</button></div>
    {attendanceError && <p role="alert">{attendanceError}</p>}
    <div className="table-wrap"><table><thead><tr>{(vi ? ['Thời gian', 'Tên / MSSV', 'Camera', 'Điểm', 'Đồng bộ đám mây', 'Mã điểm danh'] : ['Time', 'Name / Student ID', 'Camera', 'Score', 'Cloud sync', 'Attendance ID']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{attendance.map(row => <tr key={row.attendance_id}><td>{new Date(row.occurred_at).toLocaleString(locale)}</td><td>{row.name}<small>{row.student_id || row.user_id}</small></td><td>{row.camera_ids.join(', ')}</td><td>{row.similarity?.toFixed(3) ?? '—'}</td><td>{row.sync_state}</td><td>{row.attendance_id}</td></tr>)}{!attendance.length && <tr><td colSpan={6}>{vi ? 'Chưa có điểm danh đã lưu' : 'No saved attendance yet'}</td></tr>}</tbody></table></div>
  </section>;
}
