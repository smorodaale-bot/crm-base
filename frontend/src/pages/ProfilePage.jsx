import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Skeleton } from '../components/Skeleton.jsx';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate, roleLabel } from '../constants.js';

export default function ProfilePage() {
  const { user: authUser, canWrite, isSupervisor, setUser, logout } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: '', telegramChatId: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [tgTestBusy, setTgTestBusy] = useState(false);
  const [sessions, setSessions] = useState({ devices: [], sessions: [] });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/users/me');
      setProfile(data.user);
      const access = await api('/auth/sessions').catch(() => ({ devices: [], sessions: [] }));
      setSessions(access);
      setForm({
        name: data.user.name || '',
        telegramChatId: data.user.telegramChatId || '',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    try {
      const data = await api('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          telegramChatId: form.telegramChatId || null,
        }),
      });
      setProfile(data.user);
      if (setUser) setUser({ ...authUser, name: data.user.name, salonId: data.user.salonId });
      toast.success('Профиль сохранён');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirm) {
      toast.error('Пароли не совпадают');
      return;
    }
    try {
      await api('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Пароль обновлён');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function testTelegram() {
    setTgTestBusy(true);
    try {
      if (form.telegramChatId !== (profile?.telegramChatId || '')) {
        await api('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name,
            telegramChatId: form.telegramChatId || null,
          }),
        });
      }
      const data = await api('/users/me/telegram/test', { method: 'POST', body: '{}' });
      toast.success(data.message || 'Проверьте Telegram');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTgTestBusy(false);
    }
  }

  async function logoutEverywhere() {
    try {
      await api('/auth/sessions/revoke-all', { method: 'POST', body: '{}' });
      toast.success('Сессии завершены');
      await logout();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <Skeleton />;
  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Личный кабинет</h1>
          <p className="muted">Настройки профиля и уведомлений</p>
        </div>
        <div className="row gap">
          <Link className="btn" to="/inbox">
            Рабочий стол
          </Link>
          <Link className="btn" to="/tasks">
            Мои задачи
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <div className="profile-hero">
            <div className="user-avatar profile-avatar" aria-hidden="true">
              {(profile?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="profile-name">{profile?.name}</div>
              <div className="muted">{roleLabel(profile)}</div>
              <div className="muted">{profile?.email}</div>
            </div>
          </div>

          <div className="profile-meta">
            <div>
              <div className="muted">Доступ</div>
              <div>
                {isSupervisor ? 'Все сделки салона' : canWrite ? 'Только свои сделки' : 'Только чтение'}
              </div>
            </div>
            <div>
              <div className="muted">Салон</div>
              <div>{profile?.salon?.name || 'Nova'}</div>
            </div>
            <div>
              <div className="muted">В системе с</div>
              <div>{formatDate(profile?.createdAt)}</div>
            </div>
          </div>

          {canWrite ? (
            <form className="stack" onSubmit={saveProfile}>
              <h2>Профиль</h2>
              <label>
                Имя
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Email
                <input value={profile?.email || ''} disabled />
              </label>
              <label>
                Telegram Chat ID
                <input
                  placeholder="Например 123456789"
                  value={form.telegramChatId}
                  onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })}
                />
              </label>
              <p className="muted" style={{ margin: 0 }}>
                Уведомления шлёт <strong>тот же бот салона</strong>, что в «Орг → Каналы → Telegram».
                Chat ID узнайте у <code>@userinfobot</code>, затем откройте бота салона и нажмите{' '}
                <strong>Старт</strong>.
              </p>
              <div className="row gap">
                <button className="btn primary" type="submit">
                  Сохранить
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={tgTestBusy || !form.telegramChatId.trim()}
                  onClick={testTelegram}
                >
                  {tgTestBusy ? 'Отправка…' : 'Тест в Telegram'}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Роль «только чтение»: изменение профиля недоступно.</p>
          )}
        </section>

        <section className="panel stack">
          <h2>Смена пароля</h2>
          {canWrite ? (
            <form className="stack" onSubmit={changePassword}>
              <label>
                Текущий пароль
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={passwords.currentPassword}
                  onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                />
              </label>
              <label>
                Новый пароль
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                />
              </label>
              <label>
                Повтор нового пароля
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                />
              </label>
              <button className="btn primary" type="submit">
                Обновить пароль
              </button>
            </form>
          ) : (
            <p className="muted">Смена пароля недоступна для этой роли.</p>
          )}

          <h2>Быстрые ссылки</h2>
          <ul className="list">
            <li>
              <Link to="/inbox">Рабочий стол — новые лиды и визиты</Link>
            </li>
            <li>
              <Link to="/reminders">Напоминания по контактам</Link>
            </li>
            <li>
              <Link to="/visits">Визиты в салон</Link>
            </li>
            <li>
              <Link to="/dashboard">Мой дашборд</Link>
            </li>
          </ul>
        </section>
      </div>

      <section className="panel stack" style={{ marginTop: 16 }}>
        <div className="row gap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Устройства и сессии</h2>
          <button className="btn" type="button" onClick={logoutEverywhere}>
            Выйти на всех устройствах
          </button>
        </div>
        <h3 style={{ margin: 0 }}>Доверенные устройства</h3>
        {(sessions.devices || []).length === 0 ? (
          <p className="muted">Нет доверенных устройств</p>
        ) : (
          <ul className="list">
            {sessions.devices.map((d) => (
              <li key={d.id}>
                {d.label}
                {d.current ? ' · это устройство' : ''}
                <span className="muted"> · был вход {formatDate(d.lastUsedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <h3 style={{ margin: 0 }}>Сессии</h3>
        {(sessions.sessions || []).length === 0 ? (
          <p className="muted">Нет активных сессий</p>
        ) : (
          <ul className="list">
            {sessions.sessions.map((s) => (
              <li key={s.id}>
                {s.remember ? 'Запомнить меня' : 'Сессия браузера'}
                {s.current ? ' · текущая' : ''}
                <span className="muted"> · до {formatDate(s.expiresAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
