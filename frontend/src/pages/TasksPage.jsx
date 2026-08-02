import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function TasksPage() {
  const { canWrite, isSupervisor } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState({ status: 'OPEN', overdue: false, today: false });
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', assigneeId: '' });
  const [error, setError] = useState('');

  async function load() {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filter.status) params.set('status', filter.status);
      if (filter.overdue) params.set('overdue', '1');
      if (filter.today) params.set('today', '1');
      const data = await api(`/tasks?${params}`);
      setTasks(data.tasks);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, [isSupervisor]);

  async function createTask(e) {
    e.preventDefault();
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
          assigneeId: form.assigneeId ? Number(form.assigneeId) : undefined,
        }),
      });
      setForm({ title: '', description: '', dueAt: '', assigneeId: '' });
      toast.success('Задача создана');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast.success('Обновлено');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Задачи и календарь</h1>
          <p className="muted">Звонки, КП, follow-up отдельно от next contact</p>
        </div>
      </div>

      <div className="filters">
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value, overdue: false, today: false })}
        >
          <option value="">Все статусы</option>
          <option value="OPEN">Открытые</option>
          <option value="DONE">Выполненные</option>
          <option value="CANCELLED">Отменённые</option>
        </select>
        <button className="btn" onClick={() => { setFilter({ status: 'OPEN', overdue: true, today: false }); setTimeout(load, 0); }}>
          Просроченные
        </button>
        <button className="btn" onClick={() => { setFilter({ status: '', overdue: false, today: true }); setTimeout(load, 0); }}>
          На сегодня
        </button>
        <button className="btn" onClick={load}>
          Обновить
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="grid-2">
        {canWrite && (
          <section className="panel">
            <h2>Новая задача</h2>
            <form className="stack" onSubmit={createTask}>
              <input
                required
                placeholder="Название"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <textarea
                rows={3}
                placeholder="Описание"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <input
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
              {isSupervisor && (
                <select
                  value={form.assigneeId}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                >
                  <option value="">Исполнитель (я)</option>
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

        <section className="panel">
          <h2>Список</h2>
          {tasks.length === 0 ? (
            <EmptyState title="Задач нет" text="Создайте первую задачу" />
          ) : (
            <div className="timeline">
              {tasks.map((t) => (
                <div key={t.id} className="timeline-item">
                  <strong>{t.title}</strong>
                  <span className="muted">
                    {t.status} · до {formatDate(t.dueAt)} · {t.assignee?.name}
                  </span>
                  {t.deal && (
                    <Link to={`/deals/${t.deal.id}`}>Сделка: {t.deal.title}</Link>
                  )}
                  {canWrite && t.status === 'OPEN' && (
                    <div className="row-actions">
                      <button className="btn" onClick={() => setStatus(t.id, 'DONE')}>
                        Готово
                      </button>
                      <button className="btn" onClick={() => setStatus(t.id, 'CANCELLED')}>
                        Отменить
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
