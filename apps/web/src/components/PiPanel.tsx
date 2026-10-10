import { useCallback, useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { createStreamGuard } from './piStreamLifecycle';
import { auth, realtimeDb } from '../firebase';
import { createPiSession, deletePiSession, getPiEvents, getPiStatus, updatePiControl, type PiEvent, type PiStatus } from '../api';

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

export default function PiPanel({ uid, locale, apiOnline }: { uid: string; locale: string; apiOnline: boolean }) {
  const vi = locale.startsWith('vi');
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!apiOnline) return;
    try {
      const [nextStatus, nextEvents] = await Promise.all([getPiStatus(), getPiEvents()]);
      setStatus(nextStatus); setEvents(nextEvents); setError('');
    } catch (failure) { setError(String(failure)); setStatus(null); setStreaming(false); }
  }, [apiOnline]);
  useEffect(() => {
    if (!apiOnline) { setStatus(null); setStreaming(false); return; }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh, apiOnline]);
  async function control(update: { recognition_enabled?: boolean; camera_id?: string }) {
    setBusy(true);
    try { const next = await updatePiControl(update); setStatus(current => current ? { ...current, control: next } : current); setError(''); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-title"><div><h2>{vi ? 'Camera và Recog trên Pi' : 'Pi cameras and Recog'}</h2><p>{vi ? 'Video và nhận diện có thể bật/tắt riêng. Nhật ký gồm cả kết quả bị từ chối.' : 'Video and recognition are independent. Logs include rejected observations.'}</p></div><button className="secondary" disabled={!apiOnline || busy} onClick={() => void refresh()}>{vi ? 'Làm mới' : 'Refresh'}</button></div>
    {!apiOnline && <p>{vi ? 'API máy chủ đang ngoại tuyến. Cần máy chủ chạy 24/7 để bỏ phụ thuộc PC.' : 'Backend API is offline. A 24/7 server is required to remove the PC dependency.'}</p>}
    {error && <p role="alert">{error}</p>}
    {status && <><p>Pi: {status.pi_id}</p><div className="admin-actions"><button disabled={busy} onClick={() => void control({ recognition_enabled: !status.control.recognition_enabled })}>Recog: {status.control.recognition_enabled ? 'ON' : 'OFF'}</button><label>{vi ? 'Camera được chọn ' : 'Selected camera '}<select disabled={busy} value={status.control.selected_camera_id ?? ''} onChange={event => void control({ camera_id: event.target.value })}><option value="" disabled>—</option>{status.camera_ids.map(id => <option key={id} value={id}>{id}</option>)}</select></label><button disabled={!realtimeDb} onClick={() => setStreaming(value => !value)}>Video: {streaming ? 'ON' : 'OFF'}</button></div>
      {!realtimeDb && <p>{vi ? 'Chưa cấu hình Firebase Realtime Database cho video.' : 'Firebase Realtime Database for video is not configured.'}</p>}
      {streaming && <div className="card-grid">{status.camera_ids.map(id => <CameraStream key={`${status.pi_id}/${id}`} uid={uid} piId={status.pi_id} cameraId={id} enabled={streaming} vi={vi} />)}</div>}
      <div className="table-wrap"><table><thead><tr>{(vi ? ['Thời gian', 'Tên / MSSV', 'Camera', 'Trạng thái', 'Điểm', 'Lý do', 'Mô hình'] : ['Time', 'Name / Student ID', 'Camera', 'Status', 'Score', 'Reason', 'Model']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{events.map(event => <tr key={event.observation_id}><td>{new Date(event.occurred_at).toLocaleString(locale)}</td><td>{event.name || 'Unknown'}<small>{event.student_id || '—'}</small></td><td>{event.camera_ids.join(', ')}</td><td>{event.display_status || event.status}</td><td>{event.similarity?.toFixed(3) ?? '—'}</td><td>{event.reason}</td><td>{event.model_version || '—'}</td></tr>)}{!events.length && <tr><td colSpan={7}>{vi ? 'Chưa có nhật ký' : 'No observations yet'}</td></tr>}</tbody></table></div></>}
  </section>;
}
