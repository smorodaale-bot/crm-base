import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { AppLoader } from './AppLoader.jsx';
import { formatDate } from '../constants.js';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/notifications?limit=30');
      setItems(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    load().finally(() => setLoading(false));

    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  async function markOne(id) {
    try {
      await api(`/notifications/${id}/read`, { method: 'POST', body: '{}' });
      await load();
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  async function markAll() {
    try {
      await api('/notifications/read-all', { method: 'POST', body: '{}' });
      await load();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="notif-bell" ref={rootRef}>
      <button
        type="button"
        className="notif-bell-btn"
        aria-label={unreadCount ? `Уведомления, непрочитанных ${unreadCount}` : 'Уведомления'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="notif-bell-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
            <path d="M9 17a3 3 0 0 0 6 0" />
          </svg>
        </span>
        {unreadCount > 0 && (
          <span className="notif-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Уведомления">
          <div className="notif-panel-head">
            <strong>Уведомления</strong>
            {unreadCount > 0 && (
              <button type="button" className="btn" onClick={markAll}>
                Прочитать все
              </button>
            )}
          </div>
          <div className="notif-panel-list">
            {loading && !items.length ? (
              <AppLoader />
            ) : !items.length ? (
              <p className="muted notif-empty">Пока нет уведомлений</p>
            ) : (
              items.map((n) => {
                const unread = !n.readAt;
                const inner = (
                  <>
                    <div className="notif-item-title">
                      {unread && <span className="notif-dot" aria-hidden="true" />}
                      {n.title}
                    </div>
                    {n.body ? <div className="notif-item-body">{n.body}</div> : null}
                    <div className="notif-item-meta">{formatDate(n.createdAt)}</div>
                  </>
                );
                if (n.link) {
                  return (
                    <Link
                      key={n.id}
                      to={n.link.startsWith('/') ? n.link : `/${n.link}`}
                      className={`notif-item${unread ? ' is-unread' : ''}`}
                      onClick={() => markOne(n.id)}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif-item notif-item-btn${unread ? ' is-unread' : ''}`}
                    onClick={() => markOne(n.id)}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
