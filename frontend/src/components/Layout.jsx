import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { PLAN_LABELS, roleLabel, SUBSCRIPTION_STATUS_LABELS } from '../constants.js';
import NotificationBell from './NotificationBell.jsx';

export default function Layout() {
  const { user, logout, isSupervisor, canWrite, canQc, canStock, plan, subscriptionStatus } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

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
  const showTrialBanner = subscriptionStatus === 'TRIAL' || subscriptionStatus === 'PAST_DUE';

  function onSearch(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    navigate(`/deals?search=${encodeURIComponent(q)}`);
  }

  const workNav = [
    { to: '/dashboard', label: 'Дашборд', icon: '◆' },
    { to: '/inbox', label: 'Рабочий стол', icon: '▣' },
    { to: '/pipeline', label: 'Воронка', icon: '◫' },
    { to: '/deals', label: 'Сделки', icon: '▦' },
    { to: '/clients', label: 'Клиенты', icon: '◎' },
    { to: '/visits', label: 'Визиты', icon: '◷' },
    canStock ? { to: '/vehicles', label: 'Склад', icon: '▣' } : null,
    { to: '/tasks', label: 'Задачи', icon: '☑' },
    { to: '/reminders', label: 'Напоминания', icon: '◷' },
  ].filter(Boolean);

  const manageNav = [
    isSupervisor ? { to: '/analytics', label: 'Аналитика', icon: '▤' } : null,
    isSupervisor && canQc ? { to: '/qc', label: 'Контроль качества', icon: '★' } : null,
    { to: '/activity', label: 'Журнал', icon: '?' },
    isSupervisor ? { to: '/org', label: 'Организация', icon: '◇', end: false } : null,
    { to: '/profile', label: 'Личный кабинет', icon: '●' },
  ].filter(Boolean);

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
            <img
              className="brand-logo"
              src="/logo.svg"
              alt="Nova CRM"
              width="32"
              height="32"
            />
            <div className="brand-text">
              <span className="brand-title">Nova</span>
              <span className="brand-sub">CRM</span>
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
          <div className="nav-group-label">Работа</div>
          {workNav.map((item) => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={item.end}
              className="nav-item"
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-chevron" aria-hidden="true">
                ›
              </span>
            </NavLink>
          ))}
          <div className="nav-group-label">Управление</div>
          {manageNav.map((item) => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={item.to === '/org' ? false : item.end}
              className="nav-item"
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-chevron" aria-hidden="true">
                ›
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <p>
              Тариф {PLAN_LABELS[plan] || plan || 'Базовый'}
              {subscriptionStatus
                ? ` · ${SUBSCRIPTION_STATUS_LABELS[subscriptionStatus] || subscriptionStatus}`
                : ''}
            </p>
            <Link className="sidebar-promo-btn" to={isSupervisor ? '/org/billing' : '/profile'}>
              {isSupervisor ? 'Подписка Nova' : 'Личный кабинет'}
            </Link>
          </div>

          <Link to="/profile" className="sidebar-user" title="Личный кабинет">
            <div className="user-avatar" aria-hidden="true">
              {(user?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="user-meta">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{roleLabel(user)}</div>
            </div>
            <span className="nav-chevron" aria-hidden="true">
              ⌄
            </span>
          </Link>
        </div>
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
            {location.pathname === '/dashboard' || location.pathname === '/inbox' ? (
              <h1 className="greeting-title">Здравствуйте, {firstName}</h1>
            ) : null}
          </div>

          <form className="topbar-search" onSubmit={onSearch}>
            <img
              src="/figma/icon-search.svg"
              alt=""
              width="20"
              height="20"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <input
              type="search"
              placeholder="Поиск"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Поиск"
            />
          </form>

          <div className="topbar-user">
            <NotificationBell />
            <Link
              to="/profile"
              className="user-card topbar-user-card topbar-user-card-link"
              title="Личный кабинет и настройки"
              aria-label="Открыть личный кабинет"
            >
              <div className="user-avatar" aria-hidden="true">
                {(user?.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="user-meta">
                <div className="user-name">{user?.name}</div>
                <div className="user-role">{roleLabel(user)}</div>
              </div>
              {isSupervisor && <div className="badge">Все сделки</div>}
              {!isSupervisor && canWrite && <div className="badge muted">Только свои</div>}
              {!canWrite && <div className="badge muted">Только чтение</div>}
            </Link>
            <button type="button" className="btn" onClick={logout}>
              Выйти
            </button>
          </div>
        </header>

        {showTrialBanner && location.pathname !== '/org/billing' && (
          <div className={`sub-banner ${subscriptionStatus === 'PAST_DUE' ? 'sub-banner-warn' : ''}`}>
            {subscriptionStatus === 'TRIAL'
              ? 'Пробный период. Выберите тариф и оплатите в разделе «Подписка».'
              : 'Подписка неактивна. Продлите оплату в разделе «Подписка».'}
            {isSupervisor && (
              <Link to="/org/billing" className="sub-banner-link">
                Открыть
              </Link>
            )}
          </div>
        )}

        <main className="content">
          <Outlet />
        </main>

        <footer
          className="muted"
          style={{
            padding: '0.75rem 1.25rem 1.25rem',
            fontSize: '0.8rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <Link to="/pricing">Тарифы</Link>
          <Link to="/offer">Оферта</Link>
          <Link to="/privacy">Политика ПДн</Link>
          <Link to="/contacts">Контакты</Link>
        </footer>
      </div>
    </div>
  );
}
