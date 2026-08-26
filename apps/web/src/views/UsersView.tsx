import { type FormEvent, useRef, useState } from 'react';
import { deactivateUser, enrollUser } from '../api';
import { apiActionError, Skeleton, type Toast } from '../dashboardShared';
import type { Copy } from '../i18n';
import type { ManagedUser } from '../types';

type Props = {
  copy: Copy;
  users: ManagedUser[];
  apiOnline: boolean | null;
  demoMode: boolean;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onChanged: () => Promise<void>;
  onError: (value: string) => void;
  onNotify: (message: string, type?: Toast['type']) => void;
};

export default function UsersView({ copy, users, apiOnline, demoMode, loading, onRefresh, onChanged, onError, onNotify }: Props) {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const serviceReady = apiOnline === true && !demoMode;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (photos.length < 3 || photos.length > 8) return onError(copy.users.sampleCountError);
    setBusy(true);
    try {
      await enrollUser(name, userId, photos);
      setName('');
      setUserId('');
      setPhotos([]);
      if (fileInput.current) fileInput.current.value = '';
      await onChanged();
      onNotify(copy.users.enrolled);
    } catch (failure) {
      onError(apiActionError(failure, copy.users.enrollmentFailed, copy));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm(copy.users.deactivateConfirm)) return;
    try {
      await deactivateUser(id);
      await onChanged();
      onNotify(copy.users.deactivated);
    } catch (failure) {
      onError(apiActionError(failure, copy.users.updateFailed, copy));
    }
  }

  const availabilityMessage = demoMode
    ? copy.users.demoDisabled
    : apiOnline === false
      ? copy.users.apiOffline
      : apiOnline === null
        ? copy.users.checkingProfiles
        : '';
  const photoSize = photos.reduce((total, photo) => total + photo.size, 0) / 1024 / 1024;
  return <div className="split">
    <section className={serviceReady ? 'panel enrollment' : 'panel enrollment service-disabled'}>
      <h2>{copy.users.register}</h2>
      <p>{copy.users.registerHint}</p>
      {availabilityMessage && <p className="service-note" role="status">{availabilityMessage}</p>}
      <form onSubmit={submit}>
        <label>{copy.users.fullName}<input value={name} onChange={event => setName(event.target.value)} disabled={!serviceReady || busy} required /></label>
        <label>{copy.users.userId}<input value={userId} onChange={event => setUserId(event.target.value)} disabled={!serviceReady || busy} required /></label>
        <div className="file-field">
          <span className="form-label">{copy.users.facePhotos}</span>
          <input ref={fileInput} id="face-photo" className="file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => setPhotos(Array.from(event.target.files ?? []).slice(0, 8))} disabled={!serviceReady || busy} required />
          <div className="file-picker-row">
            <label className="file-picker" htmlFor="face-photo" aria-disabled={!serviceReady || busy}><span className="file-icon" aria-hidden="true">＋</span><span className="file-copy"><strong>{photos.length ? copy.users.photosSelected(photos.length) : copy.users.choosePhotos}</strong><small>{photos.length ? copy.users.samplesReady(photos.length, photoSize.toFixed(2)) : copy.users.fileHint}</small></span><span className="file-action">{photos.length ? copy.users.replace : copy.users.browse}</span></label>
            {photos.length > 0 && <button className="file-clear" type="button" aria-label={copy.users.removePhotos} disabled={!serviceReady || busy} onClick={() => { setPhotos([]); if (fileInput.current) fileInput.current.value = ''; }}>×</button>}
          </div>
        </div>
        <button disabled={!serviceReady || busy || photos.length < 3}>{busy ? copy.users.creating : serviceReady ? copy.users.create : copy.users.serviceOffline}</button>
      </form>
    </section>
    <section className="panel">
      <div className="panel-title compact"><div><h2>{copy.users.registered}</h2><p>{copy.attendance.showing(users.length)}</p></div><button className="secondary refresh-button" disabled={!serviceReady || loading} onClick={() => void onRefresh()}>↻ {copy.common.refresh}</button></div>
      {loading ? <Skeleton rows={4} /> : <div className="user-list">{users.map(person => <article key={person.id} className="user-row"><div className="avatar">{person.name.slice(0, 1).toUpperCase()}</div><div><strong>{person.name}</strong><small>{person.student_id || copy.users.noId} · {person.status === 'active' ? copy.common.active : copy.common.inactive} · {copy.users.samples(person.enrollment_samples ?? 1)}</small></div>{person.status === 'active' && <button className="danger text-button" disabled={!serviceReady} title={serviceReady ? copy.users.deactivateTitle : copy.users.offlineTitle} onClick={() => void deactivate(person.id)}>{copy.users.deactivate}</button>}</article>)}{!users.length && <p className="empty">{apiOnline === false ? copy.users.unavailableProfiles : apiOnline === null ? copy.users.checkingProfiles : copy.users.empty}</p>}</div>}
    </section>
  </div>;
}
