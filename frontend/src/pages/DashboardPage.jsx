import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { STAGE_LABELS, formatDate, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Загрузка дашборда...</div>;

  const { summary, byStage, byManager, bySource, lostReasons, sla } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <p className="muted">Воронка, конверсия, SLA и источники</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="muted">Сделок</div>
          <strong>{summary.totalDeals}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">В открытой воронке</div>
          <strong>{formatMoney(summary.openAmount)}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Конверсия</div>
          <strong>{summary.conversion}%</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Просроченные контакты</div>
          <strong>{summary.overdueContacts}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Просроченные задачи</div>
          <strong>{summary.overdueTasks}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Выиграно / отказ</div>
          <strong>
            {summary.won} / {summary.lost}
          </strong>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>По этапам</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Этап</th>
                  <th>Кол-во</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byStage).map(([stage, row]) => (
                  <tr key={stage}>
                    <td>{STAGE_LABELS[stage]}</td>
                    <td>{row.count}</td>
                    <td>{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>По менеджерам</h2>
          {byManager.length === 0 ? (
            <EmptyState title="Нет данных" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Менеджер</th>
                    <th>Сделок</th>
                    <th>Открытых</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {byManager.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.count}</td>
                      <td>{m.open}</td>
                      <td>{formatMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Источники</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Лиды</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td>{s.count}</td>
                    <td>{formatMoney(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>Причины отказа</h2>
          {lostReasons.length === 0 ? (
            <EmptyState title="Пока нет отказов" />
          ) : (
            <ul className="plain-list">
              {lostReasons.map((r) => (
                <li key={r.reason}>
                  {r.reason}: <strong>{r.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>SLA: сделки без движения ≥ 3 дней</h2>
        {sla.length === 0 ? (
          <EmptyState title="Всё в порядке" text="Нет зависших сделок" />
        ) : (
          <div className="table-wrap">
            <table>
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
        <p className="muted">Обновлено: {formatDate(new Date().toISOString())}</p>
      </section>
    </div>
  );
}
