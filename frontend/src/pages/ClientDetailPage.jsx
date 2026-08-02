import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { STAGE_LABELS, formatDate, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function ClientDetailPage() {
  const { id } = useParams();
  const { isSupervisor, canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [clients, setClients] = useState([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await api(`/clients/${id}`);
      setClient(data.client);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    if (isSupervisor) {
      api('/clients?limit=100').then((d) => setClients(d.clients.filter((c) => String(c.id) !== id)));
    }
  }, [id, isSupervisor]);

  async function merge() {
    try {
      await api(`/clients/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetId: Number(mergeTarget) }),
      });
      toast.success('Клиенты объединены');
      navigate(`/clients/${mergeTarget}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!client) return <div className="muted">Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/clients" className="muted">
            ← К клиентам
          </Link>
          <h1>{client.name}</h1>
          <p className="muted">
            {client.phone} · {client.email || 'без email'}
          </p>
        </div>
        {canWrite && (
          <Link className="btn" to={`/clients/${id}/edit`}>
            Редактировать
          </Link>
        )}
      </div>

      <div className="grid-2">
        <section className="panel stack">
          <h2>Карточка</h2>
          <div>
            <div className="muted">Источник</div>
            <div>{client.source || client.leadSource?.name || '—'}</div>
          </div>
          <div>
            <div className="muted">Менеджер</div>
            <div>{client.responsibleManager?.name || '—'}</div>
          </div>
          <div>
            <div className="muted">Комментарий</div>
            <div>{client.comment || '—'}</div>
          </div>

          {isSupervisor && canWrite && (
            <>
              <h2>Объединить с дублем</h2>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">Выберите целевого клиента</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.phone}
                  </option>
                ))}
              </select>
              <button className="btn" disabled={!mergeTarget} onClick={merge}>
                Merge → в выбранного
              </button>
            </>
          )}
        </section>

        <section className="panel stack">
          <h2>Сделки клиента</h2>
          {(client.deals || []).length === 0 ? (
            <EmptyState title="Сделок нет" />
          ) : (
            <div className="timeline">
              {client.deals.map((d) => (
                <div key={d.id} className="timeline-item">
                  <Link to={`/deals/${d.id}`}>
                    <strong>{d.title}</strong>
                  </Link>
                  <span className="muted">
                    {STAGE_LABELS[d.stage]} · {formatMoney(d.amount)} · {d.responsible?.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h2>Задачи</h2>
          {(client.tasks || []).length === 0 ? (
            <EmptyState title="Задач нет" />
          ) : (
            <ul className="plain-list">
              {client.tasks.map((t) => (
                <li key={t.id}>
                  {t.title} · {t.status} · {formatDate(t.dueAt)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
