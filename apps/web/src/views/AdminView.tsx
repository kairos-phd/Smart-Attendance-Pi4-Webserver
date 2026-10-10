import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminAccounts, updateAdminAccount } from '../api';
import { apiActionError, asDate, Skeleton, tabLabel, timestampMillis, type Toast } from '../dashboardShared';
import PiPanel from '../components/PiPanel';
import type { Copy } from '../i18n';
import type { AdminAccount, UserSession } from '../types';

type Props = {
  copy: Copy;
  currentUid: string;
  sessions: UserSession[];
  apiOnline: boolean;
  onError: (message: string) => void;
  onNotify: (message: string, type?: Toast['type']) => void;
};

export default function AdminView({ copy, currentUid, sessions, apiOnline, onError, onNotify }: Props) {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionByUid = useMemo(() => new Map(sessions.map(session => [session.uid, session])), [sessions]);

  const refresh = useCallback(async () => {
    if (!apiOnline) return setAccounts([]);
    setLoading(true);
    try {
      setAccounts(await getAdminAccounts());
    } catch (failure) {
      onError(apiActionError(failure, copy.admin.loadFailed, copy));
    } finally {
      setLoading(false);
    }
  }, [apiOnline, copy, onError]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  function isOnline(session?: UserSession) {
    return Boolean(session?.last_seen && session.visibility === 'active' && now - timestampMillis(session.last_seen) <= 45_000);
  }

  async function changeAccount(account: AdminAccount, changes: { role?: 'admin' | 'viewer'; disabled?: boolean }) {
    const message = changes.disabled === true ? copy.admin.disableConfirm(account.email ?? account.username ?? account.uid)
      : changes.role === 'admin' ? copy.admin.promoteConfirm(account.email ?? account.username ?? account.uid)
        : changes.role === 'viewer' ? copy.admin.demoteConfirm(account.email ?? account.username ?? account.uid) : '';
    if (message && !confirm(message)) return;
    setBusyId(account.uid);
    try {
      const updated = await updateAdminAccount(account.uid, changes);
      setAccounts(current => current.map(item => item.uid === updated.uid ? updated : item));
      onNotify(copy.admin.updated);
    } catch (failure) {
      onError(apiActionError(failure, copy.admin.updateFailed, copy));
    } finally {
      setBusyId(null);
    }
  }

  const onlineCount = accounts.filter(account => isOnline(sessionByUid.get(account.uid))).length;
  const adminCount = accounts.filter(account => account.role === 'admin' && !account.disabled).length;
  return <><PiPanel uid={currentUid} locale={copy.locale} apiOnline={apiOnline} /><div className="card-grid admin-metrics"><article className="metric"><span>{copy.admin.onlineNow}</span><strong>{onlineCount}</strong><small>{copy.admin.onlineHint}</small></article><article className="metric"><span>{copy.admin.totalAccounts}</span><strong>{accounts.length}</strong><small>{copy.admin.totalHint}</small></article><article className="metric"><span>{copy.admin.admins}</span><strong>{adminCount}</strong><small>{copy.admin.adminsHint}</small></article><article className="metric"><span>{copy.admin.disabled}</span><strong>{accounts.filter(account => account.disabled).length}</strong><small>{copy.admin.disabledHint}</small></article></div><section className="panel"><div className="panel-title"><div><h2>{copy.admin.title}</h2><p>{copy.admin.hint}</p></div><button className="secondary" disabled={!apiOnline || loading} onClick={() => void refresh()}>↻ {copy.common.refresh}</button></div>{!apiOnline ? <p className="empty">{copy.admin.apiRequired}</p> : loading ? <Skeleton rows={5} /> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>{copy.admin.account}</th><th>{copy.admin.role}</th><th>{copy.admin.presence}</th><th>{copy.admin.currentPage}</th><th>{copy.admin.lastSeen}</th><th>{copy.admin.actions}</th></tr></thead><tbody>{accounts.map(account => { const session = sessionByUid.get(account.uid); const online = isOnline(session); const self = account.uid === currentUid; return <tr key={account.uid}><td><strong>{account.username || account.display_name || account.email || copy.common.user}</strong><small>{account.email || account.uid}</small><small>{account.email_verified ? copy.admin.verified : copy.admin.unverified}{account.disabled ? ` · ${copy.admin.disabled}` : ''}</small></td><td><span className={`pill ${account.role === 'admin' ? 'success' : ''}`}>{account.role === 'admin' ? copy.common.administrator : copy.common.viewer}</span></td><td><span className={`presence-state ${online ? 'online' : ''}`}><i className={`dot ${online ? 'good' : 'warn'}`} />{online ? copy.common.online : copy.common.offline}</span></td><td>{session ? tabLabel(copy, session.current_tab) : copy.common.notAvailable}</td><td>{session?.last_seen ? asDate(session.last_seen, copy) : account.last_sign_in_at ? new Date(account.last_sign_in_at).toLocaleString(copy.locale) : copy.common.notAvailable}</td><td><div className="admin-actions">{self ? <span className="muted">{copy.admin.currentAccount}</span> : <><button className="secondary" disabled={busyId === account.uid || account.disabled} onClick={() => void changeAccount(account, { role: account.role === 'admin' ? 'viewer' : 'admin' })}>{account.role === 'admin' ? copy.admin.makeViewer : copy.admin.makeAdmin}</button><button className={account.disabled ? 'secondary' : 'danger text-button'} disabled={busyId === account.uid} onClick={() => void changeAccount(account, { disabled: !account.disabled })}>{account.disabled ? copy.admin.enable : copy.admin.disable}</button></>}</div></td></tr>; })}{!accounts.length && <tr><td colSpan={6} className="empty">{copy.admin.empty}</td></tr>}</tbody></table></div>}</section></>;
}
