import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { STAGE_LABELS, formatDate, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

export default function RemindersPage() {
  const [data, setData] = useState({ overdue: [], today: [], counts: {} });
  const [error, setError] = useState('');

  useEffect(() => {
    api('/deals/reminders')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  function Section({ title, items, tone }) {
    return (
      <section className="panel">
        <h2>
          {title} <span className={`badge ${tone}`}>{items.length}</span>
        </h2>
        {items.length === 0 ? (
          <EmptyState title="Нет сделок" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сделка</th>
                  <th>Клиент</th>
                  <th>Этап</th>
                  <th>Контакт</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/deals/${d.id}`}>{d.title}</Link>
                    </td>
                    <td>{d.client?.name}</td>
                    <td>{STAGE_LABELS[d.stage]}</td>
                    <td>{formatDate(d.nextContactAt)}</td>
                    <td>{formatMoney(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Напоминания о контактах</h1>
          <p className="muted">Просроченные и запланированные на сегодня</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="stack">
        <Section title="Просрочено" items={data.overdue} tone="danger" />
        <Section title="На сегодня" items={data.today} tone="" />
      </div>
    </div>
  );
}
