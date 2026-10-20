import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { AuthShell } from '../components/AuthShell.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';
import { COMPANY } from '../legal/company.js';
import { SupportEmailLink } from '../legal/SupportEmail.jsx';

export default function ForgotPasswordPage() {
  useDocumentMeta({
    title: 'Сброс пароля — Nova CRM',
    robots: 'noindex, nofollow',
    canonical: 'https://nova-crm.online/',
  });
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState(true);

  useEffect(() => {
    api('/auth/config')
      .then((data) => setEmailOtp(data.emailOtp !== false))
      .catch(() => setEmailOtp(true));
  }, []);

  const telegramHref = COMPANY.telegram
    ? COMPANY.telegram.startsWith('http')
      ? COMPANY.telegram
      : `https://t.me/${COMPANY.telegram.replace(/^@/, '')}`
    : '';

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/auth/forgot', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
      setHint(data.devLink ? `${data.message} ${data.devLink}` : data.message || '');
    } catch (err) {
      setError(err.message || 'Не удалось отправить письмо');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      layout="narrow"
      title="Сброс пароля"
      subtitle={
        emailOtp
          ? 'Укажите email — пришлём ссылку для создания нового пароля.'
          : 'Восстановление по почте временно недоступно. Напишите в поддержку.'
      }
    >
      {!emailOtp ? (
        <div className="auth-success">
          <strong>Восстановление по почте временно недоступно</strong>
          <p>Напишите в поддержку.</p>
          <p>
            <SupportEmailLink />
          </p>
          {telegramHref ? (
            <p>
              <a href={telegramHref} target="_blank" rel="noreferrer">
                Telegram
              </a>
            </p>
          ) : null}
          <p>
            <Link to="/contacts">Контакты</Link>
          </p>
        </div>
      ) : !sent ? (
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">
            <span className="auth-field-label">Email</span>
            <input className="auth-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ru" autoComplete="email" />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button className="btn primary auth-submit" type="submit" disabled={loading}>
            {loading ? 'Отправка...' : 'Отправить ссылку'}
          </button>
        </form>
      ) : (
        <div className="auth-success">
          <strong>Письмо отправлено</strong>
          <p>Проверьте почту и перейдите по ссылке</p>
          {hint ? <p className="auth-hint">{hint}</p> : null}
        </div>
      )}
      <p className="auth-switch">
        Вспомнили пароль? <Link to="/login">Войти</Link>
      </p>
    </AuthShell>
  );
}
