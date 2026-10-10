import { TablePagination, useTablePagination } from './TablePagination';
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
  return <article className="pi-camera-card"><div className="pi-camera-heading"><h3>{cameraId}</h3><span className="pill">{enabled ? (vi ? 'Video bật' : 'Video on') : (vi ? 'Video tắt' : 'Video off')}</span></div><video aria-label={`${vi ? 'Video trực tiếp' : 'Live video'}: ${cameraId}`} ref={video} autoPlay playsInline muted style={{ width: '100%', background: '#111', aspectRatio: '4 / 3' }} />{!enabled && <p className="muted">{vi ? 'Bật Video để xem camera trực tiếp.' : 'Turn on Video to view the live camera.'}</p>}{message && <p role="status">{message}</p>}</article>;
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
  const eventPage = useTablePagination(events, event => event.observation_id, event => Date.parse(event.occurred_at));
  const attendancePage = useTablePagination(attendance, row => String(row.attendance_id), row => Date.parse(row.occurred_at));
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
  return <section className="panel pi-panel"><div className="panel-title"><div><h2>{vi ? 'Điểm danh' : 'Check-in'}</h2><p>{vi ? 'Video và nhận diện có thể bật/tắt riêng. Điểm danh đã lưu vẫn còn khi tải lại trang.' : 'Video and recognition are independent. Saved attendance remains available after reloading.'}</p></div><button className="secondary" disabled={busy} onClick={() => void refresh()}>{vi ? 'Làm mới' : 'Refresh'}</button></div>
    {error && <p role="alert">{error}</p>}
    {eventsError && <p role="status">{eventsError}</p>}
    {status && <><div className="pi-status"><span className="pill success">{vi ? 'Pi đã kết nối' : 'Pi connected'}</span><span className="muted">{status.pi_id}</span></div><div className="pi-controls">
      <article className="pi-control-card"><div><h3>{vi ? 'Nhận diện' : 'Recognition'}</h3><p>{vi ? 'Điều khiển nhận diện trên Pi.' : 'Control recognition on the Pi.'}</p></div><button className="secondary" aria-pressed={status.control.recognition_enabled} disabled={busy} onClick={() => void control({ recognition_enabled: !status.control.recognition_enabled })}>{vi ? 'Nhận diện' : 'Recognition'}: {status.control.recognition_enabled ? (vi ? 'BẬT' : 'ON') : (vi ? 'TẮT' : 'OFF')}</button><label>{vi ? 'Camera nhận diện' : 'Recognition camera'}<select className="camera-filter-select" disabled={busy} value={status.control.selected_camera_id ?? ''} onChange={event => void control({ camera_id: event.target.value })}><option value="" disabled>—</option>{status.camera_ids.map(id => <option key={id} value={id}>{id}</option>)}</select></label></article>
      <article className="pi-control-card"><div><h3>{vi ? 'Video trực tiếp' : 'Live video'}</h3><p>{vi ? 'Xem camera độc lập với nhận diện.' : 'View cameras independently of recognition.'}</p></div><button className="secondary" aria-pressed={streaming} disabled={!realtimeDb} onClick={() => setStreaming(value => !value)}>Video: {streaming ? (vi ? 'BẬT' : 'ON') : (vi ? 'TẮT' : 'OFF')}</button>{!realtimeDb && <p role="status">{vi ? 'Chưa cấu hình Firebase Realtime Database cho video.' : 'Firebase Realtime Database for video is not configured.'}</p>}</article></div>
      <div className="pi-camera-grid">{status.camera_ids.map(id => <CameraStream key={`${status.pi_id}/${id}`} uid={uid} piId={status.pi_id} cameraId={id} enabled={streaming} vi={vi} />)}</div>
      <h3>{vi ? 'Nhật ký nhận diện' : 'Recognition observations'}</h3><div className="table-wrap"><table><thead><tr>{(vi ? ['Thời gian', 'Tên / MSSV', 'Camera', 'Trạng thái', 'Điểm', 'Lý do', 'Mô hình'] : ['Time', 'Name / Student ID', 'Camera', 'Status', 'Score', 'Reason', 'Model']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{eventPage.rows.map(event => <tr key={event.observation_id}><td>{new Date(event.occurred_at).toLocaleString(locale)}</td><td>{event.name || 'Unknown'}<small>{event.student_id || '—'}</small></td><td>{event.camera_ids.join(', ')}</td><td>{event.display_status || event.status}</td><td>{event.similarity?.toFixed(3) ?? '—'}</td><td>{event.reason}</td><td><span className="model-version" title={event.model_version}>{event.model_version || '—'}</span></td></tr>)}{!events.length && <tr><td colSpan={7}>{vi ? 'Chưa có nhật ký' : 'No observations yet'}</td></tr>}</tbody></table></div><TablePagination pagination={eventPage} locale={locale} /></>}
    <div className="panel-title pi-section-title"><div><h3>{vi ? 'Điểm danh đã lưu trên Pi' : 'Saved Pi attendance'}</h3><p>{vi ? '100 bản ghi gần nhất. Cột đồng bộ phản ánh trạng thái lưu lên đám mây.' : 'Latest 100 records. Cloud sync reflects each record’s reported synchronization state.'}</p></div><button className="secondary" disabled={!attendance.length} onClick={exportSavedAttendance}>{vi ? 'Xuất CSV' : 'Export CSV'}</button></div>
    {attendanceError && <p role="alert">{attendanceError}</p>}
    <div className="table-wrap"><table><thead><tr>{(vi ? ['Thời gian', 'Tên / MSSV', 'Camera', 'Điểm', 'Đồng bộ đám mây', 'Mã điểm danh'] : ['Time', 'Name / Student ID', 'Camera', 'Score', 'Cloud sync', 'Attendance ID']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{attendancePage.rows.map(row => <tr key={row.attendance_id}><td>{new Date(row.occurred_at).toLocaleString(locale)}</td><td>{row.name}<small>{row.student_id || row.user_id}</small></td><td>{row.camera_ids.join(', ')}</td><td>{row.similarity?.toFixed(3) ?? '—'}</td><td>{row.sync_state}</td><td><span className="model-version" title={String(row.attendance_id)}>{row.attendance_id}</span></td></tr>)}{!attendance.length && <tr><td colSpan={6}>{vi ? 'Chưa có điểm danh đã lưu' : 'No saved attendance yet'}</td></tr>}</tbody></table></div>
    <TablePagination pagination={attendancePage} locale={locale} />
  </section>;
}
