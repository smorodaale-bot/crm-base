import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import {
  LOST_REASONS,
  NEEDS_WORK_DAYS,
  STAGE_COLORS,
  STAGE_LABELS,
  STAGES,
  formatMoney,
} from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function PipelinePage() {
  const { isSupervisor, canWrite } = useAuth();
  const toast = useToast();
  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [lostModal, setLostModal] = useState(null);
  const [lostReason, setLostReason] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search) params.set('search', search);
      if (isSupervisor && responsibleId) params.set('responsibleId', responsibleId);
      const [dealsData, statsData] = await Promise.all([
        api(`/deals?${params}`),
        api('/deals/pipeline-stats'),
      ]);
      setDeals(dealsData.deals);
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
  }, [isSupervisor]);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (const deal of deals) {
      if (map[deal.stage]) map[deal.stage].push(deal);
    }
    return map;
  }, [deals]);

  async function moveStage(dealId, stage, reason) {
    const prev = deals;
    // Optimistic: card jumps to target column immediately
    setDeals((list) =>
      list.map((d) =>
        d.id === dealId
          ? { ...d, stage, daysInStage: 0, stageChangedAt: new Date().toISOString() }
          : d
      )
    );

    try {
      await api(`/deals/${dealId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage, lostReason: reason || undefined }),
      });
      toast.success(`Сделка перенесена: ${STAGE_LABELS[stage]}`);
      const statsData = await api('/deals/pipeline-stats');
      setStats(statsData);
      const params = new URLSearchParams({ limit: '200' });
      if (search) params.set('search', search);
      if (isSupervisor && responsibleId) params.set('responsibleId', responsibleId);
      const dealsData = await api(`/deals?${params}`);
      setDeals(dealsData.deals);
    } catch (err) {
      setDeals(prev);
      setError(err.message);
      toast.error(err.message);
    }
  }

  function onSelectStage(deal, stage) {
    if (!canWrite || stage === deal.stage) return;
    if (stage === 'LOST') {
      setLostModal({ dealId: deal.id, stage });
      return;
    }
    moveStage(deal.id, stage);
  }

  function onDrop(stage) {
    if (!canWrite || !dragId) return;
    const deal = deals.find((d) => d.id === dragId);
    setDragId(null);
    if (!deal || deal.stage === stage) return;
    if (stage === 'LOST') {
      setLostModal({ dealId: dragId, stage });
      return;
    }
    moveStage(dragId, stage);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Воронка продаж</h1>
          <p className="muted">
            Выберите статус на карточке — сделка сама перейдёт в нужный раздел. Или перетащите
            карточку.
          </p>
        </div>
        <Link className="btn primary" to="/deals">
          Список сделок
        </Link>
      </div>

      {stats && (
        <div className="funnel-stats">
          <div className="stat-card">
            <div className="muted">Всего сделок</div>
            <strong>{stats.totalDeals}</strong>
          </div>
          <div className="stat-card">
            <div className="muted">В работе</div>
            <strong>{stats.openDeals}</strong>
          </div>
          <div className="stat-card">
            <div className="muted">Сумма открытых</div>
            <strong>{formatMoney(stats.openAmount)}</strong>
          </div>
          <div className={`stat-card ${stats.needsWorkCount ? 'stat-warn' : ''}`}>
            <div className="muted">Нужно проработать</div>
            <strong>{stats.needsWorkCount}</strong>
            <div className="muted" style={{ fontSize: '0.75rem' }}>
              ≥ {stats.needsWorkDays || NEEDS_WORK_DAYS} дн. на этапе или просрочен контакт
            </div>
          </div>
          {STAGES.map((stage) => {
            const row = stats.byStage?.[stage];
            const color = STAGE_COLORS[stage];
            return (
              <div
                key={stage}
                className="stat-card stage-stat"
                style={{ borderTop: `3px solid ${color.accent}`, background: color.bg }}
              >
                <div className="muted" style={{ color: color.accent }}>
                  {STAGE_LABELS[stage]}
                </div>
                <strong style={{ color: color.accent }}>{row?.count || 0}</strong>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {formatMoney(row?.amount || 0)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {stats?.needsWork?.length > 0 && (
        <section className="panel needs-work-panel">
          <h2>Нужно проработать</h2>
          <p className="muted">Сделки, которые зависли на этапе или с просроченным контактом</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сделка</th>
                  <th>Этап</th>
                  <th>Дней</th>
                  <th>Причина</th>
                  <th>Сумма</th>
                  <th>Сменить статус</th>
                </tr>
              </thead>
              <tbody>
                {stats.needsWork.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/deals/${d.id}`}>{d.title}</Link>
                      <div className="muted">{d.client?.name}</div>
                    </td>
                    <td>
                      <span
                        className="stage-pill"
                        style={{
                          background: STAGE_COLORS[d.stage]?.bg,
                          color: STAGE_COLORS[d.stage]?.accent,
                          borderColor: STAGE_COLORS[d.stage]?.border,
                        }}
                      >
                        {STAGE_LABELS[d.stage]}
                      </span>
                    </td>
                    <td>{d.daysInStage}</td>
                    <td>{d.reason}</td>
                    <td>{formatMoney(d.amount)}</td>
                    <td>
                      {canWrite ? (
                        <select
                          value={d.stage}
                          onChange={(e) => onSelectStage(d, e.target.value)}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.snapshotSavedAt && (
            <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
              Статистика сохранена: {new Date(stats.snapshotSavedAt).toLocaleString('ru-RU')}
            </p>
          )}
        </section>
      )}

      <div className="filters">
        <input
          placeholder="Поиск по названию, клиенту, телефону"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isSupervisor && (
          <select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">Все менеджеры</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={load}>
          Применить
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="muted">Загрузка...</div>
      ) : (
        <div className="pipeline">
          {STAGES.map((stage) => {
            const color = STAGE_COLORS[stage];
            return (
              <div
                key={stage}
                className={`pipeline-col ${dragId ? 'droppable' : ''}`}
                style={{
                  background: color.bg,
                  borderColor: color.border,
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(stage)}
              >
                <div
                  className="pipeline-col-header"
                  style={{ borderColor: color.border, color: color.accent }}
                >
                  <strong>{STAGE_LABELS[stage]}</strong>
                  <span className="count" style={{ color: color.accent }}>
                    {byStage[stage].length}
                  </span>
                </div>
                <div className="pipeline-cards">
                  {byStage[stage].length === 0 && (
                    <EmptyState title="Пусто" text="Выберите статус на карточке или перетащите" />
                  )}
                  {byStage[stage].map((deal) => (
                    <div
                      key={deal.id}
                      className={`deal-card ${(deal.daysInStage || 0) >= NEEDS_WORK_DAYS ? 'deal-needs-work' : ''}`}
                      draggable={canWrite}
                      onDragStart={() => setDragId(deal.id)}
                      onDragEnd={() => setDragId(null)}
                      style={{ borderTop: `3px solid ${color.accent}` }}
                    >
                      <Link to={`/deals/${deal.id}`} className="deal-title">
                        {deal.title}
                      </Link>
                      <div className="muted">{deal.client?.name}</div>
                      <div className="deal-meta">
                        <span>{formatMoney(deal.amount)}</span>
                        <span
                          className={(deal.daysInStage || 0) >= NEEDS_WORK_DAYS ? 'text-warn' : ''}
                        >
                          {deal.daysInStage || 0} дн.
                        </span>
                      </div>
                      <div className="muted">{deal.responsible?.name}</div>
                      {canWrite && (
                        <select
                          className="stage-select"
                          value={deal.stage}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onSelectStage(deal, e.target.value)}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lostModal && (
        <div className="modal-backdrop">
          <div className="modal panel stack">
            <h2>Причина отказа</h2>
            <select value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
              <option value="">Выберите</option>
              {LOST_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="row-actions">
              <button className="btn" onClick={() => setLostModal(null)}>
                Отмена
              </button>
              <button
                className="btn primary"
                disabled={!lostReason}
                onClick={async () => {
                  await moveStage(lostModal.dealId, 'LOST', lostReason);
                  setLostModal(null);
                  setLostReason('');
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
