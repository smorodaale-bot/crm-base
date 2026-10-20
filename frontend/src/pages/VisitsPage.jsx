import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

const STATUS_LABELS = {
  SCHEDULED: 'Запланирован',
  COMPLETED: 'Пришёл',
  NO_SHOW: 'Неявка',
  CANCELLED: 'Отменён',
};

export default function VisitsPage() {
  const { canWrite, isSupervisor } = useAuth();
  const toast = useToast();
  const [visits, setVisits] = useState([]);
  const [clients, setClients] = useState([]);
  const [deals, setDeals] = useState([]);
  const [managers, setManagers] = useState([]);
  const [error, setError] = useState('');
  const [todayOnly, setTodayOnly] = useState(true);
  const [form, setForm] = useState({
    clientId: '',
    scheduledAt: '',
    note: '',
    dealId: '',
    managerId: '',
  });

  async function load() {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (todayOnly) params.set('today', '1');
      const data = await api(`/visits?${params}`);
      setVisits(data.visits);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    api('/clients?limit=100')
      .then((d) => setClients(d.clients || []))
      .catch(() => {});
    api('/deals?limit=80')
      .then((d) =>
        setDeals((d.deals || []).filter((x) => !['WON', 'LOST'].includes(x.stage)))
      )
      .catch(() => {});
    if (isSupervisor) {
      api('/users')
        .then((d) => setManagers((d.users || []).filter((u) => u.role !== 'READONLY')))
        .catch(() => {});
    }
  }, [todayOnly, isSupervisor]);

  function onDealChange(dealId) {
    const deal = deals.find((d) => String(d.id) === String(dealId));
    setForm((prev) => ({
      ...prev,
      dealId,
      clientId: deal?.clientId ? String(deal.clientId) : prev.clientId,
    }));
  }

  async function createVisit(e) {
    e.preventDefault();
    try {
      await api('/visits', {
        method: 'POST',
        body: JSON.stringify({
          clientId: Number(form.clientId),
          scheduledAt: new Date(form.scheduledAt).toISOString(),
          note: form.note || null,
          dealId: form.dealId ? Number(form.dealId) : null,
          managerId: form.managerId ? Number(form.managerId) : undefined,
        }),
      });
      setForm({ clientId: '', scheduledAt: '', note: '', dealId: '', managerId: '' });
      toast.success('Визит записан');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/visits/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast.success('Статус обновлён');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Визиты</h1>
          <p className="muted">Запись клиентов в салон</p>
        </div>
        <label className="row gap">
          <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
          Только сегодня
        </label>
      </div>

      {canWrite && (
        <form className="panel form-grid" onSubmit={createVisit}>
          <h2>Новая запись</h2>
          <label>
            Сделка (опц.)
            <select value={form.dealId} onChange={(e) => onDealChange(e.target.value)}>
              <option value="">Без сделки</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.id} · {d.client?.name || d.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Клиент
            <select
              required
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              <option value="">Выберите</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <label>
            Дата и время
            <input
              type="datetime-local"
              lang="ru-RU"
              required
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
          </label>
          {isSupervisor && (
            <label>
              Менеджер
              <select
                value={form.managerId}
                onChange={(e) => setForm({ ...form, managerId: e.target.value })}
              >
                <option value="">Я / текущий пользователь</option>
                {managers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Комментарий
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn primary" type="submit">
            Записать
          </button>
        </form>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        {!visits.length ? (
          <EmptyState title="Визитов нет" text="Запишите клиента из сделки или формы выше" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Клиент</th>
                  <th>Сделка</th>
                  <th>Менеджер</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.scheduledAt)}</td>
                    <td>
                      <Link to={`/clients/${v.clientId}`}>{v.client?.name}</Link>
                      <div className="muted">{v.client?.phone}</div>
                    </td>
                    <td>
                      {v.deal ? <Link to={`/deals/${v.deal.id}`}>{v.deal.title}</Link> : '—'}
                    </td>
                    <td>{v.manager?.name || '—'}</td>
                    <td>{STATUS_LABELS[v.status] || v.status}</td>
                    <td className="row gap">
                      {canWrite && v.status === 'SCHEDULED' && (
                        <>
                          <button type="button" className="btn" onClick={() => setStatus(v.id, 'COMPLETED')}>
                            Пришёл
                          </button>
                          <button type="button" className="btn" onClick={() => setStatus(v.id, 'NO_SHOW')}>
                            Неявка
                          </button>
                          <button type="button" className="btn" onClick={() => setStatus(v.id, 'CANCELLED')}>
                            Отменить
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
