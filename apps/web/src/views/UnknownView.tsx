import { useEffect, useState } from 'react';
import { deleteUnknownImage, getUnknownImage, reviewUnknownEvent } from '../api';
import { apiActionError, asDate, Skeleton, type Toast } from '../dashboardShared';
import { app } from '../firebase';
import type { Copy } from '../i18n';
import type { UnknownEvent } from '../types';

function toStoragePath(value?: string | null) {
  if (!value?.startsWith('gs://')) return null;
  const firstSlash = value.indexOf('/', 5);
  return firstSlash >= 0 ? value.slice(firstSlash + 1) : null;
}

function UnknownImage({ copy, eventId, source, apiOnline }: { copy: Copy; eventId: string; source?: string | null; apiOnline: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const path = toStoragePath(source);
  const isLocal = source?.startsWith('local://unknown/') === true;
  const isDemo = source?.startsWith('demo://unknown/') === true;
  useEffect(() => {
    setUrl(null);
    if (isLocal) {
      if (!apiOnline) return;
      let active = true;
      let objectUrl: string | null = null;
      getUnknownImage(eventId).then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => active && setUrl(null));
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    if (!path) return;
    let active = true;
    void import('firebase/storage').then(({ getDownloadURL, getStorage, ref }) =>
      getDownloadURL(ref(getStorage(app), path)),
    ).then(value => active && setUrl(value)).catch(() => active && setUrl(null));
    return () => { active = false; };
  }, [apiOnline, eventId, isLocal, path]);
  if (isDemo) return <div className="demo-face-crop" role="img" aria-label={copy.unknown.demoFace}><span aria-hidden="true">?</span><small>{copy.common.demo}</small></div>;
  if (url) return <a href={url} target="_blank" rel="noreferrer" className="unknown-image-link"><img src={url} alt={copy.unknown.faceCrop} /><span>{copy.common.viewImage}</span></a>;
  if (isLocal && !apiOnline) return <span className="muted">{copy.unknown.laptopOnly}</span>;
  return <span className="muted">{copy.common.noImage}</span>;
}

type Props = {
  copy: Copy;
  events: UnknownEvent[];
  loading: boolean;
  apiOnline: boolean;
  demoMode: boolean;
  readOnly?: boolean;
  onError: (message: string) => void;
  onNotify: (message: string, type?: Toast['type']) => void;
};

export default function UnknownView({ copy, events, loading, apiOnline, demoMode, readOnly = false, onError, onNotify }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [demoReviews, setDemoReviews] = useState<Record<string, 'reviewed' | 'dismissed'>>({});
  const [demoDeletedImages, setDemoDeletedImages] = useState<Set<string>>(() => new Set());

  async function review(eventId: string, decision: 'reviewed' | 'dismissed') {
    if (demoMode) {
      setDemoReviews(current => ({ ...current, [eventId]: decision }));
      onNotify(decision === 'reviewed' ? copy.unknown.reviewedToast : copy.unknown.dismissedToast);
      return;
    }
    setBusyId(eventId);
    try {
      await reviewUnknownEvent(eventId, decision);
      onNotify(decision === 'reviewed' ? copy.unknown.reviewedToast : copy.unknown.dismissedToast);
    } catch (failure) {
      onError(apiActionError(failure, copy.unknown.reviewFailed, copy));
    } finally {
      setBusyId(null);
    }
  }

  async function removeImage(eventId: string) {
    if (!confirm(copy.unknown.deleteConfirm)) return;
    if (demoMode) {
      setDemoDeletedImages(current => new Set(current).add(eventId));
      onNotify(copy.unknown.deletedToast);
      return;
    }
    setBusyId(eventId);
    try {
      await deleteUnknownImage(eventId);
      onNotify(copy.unknown.deletedToast);
    } catch (failure) {
      onError(apiActionError(failure, copy.unknown.deleteFailed, copy));
    } finally {
      setBusyId(null);
    }
  }

  const controlsReady = !readOnly && (demoMode || apiOnline);
  return <section className="panel"><div className="panel-title"><div><h2>{copy.unknown.title}</h2><p>{readOnly ? 'Pi observations are read-only. Images and review actions are unavailable.' : copy.unknown.hint}</p></div><span className="record-count">{copy.attendance.showing(events.length)}</span></div>{loading ? <Skeleton rows={5} /> : <div className="table-wrap"><table><thead><tr><th>{copy.common.camera}</th><th>{copy.common.time}</th><th>{copy.common.image}</th><th>{copy.common.status}</th><th>{copy.unknown.actions}</th></tr></thead><tbody>{events.map(event => { const reviewStatus = demoReviews[event.id] ?? event.review_status ?? 'pending'; const imageSource = demoDeletedImages.has(event.id) ? null : event.image_url; return <tr key={event.id}><td>{event.camera_id}</td><td>{asDate(event.timestamp, copy)}</td><td><UnknownImage copy={copy} eventId={event.id} source={imageSource} apiOnline={apiOnline} /></td><td>{readOnly && <small>{event.reason} · {event.model_version || '—'} · {event.confidence.toFixed(3)}</small>}<span className={`pill ${reviewStatus === 'reviewed' ? 'success' : reviewStatus === 'dismissed' ? 'warning' : ''}`}>{readOnly ? 'Observation' : reviewStatus === 'reviewed' ? copy.unknown.reviewed : reviewStatus === 'dismissed' ? copy.unknown.dismissed : copy.unknown.pending}</span></td><td><div className="unknown-actions"><button className="secondary" disabled={!controlsReady || busyId === event.id} onClick={() => void review(event.id, 'reviewed')}>{copy.unknown.keepUnknown}</button><button className="text-button" disabled={!controlsReady || busyId === event.id} onClick={() => void review(event.id, 'dismissed')}>{copy.unknown.dismiss}</button>{imageSource && <button className="danger text-button" disabled={!controlsReady || busyId === event.id} onClick={() => void removeImage(event.id)}>{copy.unknown.deleteImage}</button>}</div></td></tr>; })}{!events.length && <tr><td colSpan={5} className="empty">{copy.unknown.empty}</td></tr>}</tbody></table></div>}</section>;
}
