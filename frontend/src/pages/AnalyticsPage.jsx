import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { STAGE_LABELS, formatDurationMinutes, formatMoney } from '../constants.js';
import { Skeleton } from '../components/Skeleton.jsx';
import { useHeavyLoad } from '../context/LoadingContext.jsx';

function criticalWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'критичная';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 > 20)) return 'критичные';
  return 'критичных';
}

function formatQcCell(avg, critical) {
  const score = avg == null ? 'нет оценки' : String(avg);
  if (!critical) return score;
  return `${score} · ${critical} ${criticalWord(critical)}`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [money, setMoney] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/analytics')
      .then(setData)
      .catch((err) => setError(err.message));
    api('/dashboard/money')
      .then(setMoney)
      .catch(() => setMoney(null));
  }, []);

  useHeavyLoad(!data && !error);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <Skeleton variant="metrics" />;

  const { summary, byStage, managers } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Аналитика руководителя</h1>
          <p className="muted">Маржа и сток, кто сливает лиды, конверсия, SLA, визиты, контроль качества</p>
        </div>
      </div>

      {money?.summary && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="muted">Маржа склада</div>
            <strong>
              {money.stockEnabled && money.summary.stockMargin != null
                ? formatMoney(money.summary.stockMargin)
                : '—'}
            </strong>
          </div>
          <Link className="stat-card" to="/vehicles">
            <div className="muted">Сток &gt; {money.agingDays} дн.</div>
            <strong className={money.summary.agingCount ? 'text-warn' : ''}>
              {money.stockEnabled ? money.summary.agingCount : '—'}
            </strong>
          </Link>
          <Link className="stat-card" to="/dashboard">
            <div className="muted">Сливают лиды</div>
            <strong className={money.summary.leakManagers ? 'text-warn' : ''}>
              {money.summary.leakManagers}
            </strong>
          </Link>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="muted">Сделок</div>
          <strong>{summary.totalDeals}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">С авто (VIN)</div>
          <strong>{summary.withVehiclePct}%</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Ср. ответ, мин</div>
          <strong>{summary.avgResponseMinutes ?? '—'}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Нарушения SLA</div>
          <strong>{summary.slaBreaches}</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Неявки на визит</div>
          <strong>{summary.noShowPct}%</strong>
        </div>
        <div className="stat-card">
          <div className="muted">Нужно проработать</div>
          <strong>{summary.needsWork}</strong>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Этапы воронки</h2>
          <ul className="list">
            {Object.entries(byStage).map(([stage, count]) => (
              <li key={stage}>
                {STAGE_LABELS[stage] || stage}: <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>По менеджерам</h2>
          <p className="muted">
            Конверсия = выигранные / (выигранные + проигранные + открытые старше 14 дней). Если сделок меньше 5 — «мало данных».
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th>Конв.</th>
                  <th>Ответ</th>
                  <th>Авто%</th>
                  <th>КК</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.conversionLabel || (m.conversion != null ? `${m.conversion}%` : 'мало данных')}</td>
                    <td>
                      {m.avgResponseMinutes != null ? formatDurationMinutes(m.avgResponseMinutes) : '—'}
                    </td>
                    <td>{m.withVehiclePct}%</td>
                    <td>{formatQcCell(m.qcAvg, m.qcCritical)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
