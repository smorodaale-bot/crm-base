import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AuthShell } from '../components/AuthShell.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export default function LoginPage() {
  const { user, startLogin, confirmLogin, acceptSession } = useAuth();
  useDocumentMeta({
    title: 'Вход — Nova CRM',
    description: 'Вход в кабинет Nova CRM для менеджеров и руководителей автосалона.',
    robots: 'noindex, nofollow',
    canonical: 'https://nova-crm.online/',
  });
  const [step, setStep] = useState('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState(true);

  useEffect(() => {
    api('/auth/config')
      .then((data) => setEmailOtp(data.emailOtp !== false))
      .catch(() => setEmailOtp(true));
  }, []);

  if (user) return <Navigate to="/inbox" replace />;

  async function onCredentialsSubmit(e) {
    e?.preventDefault?.();
    setError('');
    setHint('');
    setLoading(true);
    try {
      const data = await startLogin(email, password, remember);
      if (emailOtp === false || (data.requiresOtp === false && (data.accessToken || data.token))) {
        if (data.accessToken || data.token) {
          await acceptSession(data);
          return;
        }
        setError('Не удалось войти');
        return;
      }
      setEmailMasked(data.emailMasked || email);
      setHint(data.devCode && data.sent === false ? `Код для разработки: ${data.devCode}` : '');
      setCode(data.devCode ? String(data.devCode) : '');
      setStep('otp');
    } catch (err) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  async function onOtpSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmLogin(email, code);
    } catch (err) {
      setError(err.message || 'Неверный код');
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setCode('');
    setError('');
    setHint('');
  }

  const isOtp = step === 'otp';

  return (
    <AuthShell
      mode="login"
      title={isOtp ? 'Код подтверждения' : 'Вход'}
      subtitle={
        isOtp
          ? `Код отправлен на ${emailMasked || email}`
          : 'Для менеджеров и руководителей автосалона'
      }
    >
      <form className="auth-form" onSubmit={isOtp ? onOtpSubmit : onCredentialsSubmit}>
        {isOtp ? (
          <label className="auth-field">
            <span className="auth-field-label">Код из письма</span>
            <input
              className="auth-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 цифр"
              required
              autoFocus
            />
          </label>
        ) : (
          <>
            <label className="auth-field">
              <span className="auth-field-label">Email</span>
              <input
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="username"
                placeholder="you@company.ru"
              />
            </label>
            <PasswordField value={password} onChange={setPassword} />
            <div className="auth-meta">
              <label className="auth-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Запомнить меня
              </label>
              <Link className="auth-inline-link" to="/forgot">
                Забыли пароль?
              </Link>
            </div>
          </>
        )}

        {hint && !error ? <p className="auth-hint">{hint}</p> : null}
        {error ? <div className="error">{error}</div> : null}

        <button className="btn primary auth-submit" disabled={loading} type="submit">
          {loading ? (isOtp ? 'Проверка...' : 'Отправка...') : isOtp ? 'Подтвердить' : 'Войти'}
        </button>

        {isOtp ? (
          <p className="auth-switch-links">
            <button type="button" className="auth-text-btn" onClick={backToCredentials}>
              Назад
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="auth-text-btn" disabled={loading} onClick={onCredentialsSubmit}>
              Отправить код ещё раз
            </button>
          </p>
        ) : (
          <p className="auth-switch">
            Нет аккаунта? <Link to="/register">Создать салон</Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
