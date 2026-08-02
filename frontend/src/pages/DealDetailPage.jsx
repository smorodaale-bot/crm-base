import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import {
  LOST_REASONS,
  STAGE_LABELS,
  STAGES,
  formatDate,
  formatDateInput,
  formatMoney,
} from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function DealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isSupervisor, canWrite } = useAuth();
  const toast = useToast();
  const [deal, setDeal] = useState(null);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [comment, setComment] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', amount: '', nextContactAt: '' });
  const [lostReason, setLostReason] = useState('');

  async function load() {
    setError('');
    try {
      const data = await api(`/deals/${id}`);
      setDeal(data.deal);
      setLostReason(data.deal.lostReason || '');
      setForm({
        title: data.deal.title,
        amount: String(data.deal.amount),
        nextContactAt: formatDateInput(data.deal.nextContactAt),
      });
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
      if (err.status === 403 || err.status === 404) setTimeout(() => navigate('/deals'), 1200);
    }
  }

  useEffect(() => {
    load();
    api('/templates').then((d) => setTemplates(d.templates)).catch(() => {});
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, [id, isSupervisor]);

  async function saveBasics(e) {
    e.preventDefault();
    try {
      await api(`/deals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          amount: Number(form.amount),
          nextContactAt: form.nextContactAt ? new Date(form.nextContactAt).toISOString() : null,
        }),
      });
      toast.success('Сохранено');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changeStage(stage) {
    try {
      await api(`/deals/${id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({
          stage,
          lostReason: stage === 'LOST' ? lostReason || undefined : undefined,
        }),
      });
      toast.success(`Этап изменён — сделка в разделе «${STAGE_LABELS[stage]}»`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function changeResponsible(responsibleId) {
    try {
      await api(`/deals/${id}/responsible`, {
        method: 'PATCH',
        body: JSON.stringify({ responsibleId: Number(responsibleId) }),
      });
      toast.success('Ответственный изменён');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addComment(e) {
    e.preventDefault();
    try {
      await api(`/deals/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: comment }),
      });
      setComment('');
      toast.success('Комментарий добавлен');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`/api/deals/${id}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        credentials: 'include',
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast.success('Файл загружен');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function addTask(e) {
    e.preventDefault();
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle,
          dealId: Number(id),
          clientId: deal.clientId,
        }),
      });
      setTaskTitle('');
      toast.success('Задача создана');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!deal && !error) return <div className="muted">Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/deals" className="muted">
            ← К списку
          </Link>
          <h1>{deal?.title || 'Сделка'}</h1>
          {deal && (
            <p className="muted">
              {formatMoney(deal.amount)} · {STAGE_LABELS[deal.stage]} · {deal.daysInStage || 0} дн. на
              этапе
            </p>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!deal ? null : (
        <div className="grid-2">
          <section className="panel stack">
            <h2>Карточка сделки</h2>
            <div>
              <div className="muted">Клиент</div>
              <div>
                <Link to={`/clients/${deal.clientId}`}>
                  {deal.client?.name} · {deal.client?.phone}
                </Link>
              </div>
            </div>
            <div>
              <div className="muted">Создана</div>
              <div>{formatDate(deal.createdAt)}</div>
            </div>

            {canWrite ? (
              <>
                <label>
                  Этап
                  <select
                    value={deal.stage}
                    onChange={(e) => {
                      const stage = e.target.value;
                      if (stage === 'LOST' && !lostReason) {
                        toast.error('Сначала укажите причину отказа ниже');
                        return;
                      }
                      changeStage(stage);
                    }}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Причина отказа
                  <select value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                    <option value="">—</option>
                    {LOST_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <div>
                <div className="muted">Этап</div>
                <div>{STAGE_LABELS[deal.stage]}</div>
              </div>
            )}

            {isSupervisor && canWrite ? (
              <label>
                Ответственный
                <select
                  value={deal.responsibleId}
                  onChange={(e) => changeResponsible(e.target.value)}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div>
                <div className="muted">Ответственный</div>
                <div>{deal.responsible?.name}</div>
              </div>
            )}

            {canWrite && (
              <form className="stack" onSubmit={saveBasics}>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
                <input
                  type="datetime-local"
                  value={form.nextContactAt}
                  onChange={(e) => setForm({ ...form, nextContactAt: e.target.value })}
                />
                <button className="btn primary">Сохранить</button>
              </form>
            )}

            <h2>Файлы</h2>
            {canWrite && <input type="file" onChange={uploadFile} />}
            {(deal.attachments || []).length === 0 ? (
              <EmptyState title="Файлов нет" />
            ) : (
              <ul className="plain-list">
                {deal.attachments.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="linkish"
                      onClick={async () => {
                        const res = await fetch(`/api/deals/${id}/files/${f.id}/download`, {
                          headers: { Authorization: `Bearer ${getToken()}` },
                          credentials: 'include',
                        });
                        if (!res.ok) {
                          toast.error('Не удалось скачать файл');
                          return;
                        }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = f.originalName;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      {f.originalName}
                    </button>{' '}
                    <span className="muted">({Math.round(f.size / 1024)} КБ)</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel stack">
            <h2>Комментарии</h2>
            {canWrite && (
              <form className="stack" onSubmit={addComment}>
                {templates.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const t = templates.find((x) => String(x.id) === e.target.value);
                      if (t) setComment(t.text);
                    }}
                  >
                    <option value="">Шаблон комментария</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Новый комментарий"
                  required
                />
                <button className="btn">Добавить</button>
              </form>
            )}
            <div className="timeline">
              {(deal.comments || []).map((c) => (
                <div key={c.id} className="timeline-item">
                  <strong>{c.author?.name}</strong>
                  <span className="muted">{formatDate(c.createdAt)}</span>
                  <div>{c.text}</div>
                </div>
              ))}
            </div>

            <h2>Задачи по сделке</h2>
            {canWrite && (
              <form className="row-actions" onSubmit={addTask}>
                <input
                  required
                  placeholder="Новая задача"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
                <button className="btn">+</button>
              </form>
            )}
            {(deal.tasks || []).length === 0 ? (
              <EmptyState title="Задач нет" />
            ) : (
              <ul className="plain-list">
                {deal.tasks.map((t) => (
                  <li key={t.id}>
                    {t.title} · {t.status} · до {formatDate(t.dueAt)}
                  </li>
                ))}
              </ul>
            )}

            <h2>История изменений</h2>
            <div className="timeline">
              {(deal.history || []).map((h) => (
                <div key={h.id} className="timeline-item">
                  <strong>{h.changer?.name}</strong>
                  <span className="muted">{formatDate(h.changedAt)}</span>
                  <div>
                    {h.field}: {h.oldValue || '—'} → {h.newValue || '—'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
