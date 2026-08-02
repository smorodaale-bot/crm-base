import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ROLE_LABELS } from '../constants.js';

export default function Layout() {
  const { user, logout, isSupervisor, canWrite } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const firstName = user?.name?.split(/\s+/)[0] || 'пользователь';

  return (
    <div className={`app-shell ${menuOpen ? 'nav-open' : ''}`}>
      {menuOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <img className="brand-logo" src="/logo.svg" alt="SkayAvto" width="36" height="36" />
            <div>
              <div className="brand-title">SkayAvto</div>
              <div className="brand-sub">CRM v.01</div>
            </div>
          </div>
          <button
            type="button"
            className="btn sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <nav className="nav" onClick={() => setMenuOpen(false)}>
          <NavLink to="/" end>
            Воронка
          </NavLink>
          <NavLink to="/deals">Сделки</NavLink>
          <NavLink to="/clients">Клиенты</NavLink>
          {isSupervisor && <NavLink to="/qc">Контроль качества</NavLink>}
          <NavLink to="/activity">Журнал</NavLink>
        </nav>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <button
            type="button"
            className="btn menu-btn"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="menu-icon" aria-hidden="true" />
            Меню
          </button>
          <div className="topbar-greeting">
            <h1 className="greeting-title">Привет, {firstName}</h1>
            <p className="greeting-sub muted">SkayAvto CRM · автосалон</p>
          </div>

          <div className="topbar-user">
            <div className="user-card topbar-user-card">
              <div className="user-avatar" aria-hidden="true">
                {(user?.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="user-meta">
                <div className="user-name">{user?.name}</div>
                <div className="user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
              </div>
              {isSupervisor && <div className="badge">Все сделки</div>}
              {!isSupervisor && canWrite && <div className="badge muted">Только свои</div>}
              {!canWrite && <div className="badge muted">Read-only</div>}
            </div>
            <button type="button" className="btn" onClick={logout}>
              Выйти
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
