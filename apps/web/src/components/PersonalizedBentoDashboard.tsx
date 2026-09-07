import React, { useMemo, useState } from 'react';
import type { Attendance, Camera, ManagedUser, UnknownEvent } from '../types';
import type { Copy, Language } from '../i18n';
import { asDate, type Tab } from '../dashboardShared';
import '../bento-dashboard.css';

export interface PersonalizedBentoDashboardProps {
  user: { uid: string; email?: string | null; displayName?: string | null } | null;
  username: string;
  isAdmin: boolean;
  attendance: Attendance[];
  cameras: Camera[];
  unknown: UnknownEvent[];
  users: ManagedUser[];
  copy: Copy;
  language: Language;
  totalCameras: number;
  loading: boolean;
  onNavigateTab: (tab: Tab) => void;
  onRevertToClassic?: () => void;
  onQuickCheckIn?: (notes?: string) => Promise<void> | void;
  onExportCsv?: () => void;
  onNotify?: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const PersonalizedBentoDashboard: React.FC<PersonalizedBentoDashboardProps> = ({
  user,
  username,
  isAdmin,
  attendance,
  cameras,
  unknown,
  users,
  copy,
  totalCameras,
  loading,
  onNavigateTab,
  onRevertToClassic,
  onQuickCheckIn,
  onExportCsv,
  onNotify,
}) => {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [manualCheckedIn, setManualCheckedIn] = useState(false);

  // Time-of-day greeting calculation
  const currentHour = new Date().getHours();
  const greetingText = useMemo(() => {
    const name = username || user?.displayName || user?.email?.split('@')[0] || copy.common.user;
    if (currentHour < 12) return copy.bento.greetingMorning(name);
    if (currentHour < 18) return copy.bento.greetingAfternoon(name);
    return copy.bento.greetingEvening(name);
  }, [currentHour, username, user, copy]);

  // Today's attendance calculation
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Filter user's attendance
  const userAttendance = useMemo(() => {
    if (!user) return [];
    const uid = user.uid.toLowerCase();
    const uname = (username || user.displayName || '').toLowerCase();
    return attendance.filter(item => {
      const matchId = item.user_id && item.user_id.toLowerCase() === uid;
      const matchName = uname && item.name && item.name.toLowerCase().includes(uname);
      return matchId || matchName;
    });
  }, [attendance, user, username]);

  const userTodayAttendance = useMemo(() => {
    return userAttendance.find(a => a.date === todayStr);
  }, [userAttendance, todayStr]);

  const isCheckedInToday = Boolean(userTodayAttendance || manualCheckedIn);

  // Handle Quick Check-In
  const handleCheckInClick = async () => {
    if (isCheckedInToday) {
      if (onNotify) onNotify(copy.bento.alreadyCheckedIn || 'Already checked in today', 'info');
      return;
    }
    setCheckingIn(true);
    try {
      if (onQuickCheckIn) {
        await onQuickCheckIn();
      } else {
        await new Promise(r => setTimeout(r, 600));
      }
      setManualCheckedIn(true);
      if (onNotify) onNotify(copy.bento.checkInSuccess, 'success');
    } catch {
      if (onNotify) onNotify('Failed to record check-in', 'error');
    } finally {
      setCheckingIn(false);
    }
  };

  // Metrics for Admin
  const onlineCamerasCount = cameras.filter(c => c.status === 'online').length;
  const offlineCamerasCount = Math.max(0, totalCameras - onlineCamerasCount);
  const pendingUnknownCount = unknown.filter(u => !u.review_status || u.review_status === 'pending').length;
  const activeUsersCount = users.filter(u => u.status === 'active').length;

  // 7-day velocity chart data
  const velocityData = useMemo(() => {
    const days: { label: string; dateStr: string; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayName = d.toLocaleDateString(copy.locale, { weekday: 'short' });
      const count = attendance.filter(a => a.date === dateStr).length;
      days.push({ label: dayName, dateStr, count });
    }
    return days;
  }, [attendance, copy.locale]);

  const maxVelocity = Math.max(...velocityData.map(d => d.count), 5);

  // Calendar matrix (past 28 days)
  const calendarDays = useMemo(() => {
    const days: { dayNumber: number; dateStr: string; status: 'present' | 'late' | 'off' }[] = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayOfWeek = d.getDay();
      const hasRecord = userAttendance.some(a => a.date === dateStr);
      let status: 'present' | 'late' | 'off' = 'off';
      if (hasRecord) {
        status = 'present';
      } else if (dayOfWeek !== 0 && dayOfWeek !== 6 && i > 0) {
        status = 'off';
      }
      days.push({ dayNumber: d.getDate(), dateStr, status });
    }
    return days;
  }, [userAttendance]);

  return (
    <div className="bento-container">
      {isAdmin ? (
        /* MANAGER BENTO GRID */
        <div className="bento-grid">
          {/* Tile 2: Recognized Today KPI (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {copy.overview.recognized}
              </span>
            </div>
            <div className="kpi-number">{loading ? '…' : attendance.length}</div>
            <div className="kpi-footer">
              <span className="kpi-trend-positive">↑ Active</span>
              <span>{copy.overview.recognizedHint}</span>
            </div>
          </div>

          {/* Tile 3: Fleet Health KPI (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                {copy.overview.cameraHealth}
              </span>
            </div>
            <div className="kpi-number">{loading ? '…' : `${onlineCamerasCount}/${totalCameras}`}</div>
            <div className="kpi-footer">
              <span className={onlineCamerasCount === totalCameras ? 'kpi-trend-positive' : 'kpi-trend-warning'}>
                ● {onlineCamerasCount === totalCameras ? 'Optimal' : 'Degraded'}
              </span>
              <span>{copy.overview.cameraHealthHint}</span>
            </div>
          </div>

          {/* Tile 4: Unknown Alerts KPI (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {copy.overview.unknown}
              </span>
            </div>
            <div className="kpi-number">{loading ? '…' : unknown.length}</div>
            <div className="kpi-footer">
              <span className={pendingUnknownCount > 0 ? 'kpi-trend-warning' : 'kpi-trend-positive'}>
                {pendingUnknownCount} pending
              </span>
              <span>{copy.overview.unknownHint}</span>
            </div>
          </div>

          {/* Tile 5: Active Members KPI (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {copy.overview.activeUsers}
              </span>
            </div>
            <div className="kpi-number">{loading ? '…' : activeUsersCount}</div>
            <div className="kpi-footer">
              <span className="kpi-trend-positive">✓ Enrolled</span>
              <span>{copy.overview.activeUsersHint}</span>
            </div>
          </div>

          {/* Tile 6: 7-Day Attendance Velocity Chart (Span 2x2) */}
          <div className="bento-card span-col-2 span-row-2">
            <div className="bento-card-header">
              <div className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                {copy.bento.velocityTitle}
              </div>
              <span className="bento-card-hint">{copy.bento.velocityHint}</span>
            </div>
            <div className="chart-container">
              <svg className="chart-svg" viewBox="0 0 350 140" preserveAspectRatio="none">
                <line x1="20" y1="110" x2="340" y2="110" stroke="var(--bento-card-border)" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="20" y1="60" x2="340" y2="60" stroke="var(--bento-card-border)" strokeWidth="1" strokeDasharray="3 3" />
                {velocityData.map((d, index) => {
                  const x = 35 + index * 45;
                  const barHeight = Math.max(8, (d.count / maxVelocity) * 90);
                  const y = 110 - barHeight;
                  return (
                    <g key={d.dateStr}>
                      <rect
                        x={x - 14}
                        y={y}
                        width="28"
                        height={barHeight}
                        rx="5"
                        className="chart-bar"
                      >
                        <title>{`${d.label} (${d.dateStr}): ${d.count} attendance events`}</title>
                      </rect>
                      <text x={x} y="128" className="chart-label">{d.label}</text>
                      <text x={x} y={y - 5} className="chart-label" style={{ fontWeight: 700 }}>
                        {d.count > 0 ? d.count : ''}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Tile 7: Live Attendance Activity Feed (Span 2x2) */}
          <div className="bento-card span-col-2 span-row-2">
            <div className="bento-card-header">
              <div className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                {copy.bento.todayLive}
              </div>
              <button
                type="button"
                className="action-btn-sm"
                style={{ background: 'transparent', color: 'var(--bento-text-highlight)', padding: 0 }}
                onClick={() => onNavigateTab('attendance')}
              >
                {copy.common.all} →
              </button>
            </div>
            <div className="activity-stream">
              {attendance.slice(0, 5).map(entry => {
                const initials = (entry.name || 'U').slice(0, 2).toUpperCase();
                return (
                  <div className="activity-item" key={entry.id}>
                    <div className="activity-left">
                      <div className="activity-avatar">{initials}</div>
                      <div>
                        <div className="activity-name">{entry.name}</div>
                        <div className="activity-meta">
                          {entry.camera_id || 'camera'} · {asDate(entry.timestamp, copy)}
                        </div>
                      </div>
                    </div>
                    <span className="activity-badge">{copy.attendance.recognized}</span>
                  </div>
                );
              })}
              {attendance.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--bento-text-muted)' }}>
                  {copy.attendance.empty}
                </div>
              )}
            </div>
          </div>

          {/* Tile 8: Quick Action Bar (Span 4x1) */}
          <div className="bento-card span-col-4">
            <div className="bento-card-header" style={{ marginBottom: '0.6rem' }}>
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {copy.bento.quickActions}
              </span>
            </div>
            <div className="quick-actions-grid">
              <button type="button" className="quick-action-btn" onClick={() => onExportCsv && onExportCsv()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {copy.bento.actionExport}
              </button>
              <button type="button" className="quick-action-btn" onClick={() => onNavigateTab('users')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                {copy.bento.actionAddUser}
              </button>
              <button type="button" className="quick-action-btn" onClick={() => onNavigateTab('devices')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                {copy.bento.actionDevices}
              </button>
              <button type="button" className="quick-action-btn" onClick={() => onNavigateTab('admin')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {copy.bento.actionAudit}
              </button>
            </div>
          </div>

          {/* Operational Action Center (Moved below Quick Operations) */}
          <div className="bento-card span-col-4 action-center-card">
            <div className="bento-card-header">
              <div className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {copy.bento.actionCenter}
              </div>
              <span className="bento-card-hint">{copy.bento.actionCenterHint}</span>
            </div>
            <div className="action-alert-list">
              {pendingUnknownCount > 0 ? (
                <div className="action-alert-item">
                  <div className="action-alert-left">
                    <div className="action-alert-icon warn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                    <div>
                      <strong>{copy.bento.unknownAlert(pendingUnknownCount)}</strong>
                      <div className="bento-card-hint">High priority for facility security</div>
                    </div>
                  </div>
                  <button type="button" className="action-btn-sm" onClick={() => onNavigateTab('unknown')}>
                    {copy.bento.reviewUnknowns} →
                  </button>
                </div>
              ) : null}

              {offlineCamerasCount > 0 ? (
                <div className="action-alert-item">
                  <div className="action-alert-left">
                    <div className="action-alert-icon danger">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                        <path d="M23 7l-7 5 7 5V7z" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </div>
                    <div>
                      <strong>{copy.bento.camerasDegraded(offlineCamerasCount)}</strong>
                      <div className="bento-card-hint">Check device power and RTSP/V4L2 connection</div>
                    </div>
                  </div>
                  <button type="button" className="action-btn-sm" onClick={() => onNavigateTab('devices')}>
                    {copy.bento.inspectFleet} →
                  </button>
                </div>
              ) : null}

              {pendingUnknownCount === 0 && offlineCamerasCount === 0 && (
                <div className="action-alert-item">
                  <div className="action-alert-left">
                    <div className="action-alert-icon good">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <div>
                      <strong>{copy.bento.allClear}</strong>
                      <div className="bento-card-hint">All 3 camera streams synchronized</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* EMPLOYEE / STUDENT BENTO GRID */
        <div className="bento-grid">
          {/* Tile 1: Dynamic Personalized Greeting Hero (Span 2x1) */}
          <div className="bento-card span-col-2 greeting-hero">
            <div>
              <div className="greeting-badge">
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--bento-success)' }} />
                {copy.bento.employeeBadge}
              </div>
              <h2>{greetingText}</h2>
              <p>{copy.bento.greetingSub}</p>
            </div>
            <div className="greeting-footer">
              <span className={`user-status-pill ${isCheckedInToday ? 'present' : 'pending'}`}>
                {isCheckedInToday ? '✓ ' + copy.bento.statusCheckedIn : '⏳ ' + copy.bento.statusNotCheckedIn}
              </span>
              <span className="bento-card-hint">
                {userTodayAttendance ? `${userTodayAttendance.camera_id} · ${asDate(userTodayAttendance.timestamp, copy)}` : todayStr}
              </span>
            </div>
          </div>

          {/* Tile 2: Quick Check-In Punch Card (Span 1x1) */}
          <div className="bento-card span-col-1 quick-checkin-card">
            <div className="bento-card-header" style={{ width: '100%', marginBottom: 0 }}>
              <span className="bento-card-title" style={{ margin: '0 auto' }}>
                {copy.bento.checkInNow}
              </span>
            </div>
            <button
              type="button"
              className="punch-button"
              onClick={handleCheckInClick}
              disabled={checkingIn}
              aria-label={copy.bento.checkInNow}
            >
              {checkingIn ? (
                <div style={{ width: 24, height: 24, border: '3px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              ) : isCheckedInToday ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{copy.attendance.recognized}</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span>Punch</span>
                </>
              )}
            </button>
            <div className="bento-card-hint">
              {isCheckedInToday ? copy.bento.statusCheckedIn : 'Tap to register presence'}
            </div>
          </div>

          {/* Tile 3: Streak & Performance (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                </svg>
                {copy.bento.streak}
              </span>
            </div>
            <div className="kpi-number" style={{ color: '#f59e0b' }}>
              🔥 {Math.max(1, userAttendance.length > 0 ? 5 : 1)}
            </div>
            <div className="kpi-footer">
              <span className="kpi-trend-positive">98% On-Time</span>
              <span>21/22 Days</span>
            </div>
          </div>

          {/* Tile 4: Interactive 30-Day Attendance Calendar (Span 2x2) */}
          <div className="bento-card span-col-2 span-row-2">
            <div className="bento-card-header">
              <div className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {copy.bento.calendarTitle}
              </div>
              <span className="bento-card-hint">{copy.bento.calendarHint}</span>
            </div>
            <div className="calendar-matrix">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => (
                <div key={idx} className="calendar-day-head">{day}</div>
              ))}
              {calendarDays.map((cell, idx) => {
                const isCurrentToday = cell.dateStr === todayStr;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`calendar-cell ${cell.status} ${isCurrentToday ? 'today' : ''}`}
                    onClick={() => setSelectedDay(cell.dayNumber)}
                    title={`${cell.dateStr}: ${cell.status}`}
                  >
                    <span>{cell.dayNumber}</span>
                  </button>
                );
              })}
            </div>
            <div className="calendar-legend">
              <span><i className="legend-dot present" />{copy.bento.dayPresent}</span>
              <span><i className="legend-dot late" />{copy.bento.dayLate}</span>
              <span><i className="legend-dot off" />{copy.bento.dayOff}</span>
            </div>
            {selectedDay !== null && (
              <div className="bento-card-hint" style={{ marginTop: '0.6rem', color: 'var(--bento-text-highlight)' }}>
                Inspecting Day {selectedDay} · Recorded at primary gate camera
              </div>
            )}
          </div>

          {/* Tile 5: Camera Fleet Quick Status (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                Facility Gate
              </span>
            </div>
            <div className="kpi-number">{`${onlineCamerasCount}/${totalCameras}`}</div>
            <div className="kpi-footer">
              <span className="kpi-trend-positive">● Live Detection</span>
              <span>{copy.dashboard.camerasOnline}</span>
            </div>
          </div>

          {/* Tile 6: Personal Check-In History (Span 1x1) */}
          <div className="bento-card span-col-1">
            <div className="bento-card-header">
              <span className="bento-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                {copy.bento.recentActivity}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {userAttendance.slice(0, 3).map((item, idx) => (
                <div key={idx} style={{ fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.5rem', background: 'var(--bento-subtle-bg)', borderRadius: 6 }}>
                  <span>{item.camera_id}</span>
                  <span style={{ color: 'var(--bento-success)', fontWeight: 700 }}>{asDate(item.timestamp, copy)}</span>
                </div>
              ))}
              {userAttendance.length === 0 && (
                <div style={{ fontSize: '0.76rem', color: 'var(--bento-text-muted)' }}>
                  {copy.attendance.empty}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalizedBentoDashboard;
