import { Link, NavLink } from 'react-router-dom';
import { LEGAL_LINKS, COMPANY } from '../legal/company.js';
import { SupportEmailLink } from '../legal/SupportEmail.jsx';

export function LegalLayout({ title, lead, wide = false, children }) {
  return (
    <div className="site-page">
      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link to="/" className="site-brand" aria-label={COMPANY.productName}>
            <img
              className="brand-logo"
              src="/logo.svg"
              alt=""
              width="36"
              height="36"
            />
            <span className="site-brand-name">{COMPANY.productName}</span>
          </Link>

          <nav className="site-nav" aria-label="Разделы сайта">
            {LEGAL_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => (isActive ? 'site-nav-link is-active' : 'site-nav-link')}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="site-header-actions">
            <Link className="btn site-btn-ghost" to="/login">
              Вход
            </Link>
            <Link className="btn primary" to="/register">
              Регистрация
            </Link>
          </div>
        </div>
      </header>

      <main className={`site-main ${wide ? 'site-main-wide' : ''}`}>
        <div className="site-container site-main-inner">
          {(title || lead) && (
            <header className="site-page-hero site-fade-in">
              {title ? <h1 className="site-page-title">{title}</h1> : null}
              {lead ? <p className="site-page-lead">{lead}</p> : null}
            </header>
          )}
          <div className="site-fade-in site-fade-in-delay">{children}</div>
        </div>
      </main>

      <footer className="site-footer">
        <div className="site-container site-footer-inner">
          <div className="site-footer-brand">
            <img
              className="brand-logo"
              src="/logo.svg"
              alt=""
              width="32"
              height="32"
            />
            <strong>{COMPANY.productName}</strong>
          </div>
          <p className="site-footer-meta">
            {COMPANY.form}: {COMPANY.legalName} · ИНН {COMPANY.inn}
            <br />
            <SupportEmailLink />
            {' · '}
            <a href={`tel:${COMPANY.phone.replace(/[^\d+]/g, '')}`}>{COMPANY.phone}</a>
          </p>
          <nav className="site-footer-nav" aria-label="Подвал">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.to} to={l.to}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
