import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { STAGE_LABELS, STAGES, formatDate, formatDurationMinutes, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { Skeleton } from '../components/Skeleton.jsx';

const STOCK_STATUS = {
  IN_STOCK: 'В наличии',
  RESERVED: 'Бронь',
  IN_TRANSIT: 'В пути',
  SOLD: 'Продано',
};

export default function DashboardPage() {
  const { isSupervisor } = useAuth();
  const [data, setData] = useState(null);
  const [money, setMoney] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isSupervisor) return;
    api('/dashboard/money')
      .then(setMoney)
      .catch(() => setMoney(null));
  }, [isSupervisor]);

  const stageBars = useMemo(() => {
    if (!data?.byStage) return [];
    const rows = STAGES.map((s) => ({
      stage: s,
      label: STAGE_LABELS[s],
      count: data.byStage[s]?.count || 0,
      amount: data.byStage[s]?.amount || 0,
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }));
  }, [data]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Skeleton variant="metrics" />;

  const { summary, bySource, byManager, lostReasons, sla } = data;
  const conversion = summary.conversion;
  const conversionText = summary.conversionLabel || (conversion != null ? `${conversion}%` : 'мало данных');
  const managers = [...(byManager || [])].sort((a, b) => (b.open || 0) - (a.open || 0));

  return (
    <div className="zeno-dash">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>{isSupervisor ? 'Пульт директора' : 'Дашборд'}</h1>
          <p className="muted">
            {isSupervisor
              ? 'Маржа, зависший сток, кто не берёт лиды, воронка и визиты'
              : 'Ваша воронка и сделки, которые нужно проработать'}
          </p>
        </div>
        <div className="row gap">
          <Link className="btn" to="/inbox">
            Рабочий стол
          </Link>
          <Link className="btn" to="/visits">
            Визиты
          </Link>
          {isSupervisor && (
            <Link className="btn" to="/analytics">
              Аналитика
            </Link>
          )}
        </div>
      </div>

      {isSupervisor && money?.summary && (
        <section className="panel stack">
          <div className="panel-head">
            <div>
              <h2>Деньги и контроль</h2>
              <p className="muted">
                Маржа — цена минус закуп и предпродажка. Сток старше {money.agingDays} дней. Лиды без
                ответа и просроченный SLA.
              </p>
            </div>
            <Link className="chip" to="/vehicles">
              Склад
            </Link>
          </div>
          <div className="stats-grid dash-ops-stats">
            <div className="stat-card">
              <div className="muted">Маржа склада</div>
              <strong>
                {money.stockEnabled && money.summary.stockMargin != null
                  ? formatMoney(money.summary.stockMargin)
                  : '—'}
              </strong>
              <div className="muted">
                {money.stockEnabled
                  ? `Продано: ${
                      money.summary.soldMargin != null ? formatMoney(money.summary.soldMargin) : '—'
                    }`
                  : 'Доступно на тарифе Продвинутый'}
              </div>
            </div>
            <Link className="stat-card" to="/vehicles">
              <div className="muted">Сток &gt; {money.agingDays} дн.</div>
              <strong className={money.summary.agingCount ? 'text-warn' : ''}>
                {money.stockEnabled ? money.summary.agingCount : '—'}
              </strong>
              <div className="muted">
                {money.stockEnabled
                  ? `${money.summary.agingSharePct}% из ${money.summary.stockCount}`
                  : 'Доступно на тарифе Продвинутый'}
              </div>
            </Link>
            <Link className="stat-card" to="/inbox">
              <div className="muted">Сливают лиды</div>
              <strong className={money.summary.leakManagers ? 'text-warn' : ''}>
                {money.summary.leakManagers}
              </strong>
              <div className="muted">
                Без ответа: {money.summary.unanswered} · SLA: {money.summary.slaBreaches}
              </div>
            </Link>
          </div>
          {money.stockEnabled && money.summary.stockMarginMissing > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              У {money.summary.stockMarginMissing} авто нет себестоимости — маржа склада неполная.
            </p>
          )}

          {money.stockEnabled && (
            <div>
              <h3>Зависший сток</h3>
              {money.aging.length === 0 ? (
                <p className="muted">Нет машин старше {money.agingDays} дней.</p>
              ) : (
                <div className="table-wrap">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Авто</th>
                        <th>Дней</th>
                        <th>Статус</th>
                        <th>Цена</th>
                        <th>Маржа</th>
                      </tr>
                    </thead>
                    <tbody>
                      {money.aging.map((v) => (
                        <tr key={v.id}>
                          <td>
                            <Link to={`/vehicles/${v.id}`}>{v.title || v.vin || `#${v.id}`}</Link>
                          </td>
                          <td>{v.daysInStock}</td>
                          <td>{STOCK_STATUS[v.status] || v.status}</td>
                          <td>{formatMoney(v.price)}</td>
                          <td>{v.margin != null ? formatMoney(v.margin) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div>
            <h3>Кто не берёт лиды</h3>
            {money.leakers.length === 0 ? (
              <p className="muted">Открытых лидов без ответа и просрочек SLA нет.</p>
            ) : (
              <div className="table-wrap">
                <table className="product-table">
                  <thead>
                    <tr>
                      <th>Менеджер</th>
                      <th>Без ответа</th>
                      <th>SLA</th>
                      <th>Открыто</th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.leakers.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.unanswered}</td>
                        <td>{m.slaBreaches}</td>
                        <td>{m.open}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="kpi-strip panel">
        <div className="kpi-item">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            ₽
          </div>
          <div>
            <div className="kpi-label">В воронке</div>
            <div className="kpi-value">{formatMoney(summary.openAmount)}</div>
            <div className="kpi-trend up">Сделок: {summary.totalDeals}</div>
          </div>
        </div>
        <div className="kpi-divider" />
        <div className="kpi-item">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            %
          </div>
          <div>
            <div className="kpi-label">Конверсия</div>
            <div className="kpi-value">{conversionText}</div>
            <div className={`kpi-trend ${summary.overdueContacts ? 'down' : 'up'}`}>
              Просрочен контакт: {summary.overdueContacts}
            </div>
          </div>
        </div>
        <div className="kpi-divider" />
        <div className="kpi-item">
          <div className="kpi-icon kpi-icon-pink" aria-hidden="true">
            ✓
          </div>
          <div>
            <div className="kpi-label">Выиграно / отказ</div>
            <div className="kpi-value">
              {summary.won} / {summary.lost}
            </div>
            <div className="kpi-trend up">Визиты сегодня: {summary.visitsToday ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="stats-grid dash-ops-stats">
        <Link className="stat-card" to="/inbox">
          <div className="muted">Просрочен контакт</div>
          <strong className={summary.overdueContacts ? 'text-warn' : ''}>
            {summary.overdueContacts}
          </strong>
        </Link>
        <Link className="stat-card" to="/tasks?overdue=1">
          <div className="muted">Просроченные задачи</div>
          <strong className={summary.overdueTasks ? 'text-warn' : ''}>
            {summary.overdueTasks ?? 0}
          </strong>
        </Link>
        <Link className="stat-card" to="/inbox">
          <div className="muted">SLA без ответа</div>
          <strong className={summary.slaBreaches ? 'text-warn' : ''}>
            {summary.slaBreaches ?? 0}
          </strong>
        </Link>
        <Link className="stat-card" to="/visits">
          <div className="muted">Визиты сегодня</div>
          <strong>{summary.visitsToday ?? 0}</strong>
        </Link>
        <div className="stat-card">
          <div className="muted">Ответ, мин</div>
          <strong>
            {summary.avgResponseMinutes != null
              ? formatDurationMinutes(summary.avgResponseMinutes)
              : '—'}
          </strong>
        </div>
        <div className="stat-card">
          <div className="muted">Сделки с авто</div>
          <strong>{summary.withVehiclePct ?? 0}%</strong>
        </div>
      </div>

      <div className="dash-mid">
        <section className="panel overview-panel">
          <div className="panel-head">
            <div>
              <h2>Воронка</h2>
              <p className="muted">Сделки по этапам</p>
            </div>
            <Link className="chip" to="/deals">
              Сделки
            </Link>
          </div>
          <div className="bar-chart" role="img" aria-label="График по этапам">
            {stageBars.map((bar) => (
              <div key={bar.stage} className="bar-col">
                <div
                  className={`bar-fill ${bar.stage === 'NEGOTIATION' || bar.stage === 'PROPOSAL' ? 'bar-fill-accent' : ''}`}
                  style={{ height: `${Math.max(8, bar.pct)}%` }}
                  title={`${bar.label}: ${bar.count}`}
                />
                <span className="bar-label">{bar.label.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel customers-panel">
          <div className="panel-head">
            <div>
              <h2>Закрытие</h2>
              <p className="muted">
                {summary.conversionFormula || 'Конверсия закрытых сделок'}
              </p>
            </div>
          </div>
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#111111 0 ${conversion ?? 0}%, #f0f0f0 ${conversion ?? 0}% 100%)`,
              }}
            >
              <div className="donut-hole">
                <strong>{conversionText}</strong>
                <span>успешных</span>
              </div>
            </div>
          </div>
          {(lostReasons || []).length > 0 && (
            <div className="mini-stats" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="muted">Топ причин отказа</div>
              {lostReasons.slice(0, 4).map((r) => (
                <div key={r.reason} className="row gap" style={{ justifyContent: 'space-between' }}>
                  <span>{r.reason}</span>
                  <strong>{r.count}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {isSupervisor && managers.length > 0 && (
        <section className="panel product-panel">
          <div className="panel-head">
            <div>
              <h2>Менеджеры</h2>
              <p className="muted">Нагрузка и открытые сделки</p>
            </div>
            <Link className="chip" to="/analytics">
              Подробнее
            </Link>
          </div>
          <div className="table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th>Сделок</th>
                  <th>Открыто</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.count}</td>
                    <td>{m.open ?? 0}</td>
                    <td>{formatMoney(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel product-panel">
        <div className="panel-head">
          <div>
            <h2>Нужно проработать</h2>
            <p className="muted">SLA: сделки без движения ≥ 3 дней</p>
          </div>
          <Link className="chip" to="/reminders">
            Напоминания
          </Link>
        </div>
        {sla.length === 0 ? (
          <EmptyState title="Всё в порядке" text="Нет зависших сделок" />
        ) : (
          <div className="table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Сделка</th>
                  <th>Этап</th>
                  <th>Дней</th>
                  <th>Менеджер</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {sla.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/deals/${d.id}`}>{d.title}</Link>
                    </td>
                    <td>{STAGE_LABELS[d.stage]}</td>
                    <td>{d.daysInStage}</td>
                    <td>{d.responsible}</td>
                    <td>{formatMoney(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Источники</h2>
        </div>
        <div className="source-pills">
          {(bySource || []).slice(0, 8).map((s) => (
            <div key={s.source} className="source-pill">
              <span>{s.source}</span>
              <strong>{s.count}</strong>
            </div>
          ))}
        </div>
        <p className="muted">Обновлено: {formatDate(new Date().toISOString())}</p>
      </section>
    </div>
  );
}
