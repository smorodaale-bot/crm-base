import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { AuthShell } from '../components/AuthShell.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export default function ResetPasswordPage() {
  useDocumentMeta({
    title: 'Новый пароль — Nova CRM',
    robots: 'noindex, nofollow',
    canonical: 'https://nova-crm.online/',
  });
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов');
      return;
    }
    setLoading(true);
    try {
      await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Ссылка недействительна');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell layout="narrow" title="Новый пароль" subtitle="Придумайте пароль для входа в CRM.">
      {done ? (
        <p className="auth-switch">
          Пароль обновлён. <Link to="/login">Войти</Link>
        </p>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="new-password" placeholder="минимум 8 символов" minLength={8} />
          {error ? <div className="error">{error}</div> : null}
          <button className="btn primary auth-submit" type="submit" disabled={loading || !token}>
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
