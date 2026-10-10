type Options = {
  vi: boolean;
  report: (message: string) => void;
  stop: () => void;
  schedule?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function createStreamGuard({ vi, report, stop, schedule = setTimeout, cancel = clearTimeout }: Options) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const clearDeadline = () => { if (deadline !== undefined) { cancel(deadline); deadline = undefined; } };
  const fail = (message: string) => { if (!disposed) { report(message); stop(); } };
  return {
    arm() {
      if (disposed) return;
      clearDeadline();
      deadline = schedule(() => fail(vi ? 'Không kết nối được trong 30 giây; thử lại hoặc kiểm tra Pi/TURN.' : 'Connection did not complete within 30 seconds; retry or check Pi/TURN.'), 30000);
    },
    connected: clearDeadline,
    dispose() { disposed = true; clearDeadline(); },
    session(value: unknown): boolean {
      if (disposed) return false;
      if (!value || typeof value !== 'object') {
        fail(vi ? 'Phiên video đã bị xóa; bật lại Video để kết nối.' : 'Video session was removed; restart Video to reconnect.');
        return false;
      }
      const session = value as { state?: unknown; error?: unknown };
      if (['error', 'revoked', 'closed'].includes(String(session.state)) || (typeof session.error === 'string' && session.error.length > 0)) {
        const capacity = typeof session.error === 'string' && session.error.includes('viewer capacity');
        fail(capacity ? (vi ? 'Pi đã hết chỗ xem video; đóng một phiên khác rồi thử lại.' : 'Pi viewer capacity reached; close another video session and retry.')
          : (vi ? 'Pi đã đóng hoặc từ chối phiên video; kiểm tra quyền và thử lại.' : 'Pi closed or rejected the video session; check access and retry.'));
        return false;
      }
      return true;
    },
  };
}
