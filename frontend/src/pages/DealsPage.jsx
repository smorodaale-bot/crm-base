import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { STAGE_LABELS, STAGES, formatDate, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function DealsPage() {
  const { isSupervisor, canWrite } = useAuth();
  const toast = useToast();
  const [deals, setDeals] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    stage: '',
    responsibleId: '',
    sortBy: 'updatedAt',
    sortDir: 'desc',
    page: 1,
  });
  const [form, setForm] = useState({
    clientId: '',
    title: '',
    amount: '',
    nextContactAt: '',
    responsibleId: '',
  });
  const [error, setError] = useState('');

  async function load(nextFilters = filters) {
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextFilters.page || 1),
        limit: '15',
        sortBy: nextFilters.sortBy,
        sortDir: nextFilters.sortDir,
      });
      if (nextFilters.search) params.set('search', nextFilters.search);
      if (nextFilters.stage) params.set('stage', nextFilters.stage);
      if (isSupervisor && nextFilters.responsibleId) params.set('responsibleId', nextFilters.responsibleId);
      const data = await api(`/deals?${params}`);
      setDeals(data.deals);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    api('/clients?limit=100').then((d) => setClients(d.clients)).catch(() => {});
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, [isSupervisor]);

  async function createDeal(e) {
    e.preventDefault();
    try {
      const body = {
        clientId: Number(form.clientId),
        title: form.title,
        amount: Number(form.amount),
        nextContactAt: form.nextContactAt ? new Date(form.nextContactAt).toISOString() : null,
      };
      if (isSupervisor && form.responsibleId) body.responsibleId = Number(form.responsibleId);
      await api('/deals', { method: 'POST', body: JSON.stringify(body) });
      setForm({ clientId: '', title: '', amount: '', nextContactAt: '', responsibleId: '' });
      toast.success('Сделка создана');
      await load({ ...filters, page: 1 });
    } catch (err) {
      toast.error(err.message);
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Сделки</h1>
          <p className="muted">Поиск, сортировка, пагинация и экспорт</p>
        </div>
        <button
          className="btn"
          onClick={() =>
            downloadCsv('/deals/export.csv', 'deals.csv').catch((e) => toast.error(e.message))
          }
        >
          Экспорт CSV
        </button>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Фильтры</h2>
          <div className="stack">
            <input
              placeholder="Поиск"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
            <select
              value={filters.stage}
              onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
            >
              <option value="">Все этапы</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            {isSupervisor && (
              <select
                value={filters.responsibleId}
                onChange={(e) => setFilters({ ...filters, responsibleId: e.target.value })}
              >
                <option value="">Все менеджеры</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={`${filters.sortBy}:${filters.sortDir}`}
              onChange={(e) => {
                const [sortBy, sortDir] = e.target.value.split(':');
                setFilters({ ...filters, sortBy, sortDir });
              }}
            >
              <option value="updatedAt:desc">Сначала новые изменения</option>
              <option value="amount:desc">Сумма ↓</option>
              <option value="amount:asc">Сумма ↑</option>
              <option value="nextContactAt:asc">Ближайший контакт</option>
              <option value="stageChangedAt:asc">Дольше на этапе</option>
            </select>
            <button
              className="btn"
              onClick={() => {
                const next = { ...filters, page: 1 };
                setFilters(next);
                load(next);
              }}
            >
              Применить
            </button>
          </div>
        </section>

        {canWrite && (
          <section className="panel">
            <h2>Новая сделка</h2>
            <form className="stack" onSubmit={createDeal}>
              <select
                required
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              >
                <option value="">Клиент</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
              <input
                required
                placeholder="Название"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="Сумма"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              <input
                type="datetime-local"
                value={form.nextContactAt}
                onChange={(e) => setForm({ ...form, nextContactAt: e.target.value })}
              />
              {isSupervisor && (
                <select
                  value={form.responsibleId}
                  onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}
                >
                  <option value="">Ответственный (я)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn primary">Создать</button>
            </form>
          </section>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {deals.length === 0 ? (
        <EmptyState title="Сделок нет" text="Создайте первую или измените фильтры" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Клиент</th>
                <th>Сумма</th>
                <th>Этап</th>
                <th>Дней на этапе</th>
                <th>Ответственный</th>
                <th>След. контакт</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/deals/${d.id}`}>{d.title}</Link>
                  </td>
                  <td>{d.client?.name}</td>
                  <td>{formatMoney(d.amount)}</td>
                  <td>{STAGE_LABELS[d.stage]}</td>
                  <td>{d.daysInStage ?? 0}</td>
                  <td>{d.responsible?.name}</td>
                  <td>{formatDate(d.nextContactAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        <button
          className="btn"
          disabled={pagination.page <= 1}
          onClick={() => {
            const next = { ...filters, page: pagination.page - 1 };
            setFilters(next);
            load(next);
          }}
        >
          Назад
        </button>
        <span className="muted">
          Стр. {pagination.page} / {pagination.pages || 1} · всего {pagination.total}
        </span>
        <button
          className="btn"
          disabled={pagination.page >= pagination.pages}
          onClick={() => {
            const next = { ...filters, page: pagination.page + 1 };
            setFilters(next);
            load(next);
          }}
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
