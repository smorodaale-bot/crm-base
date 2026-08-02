import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate } from '../constants.js';

export default function QcReportPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/qc/report')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Загрузка отчёта...</div>;

  const { summary, byManager, frequentErrors, dynamics, critical } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/qc" className="muted">
            ← Контроль качества
          </Link>
          <h1>Отчёт руководителя</h1>
          <p className="muted">
            Период: {formatDate(data.period.from)} — {formatDate(data.period.to)}
          </p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="muted">Проверок</div>
          <strong>{summary.checks}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Средняя оценка</div>
          <strong>{summary.avgScore}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Менеджеров</div>
          <strong>{summary.managers}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Критических</div>
          <strong>{summary.criticalCount}</strong>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Средняя оценка по менеджерам</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th>Проверок</th>
                  <th>Средняя</th>
                  <th>Критических</th>
                </tr>
              </thead>
              <tbody>
                {byManager.map((m) => (
                  <tr key={m.managerId}>
                    <td>{m.managerName}</td>
                    <td>{m.count}</td>
                    <td>{m.avgScore}</td>
                    <td>{m.criticalCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>Частые ошибки</h2>
          {!frequentErrors.length ? (
            <p className="muted">Нет данных</p>
          ) : (
            <ul>
              {frequentErrors.map((e) => (
                <li key={e.key}>
                  {e.label} — <strong>{e.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <h2>Динамика качества</h2>
        {!dynamics.length ? (
          <p className="muted">Нет данных</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Проверок</th>
                  <th>Средняя оценка</th>
                  <th>Тренд</th>
                </tr>
              </thead>
              <tbody>
                {dynamics.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.count}</td>
                    <td>{d.avgScore}</td>
                    <td>
                      <div
                        className="trend-bar"
                        style={{ width: `${Math.max(8, d.avgScore)}%` }}
                        title={`${d.avgScore}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <h2>Критические нарушения</h2>
        {!critical.length ? (
          <p className="muted">Критических разговоров нет</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Разговор</th>
                  <th>Менеджер</th>
                  <th>Оценка</th>
                </tr>
              </thead>
              <tbody>
                {critical.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.createdAt)}</td>
                    <td>
                      <Link to={`/qc/${c.id}`}>{c.title}</Link>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {c.summary}
                      </div>
                    </td>
                    <td>{c.managerName}</td>
                    <td>
                      <span className="score-badge score-bad">{c.overallScore}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
