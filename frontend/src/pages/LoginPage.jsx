import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('manager@crm.local');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <div className="brand-mark" aria-hidden="true" />
          <h1>SkayAvto CRM</h1>
        </div>
        <p className="muted" style={{ textAlign: 'center' }}>
          Вход для менеджеров и руководителей автосалона
        </p>

        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>

        <label>
          Пароль
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button className="btn primary" disabled={loading}>
          {loading ? 'Вход...' : 'Войти'}
        </button>

        <p className="muted" style={{ fontSize: '0.8rem', textAlign: 'center' }}>
          demo: manager@crm.local / Password123!
        </p>
      </form>
    </div>
  );
}
