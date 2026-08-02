import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDate } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

const ACTION_LABELS = {
  deal_created: 'Создана сделка',
  stage_changed: 'Изменён этап',
  responsible_changed: 'Изменён ответственный',
  deal_deleted: 'Сделка удалена',
  client_merged: 'Клиенты объединены',
  file_uploaded: 'Загружен файл',
};

export default function ActivityPage() {
  const { isSupervisor } = useAuth();
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1 });
  const [filters, setFilters] = useState({
    action: '',
    userId: '',
    from: '',
    to: '',
    page: 1,
  });
  const [error, setError] = useState('');

  async function load(next = filters) {
    try {
      const params = new URLSearchParams({
        page: String(next.page || 1),
        limit: '30',
      });
      if (next.action) params.set('action', next.action);
      if (isSupervisor && next.userId) params.set('userId', next.userId);
      if (next.from) params.set('from', new Date(next.from).toISOString());
      if (next.to) params.set('to', new Date(next.to).toISOString());
      const data = await api(`/activity?${params}`);
      setLogs(data.logs);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, [isSupervisor]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Журнал действий</h1>
          <p className="muted">Фильтры по дате, менеджеру и типу действия</p>
        </div>
      </div>

      <div className="filters">
        <select
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        >
          <option value="">Все действия</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {isSupervisor && (
          <select
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
          >
            <option value="">Все пользователи</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        />
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

      {error && <div className="error">{error}</div>}

      {logs.length === 0 ? (
        <EmptyState title="Записей нет" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кто</th>
                <th>Действие</th>
                <th>Сущность</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>{log.user?.name}</td>
                  <td>{ACTION_LABELS[log.action] || log.action}</td>
                  <td>
                    {log.entityType} #{log.entityId}
                  </td>
                  <td>
                    <code>{JSON.stringify(log.metadata || {})}</code>
                  </td>
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
          Стр. {pagination.page} / {pagination.pages || 1}
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
