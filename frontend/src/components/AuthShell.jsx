import { Link } from 'react-router-dom';
import { COMPANY } from '../legal/company.js';

/**
 * Split-panel auth shell (login / register), Nova CRM brand.
 */
export function AuthShell({
  mode = 'login',
  layout = 'split',
  title,
  subtitle,
  children,
}) {
  const isLogin = mode === 'login';

  const form = (
    <div className="auth-form-pane">
      <div className="auth-form-inner">
        {layout === 'narrow' ? (
          <Link to="/" className="auth-narrow-brand">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span className="brand-title">Nova</span>
            <span className="brand-sub">CRM</span>
          </Link>
        ) : null}
        <h1 className="auth-form-title">{title}</h1>
        {subtitle ? <p className="auth-form-subtitle">{subtitle}</p> : null}
        {children}
        <p className="auth-legal-links">
          <Link to="/">На главную</Link>
          <Link to="/pricing">Тарифы</Link>
          <Link to="/offer">Оферта</Link>
          <Link to="/privacy">ПДн</Link>
          <Link to="/contacts">Контакты</Link>
        </p>
      </div>
    </div>
  );

  if (layout === 'narrow') {
    return (
      <div className="auth-page">
        <div className="auth-shell auth-shell-narrow">{form}</div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className={`auth-shell ${isLogin ? 'auth-shell-login' : 'auth-shell-register'}`}>
        <aside className="auth-panel" aria-label="Переключение">
          <div className="auth-panel-inner">
            <Link to="/" className="auth-panel-brand">
              <img src="/wordmark-dark.svg" alt={COMPANY.productName} height="28" />
            </Link>
            <h2 className="auth-panel-title">
              {isLogin ? 'Добро пожаловать!' : 'Рады видеть вас'}
            </h2>
            <p className="auth-panel-text">
              {isLogin
                ? 'Ещё нет организации? Зарегистрируйте салон и начните пробный период.'
                : 'Уже есть аккаунт? Войдите в кабинет менеджера или руководителя.'}
            </p>
            <Link className="btn auth-panel-btn" to={isLogin ? '/register' : '/login'}>
              {isLogin ? 'Регистрация' : 'Войти'}
            </Link>
          </div>
        </aside>
        {form}
      </div>
    </div>
  );
}
