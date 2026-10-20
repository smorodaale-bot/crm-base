import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { ROLE_LABELS, roleLabel } from '../constants.js';
import OrgAdminShell from '../components/OrgAdminShell.jsx';
import { Skeleton } from '../components/Skeleton.jsx';

function formatSeatLine(used, limit) {
  const n = Number(used) || 0;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'сотрудник'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 > 20)
        ? 'сотрудника'
        : 'сотрудников';
  if (limit == null) return `${n} ${word} · без ограничений`;
  return `Мест: ${n} из ${limit}`;
}

export default function OrgTeamPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MANAGER');
  const [inviteHint, setInviteHint] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [memberForm, setMemberForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'MANAGER',
  });

  async function load() {
    setError('');
    try {
      const [orgData, membersData] = await Promise.all([
        api('/org'),
        api('/org/members'),
      ]);
      setOrg(orgData.organization);
      setMembers(membersData.members || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendInvite(e) {
    e.preventDefault();
    try {
      const data = await api('/org/invites', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteHint(data.message || '');
      setInviteLink(data.inviteLink || data.devLink || '');
      setInviteEmail('');
      toast.success('Приглашение создано');
    } catch (err) {
      if (err.code === 'SEAT_LIMIT') setUpgradeMsg(err.message);
      else toast.error(err.message);
    }
  }

  async function addMember(e) {
    e.preventDefault();
    try {
      await api('/org/members', {
        method: 'POST',
        body: JSON.stringify(memberForm),
      });
      setMemberForm({ name: '', email: '', password: '', role: 'MANAGER' });
      toast.success('Сотрудник добавлен');
      await load();
    } catch (err) {
      if (err.code === 'SEAT_LIMIT') setUpgradeMsg(err.message);
      else toast.error(err.message);
    }
  }

  async function endSessions(id) {
    try {
      await api(`/org/members/${id}/sessions/revoke`, { method: 'POST', body: '{}' });
      toast.success('Сессии сотрудника завершены');
      if (id === user?.id) await logout();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deactivateMember(id) {
    try {
      await api(`/org/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ deactivate: true }),
      });
      toast.success('Сотрудник деактивирован');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!org) return <Skeleton variant="table" />;

  const usage = org.usage || {};

  return (
    <OrgAdminShell
      title="Сотрудники"
      lead={`${org.name} · ${formatSeatLine(usage.seatsUsed ?? 0, usage.seatsLimit)}`}
    >
      <section className="org-admin-panel">
        <h2>Пригласить</h2>
        {upgradeMsg ? (
          <div className="error">
            {upgradeMsg}{' '}
            <Link className="btn" to="/org/billing">
              Повысить тариф
            </Link>
          </div>
        ) : null}
        <form className="form-grid" onSubmit={addMember}>
          <label>
            Имя
            <input
              required
              value={memberForm.name}
              onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={memberForm.email}
              onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
            />
          </label>
          <label>
            Пароль
            <input
              required
              type="password"
              minLength={8}
              value={memberForm.password}
              onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })}
            />
          </label>
          <label>
            Роль
            <select
              value={memberForm.role}
              onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit">
            Добавить
          </button>
        </form>
        <form className="form-grid" style={{ marginTop: 16 }} onSubmit={sendInvite}>
          <label>
            Email для ссылки
            <input required type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </label>
          <label>
            Роль
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">Отправить приглашение</button>
        </form>
        {inviteHint ? <p className="muted">{inviteHint}</p> : null}
        {inviteLink ? (
          <div className="row gap" style={{ marginTop: 12, alignItems: 'center' }}>
            <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink);
                  toast.success('Ссылка скопирована');
                } catch {
                  toast.error('Не удалось скопировать');
                }
              }}
            >
              Копировать
            </button>
          </div>
        ) : null}
      </section>

      <section className="org-admin-panel">
        <h2>Команда</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>{roleLabel(m)}</td>
                  <td>
                    <div className="row gap">
                      <button type="button" className="btn" onClick={() => endSessions(m.id)}>
                        Завершить сессии
                      </button>
                      {m.id !== user?.id && (
                        <button type="button" className="btn" onClick={() => deactivateMember(m.id)}>
                          Деактивировать
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </OrgAdminShell>
  );
}
