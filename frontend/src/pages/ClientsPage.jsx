import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { EmptyState } from '../components/EmptyState.jsx';

export default function ClientsPage() {
  const { canWrite } = useAuth();
  const [clients, setClients] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  async function load(p = page) {
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '15', sortBy: 'updatedAt' });
      if (search) params.set('search', search);
      const data = await api(`/clients?${params}`);
      setClients(data.clients);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Клиенты</h1>
          <p className="muted">Поиск, антидубли по телефону/email, карточки</p>
        </div>
        {canWrite && (
          <Link className="btn primary" to="/clients/new">
            Новый клиент
          </Link>
        )}
      </div>

      <div className="filters">
        <input
          placeholder="Имя, телефон или email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn"
          onClick={() => {
            setPage(1);
            load(1);
          }}
        >
          Найти
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {clients.length === 0 ? (
        <EmptyState title="Клиентов нет" text="Добавьте первого клиента" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Источник</th>
                <th>Менеджер</th>
                <th>Сделки</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/clients/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{c.phone}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.source || c.leadSource?.name || '—'}</td>
                  <td>{c.responsibleManager?.name || '—'}</td>
                  <td>{c._count?.deals ?? 0}</td>
                  <td>{canWrite && <Link to={`/clients/${c.id}/edit`}>Изменить</Link>}</td>
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
            const p = pagination.page - 1;
            setPage(p);
            load(p);
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
            const p = pagination.page + 1;
            setPage(p);
            load(p);
          }}
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
