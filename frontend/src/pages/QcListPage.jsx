import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate } from '../constants.js';
import { useAuth } from '../auth.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Skeleton } from '../components/Skeleton.jsx';

function ScoreBadge({ score, critical }) {
  let cls = 'score-ok';
  if (score < 40 || critical) cls = 'score-bad';
  else if (score < 70) cls = 'score-mid';
  return <span className={`score-badge ${cls}`}>{score}</span>;
}

export default function QcListPage() {
  const { isSupervisor, canWrite } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [managers, setManagers] = useState([]);
  const [form, setForm] = useState({
    title: '',
    managerId: '',
    clientName: '',
    transcript: '',
    audio: null,
    useLlm: true,
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (criticalOnly) params.set('critical', 'true');
    api(`/qc/reviews?${params}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, [criticalOnly]);

  useEffect(() => {
    if (!isSupervisor) return;
    api('/users')
      .then((res) => {
        const list = res.users || res.items || res || [];
        setManagers(Array.isArray(list) ? list.filter((u) => u.role === 'MANAGER' || u.role === 'SUPERVISOR' || u.role === 'ADMIN') : []);
      })
      .catch(() => {});
  }, [isSupervisor]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('managerId', form.managerId);
      if (form.clientName) fd.append('clientName', form.clientName);
      if (form.transcript) fd.append('transcript', form.transcript);
      if (form.audio) fd.append('audio', form.audio);
      if (form.useLlm) fd.append('useLlm', 'true');

      await api('/qc/reviews', { method: 'POST', body: fd });
      setShowForm(false);
      setForm({
        title: '',
        managerId: '',
        clientName: '',
        transcript: '',
        audio: null,
        useLlm: true,
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const loadFixture = async (id) => {
    try {
      const { fixtures } = await api('/qc/fixtures');
      const f = fixtures.find((x) => x.id === id);
      if (!f) return;
      setForm((prev) => ({
        ...prev,
        title: f.title,
        clientName: f.clientName || '',
        transcript: f.transcript,
        managerId: prev.managerId || (managers[0]?.id ? String(managers[0].id) : ''),
      }));
      setShowForm(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <Skeleton variant="table" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Контроль качества</h1>
          <p className="muted">Оценка разговоров менеджеров по транскрибации</p>
        </div>
        <div className="row gap">
          {isSupervisor && (
            <Link className="btn" to="/qc/report">
              Отчёт руководителя
            </Link>
          )}
          {canWrite && (
            <button className="btn primary" type="button" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Скрыть форму' : 'Новая проверка'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {showForm && (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <h2>Новая проверка</h2>
          {isSupervisor && (
            <div className="row gap" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <span className="muted">Эталоны:</span>
              {['ideal', 'weak_discovery', 'rude_conflict', 'false_promises', 'good_with_objection'].map(
                (id) => (
                  <button key={id} type="button" className="btn" onClick={() => loadFixture(id)}>
                    {id}
                  </button>
                )
              )}
            </div>
          )}
          <form onSubmit={onSubmit} className="form-grid">
            <label>
              Заголовок
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              Менеджер (ID)
              {managers.length ? (
                <select
                  required
                  value={form.managerId}
                  onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                >
                  <option value="">Выберите</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  value={form.managerId}
                  onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                  placeholder="ID менеджера"
                />
              )}
            </label>
            <label>
              Клиент
              <input
                value={form.clientName}
                onChange={(e) => setForm({ ...form, clientName: e.target.value })}
              />
            </label>
            <label>
              Аудио (опционально)
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setForm({ ...form, audio: e.target.files?.[0] || null })}
              />
            </label>
            <label className="full">
              Транскрибация
              <textarea
                rows={12}
                value={form.transcript}
                onChange={(e) => setForm({ ...form, transcript: e.target.value })}
                placeholder="Менеджер: ...&#10;Клиент: ..."
                required={!form.audio}
              />
            </label>
            <label
              className="full"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.85rem',
                color: 'var(--muted)',
                marginTop: '0.15rem',
              }}
            >
              <input
                type="checkbox"
                checked={form.useLlm}
                onChange={(e) => setForm({ ...form, useLlm: e.target.checked })}
              />
              ИИ: усилить резюме и рекомендации
            </label>
            <div className="full">
              <button className="btn primary" disabled={saving}>
                {saving ? 'Анализ...' : 'Оценить разговор'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="row gap" style={{ marginBottom: '1rem' }}>
        <input
          placeholder="Поиск..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ maxWidth: 280 }}
        />
        <button className="btn" type="button" onClick={load}>
          Найти
        </button>
        <label className="row gap" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => setCriticalOnly(e.target.checked)}
          />
          Только критические
        </label>
      </div>

      {!data.items?.length ? (
        <EmptyState title="Нет проверок" text="Создайте первую оценку разговора" />
      ) : (
        <div className="table-wrap panel">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Разговор</th>
                <th>Менеджер</th>
                <th>Оценка</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>
                    <Link to={`/qc/${r.id}`}>{r.title}</Link>
                    {r.clientName && <div className="muted">{r.clientName}</div>}
                  </td>
                  <td>{r.manager?.name}</td>
                  <td>
                    <ScoreBadge score={r.effectiveScore} critical={r.isCritical} />
                    {r.manualScore != null && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        ИИ: {r.overallScore}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.isCritical ? (
                      <span className="badge danger">Критично</span>
                    ) : (
                      <span className="badge muted">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
