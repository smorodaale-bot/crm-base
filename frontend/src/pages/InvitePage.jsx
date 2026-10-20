import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AuthShell } from '../components/AuthShell.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

export default function InvitePage() {
  const { token } = useParams();
  const { setUser } = useAuth();
  useDocumentMeta({
    title: 'Приглашение — Nova CRM',
    robots: 'noindex, nofollow',
    canonical: 'https://nova-crm.online/',
  });
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/auth/invite/${token}`)
      .then(setInvite)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!agree) {
      setError('Нужно согласие с офертой и политикой ПДн');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, name, password }),
      });
      setToken(data.accessToken || data.token);
      if (setUser) setUser(data.user);
      window.location.assign('/inbox');
    } catch (err) {
      setError(err.message || 'Не удалось присоединиться');
      setBusy(false);
    }
  }

  return (
    <AuthShell layout="narrow" title="Принять приглашение" subtitle="Создайте пароль для доступа к CRM салона.">
      {loading ? <p className="auth-hint">Загрузка приглашения...</p> : null}
      {invite ? (
        <>
          <div className="auth-success">
            <strong>{invite.organizationName}</strong>
            <p>Вас пригласили в салон · роль: {invite.roleLabel}</p>
          </div>
          <form className="auth-form" onSubmit={onSubmit}>
            <label className="auth-field">
              <span className="auth-field-label">Email</span>
              <input className="auth-input" value={invite.email} disabled />
            </label>
            <p className="auth-hint">Email из приглашения — изменить нельзя</p>
            <label className="auth-field">
              <span className="auth-field-label">Ваше имя</span>
              <input className="auth-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Петров" autoComplete="name" required />
            </label>
            <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="new-password" placeholder="минимум 8 символов" minLength={8} />
            <label className="auth-check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                Согласен с <Link to="/offer">офертой</Link> и <Link to="/privacy">политикой ПДн</Link>
              </span>
            </label>
            {error ? <div className="error">{error}</div> : null}
            <button className="btn primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Вход...' : 'Присоединиться к салону'}
            </button>
          </form>
        </>
      ) : null}
      {!loading && !invite && error ? <div className="error">{error}</div> : null}
      <p className="auth-switch">
        Уже есть аккаунт? <Link to="/login">Войти</Link>
      </p>
    </AuthShell>
  );
}
