import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { AppLoader } from '../components/AppLoader.jsx';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate, formatDurationMinutes, formatOverdue, LEAD_TYPE_LABELS, leadChannelLabel } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

function ageLabel(createdAt) {
  if (!createdAt) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  return formatDurationMinutes(mins);
}

function deadlineLabel(nextContactAt) {
  return formatOverdue(nextContactAt);
}

function isOverdue(nextContactAt) {
  return nextContactAt && new Date(nextContactAt) < new Date();
}

export default function InboxPage() {
  const { isSupervisor, canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState(null);

  const load = useCallback(() => {
    setError('');
    return api('/inbox')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function claimLead(dealId) {
    if (!canWrite) return;
    setClaimingId(dealId);
    try {
      const res = await api(`/leads/${dealId}/claim`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success(res.message || 'Лид взят в работу');
      await load();
      navigate(`/deals/${dealId}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClaimingId(null);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data) return <AppLoader />;

  const { counts, newLeads, overdueContact, slaBreached, visitsToday, slaMinutes } = data;

  const channelCounts = newLeads.reduce((acc, d) => {
    const ch = leadChannelLabel(d) || 'Прочее';
    acc[ch] = (acc[ch] || 0) + 1;
    return acc;
  }, {});

  const channelHint = Object.entries(channelCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

  return (
    <div className="inbox-page">
      <div className="page-header">
        <div>
          <h1>Рабочий стол</h1>
          <p className="muted">
            Сначала новые лиды
            {slaMinutes ? ` · ответ за ${slaMinutes} мин` : ''}
          </p>
        </div>
        <div className="row gap">
          <Link className="btn" to="/visits">
            Визиты
          </Link>
          <Link className="btn" to="/tasks">
            Задачи
          </Link>
        </div>
      </div>

      <div className="inbox-kpis">
        <div className={`inbox-kpi ${counts.newLeads ? 'is-hot' : ''}`}>
          <span className="inbox-kpi-value">{counts.newLeads}</span>
          <span className="inbox-kpi-label">Новые</span>
          {channelHint ? <span className="inbox-kpi-meta">{channelHint}</span> : null}
        </div>
        <div className={`inbox-kpi ${counts.slaBreached ? 'is-warn' : ''}`}>
          <span className="inbox-kpi-value">{counts.slaBreached}</span>
          <span className="inbox-kpi-label">Без ответа</span>
        </div>
        <div className={`inbox-kpi ${counts.overdueContact ? 'is-warn' : ''}`}>
          <span className="inbox-kpi-value">{counts.overdueContact}</span>
          <span className="inbox-kpi-label">Просрочен контакт</span>
        </div>
        <div className="inbox-kpi">
          <span className="inbox-kpi-value">{counts.visitsToday}</span>
          <span className="inbox-kpi-label">Визиты сегодня</span>
        </div>
        <div className="inbox-kpi">
          <span className="inbox-kpi-value">{counts.openTasks}</span>
          <span className="inbox-kpi-label">Задачи</span>
        </div>
      </div>

      <section className="panel inbox-section">
        <div className="inbox-section-head">
          <h2>Новые лиды</h2>
          <span className="muted">{newLeads.length || 0}</span>
        </div>
        {!newLeads.length ? (
          <div className="inbox-empty-wrap">
            <EmptyState title="Нет новых лидов" text="Когда придёт заявка — она появится здесь" />
            {isSupervisor && (
              <p className="muted" style={{ marginTop: 12 }}>
                Ещё нет входящих?{' '}
                <Link to="/org/channels#channel-telegram">Подключите Telegram, MAX или сайт</Link>
              </p>
            )}
          </div>
        ) : (
          <div className="inbox-lead-list">
            {newLeads.map((d) => {
              const overdue = isOverdue(d.nextContactAt);
              return (
                <article key={d.id} className={`inbox-lead-card ${overdue ? 'is-overdue' : ''}`}>
                  <div className="inbox-lead-main">
                    <div className="inbox-lead-title-row">
                      <Link className="inbox-lead-name" to={`/deals/${d.id}`}>
                        {d.client?.name || d.title}
                      </Link>
                      {leadChannelLabel(d) ? (
                        <span className="badge channel">{leadChannelLabel(d)}</span>
                      ) : null}
                    </div>
                    <div className="inbox-lead-meta">
                      <span>{d.client?.phone || '—'}</span>
                      <span>{LEAD_TYPE_LABELS[d.leadType] || d.leadType}</span>
                      {isSupervisor ? <span>{d.responsible?.name || 'без менеджера'}</span> : null}
                      <span>{ageLabel(d.createdAt)}</span>
                      <span className={overdue ? 'inbox-sla-bad' : ''}>
                        {deadlineLabel(d.nextContactAt) || 'SLA —'}
                      </span>
                    </div>
                  </div>
                  <div className="inbox-lead-actions">
                    {canWrite ? (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={claimingId === d.id}
                        onClick={() => claimLead(d.id)}
                      >
                        {claimingId === d.id ? '…' : 'Взять в работу'}
                      </button>
                    ) : (
                      <Link className="btn" to={`/deals/${d.id}`}>
                        Открыть
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="inbox-secondary">
        <section className="panel inbox-section">
          <div className="inbox-section-head">
            <h2>Без ответа (SLA)</h2>
            <span className="muted">{slaBreached.length || 0}</span>
          </div>
          {!slaBreached.length ? (
            <p className="muted inbox-empty-line">Нарушений нет</p>
          ) : (
            <ul className="inbox-simple-list">
              {slaBreached.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <div>
                    <Link to={`/deals/${d.id}`}>{d.client?.name || d.title}</Link>
                    <div className="muted">
                      {ageLabel(d.createdAt)}
                      {isSupervisor && d.responsible?.name ? ` · ${d.responsible.name}` : ''}
                    </div>
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      className="btn btn-sm primary"
                      disabled={claimingId === d.id}
                      onClick={() => claimLead(d.id)}
                    >
                      Взять
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel inbox-section">
          <div className="inbox-section-head">
            <h2>Просрочен контакт</h2>
            <span className="muted">{overdueContact.length || 0}</span>
          </div>
          {!overdueContact.length ? (
            <p className="muted inbox-empty-line">Всё вовремя</p>
          ) : (
            <ul className="inbox-simple-list">
              {overdueContact.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <div>
                    <Link to={`/deals/${d.id}`}>{d.client?.name || d.title}</Link>
                    <div className="muted">
                      до {formatDate(d.nextContactAt)}
                      {isSupervisor && d.responsible?.name ? ` · ${d.responsible.name}` : ''}
                    </div>
                  </div>
                  <Link className="btn btn-sm" to={`/deals/${d.id}`}>
                    Открыть
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel inbox-section">
          <div className="inbox-section-head">
            <h2>Визиты сегодня</h2>
            <span className="muted">{visitsToday.length || 0}</span>
          </div>
          {!visitsToday.length ? (
            <p className="muted inbox-empty-line">Визитов нет</p>
          ) : (
            <ul className="inbox-simple-list">
              {visitsToday.map((v) => (
                <li key={v.id}>
                  <div>
                    <strong>{formatDate(v.scheduledAt)}</strong>
                    <div className="muted">
                      {v.client?.name}
                      {v.deal ? (
                        <>
                          {' · '}
                          <Link to={`/deals/${v.deal.id}`}>{v.deal.title}</Link>
                        </>
                      ) : null}
                      {isSupervisor && v.manager?.name ? ` · ${v.manager.name}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
