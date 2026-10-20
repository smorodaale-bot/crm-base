import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, formatDate, formatQuota } from '../constants.js';
import OrgAdminShell from '../components/OrgAdminShell.jsx';
import { AppLoader } from '../components/AppLoader.jsx';

export default function OrgSettingsPage() {
  const { isSupervisor } = useAuth();
  const toast = useToast();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [channelHub, setChannelHub] = useState([]);
  const [stockCount, setStockCount] = useState(0);
  const [stockSync, setStockSync] = useState(null);
  const [issuedToken, setIssuedToken] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError('');
      try {
        const [orgData, membersData, channelsData, vehiclesData, stockSyncData] = await Promise.all([
          api('/org'),
          isSupervisor ? api('/org/members') : Promise.resolve({ members: [] }),
          isSupervisor ? api('/org/channels') : Promise.resolve({ channels: [] }),
          api('/vehicles?limit=1').catch(() => ({ vehicles: [] })),
          isSupervisor ? api('/org/stock-sync').catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setOrg(orgData.organization);
        setMembers(membersData.members || []);
        setChannelHub(channelsData.channels || []);
        setStockSync(stockSyncData);
        const listed = vehiclesData.vehicles || [];
        setStockCount(Number(vehiclesData.total ?? listed.length) || 0);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isSupervisor]);

  if (error) return <div className="error">{error}</div>;
  if (!org) return <AppLoader />;

  const sub = org.subscription || {};
  const usage = org.usage || {};
  const teamReady = members.length > 1;
  const channelReady = channelHub.some((c) => c.connected);
  const stockReady = stockCount > 0;
  const onboardDone = teamReady && channelReady && stockReady;

  return (
    <OrgAdminShell title="Организация" lead={`${org.name} · @${org.slug}`}>
      <section className="org-admin-summary">
        <div className="org-admin-summary-item">
          <span className="muted">Тариф</span>
          <strong>
            {PLAN_LABELS[sub.plan] || sub.plan || '—'} · {SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status || '—'}
          </strong>
          {sub.trialEndsAt ? (
            <span className="muted">пробный период до {formatDate(sub.trialEndsAt)}</span>
          ) : null}
          {sub.currentPeriodEnd ? (
            <span className="muted">до {formatDate(sub.currentPeriodEnd)}</span>
          ) : null}
        </div>
        <div className="org-admin-summary-item">
          <span className="muted">Места</span>
          <strong>
            {formatQuota(usage.seatsUsed ?? 0, usage.seatsLimit)}
          </strong>
        </div>
        <div className="org-admin-summary-item">
          <span className="muted">Каналы</span>
          <strong>
            {formatQuota(
              usage.channelsUsed ?? channelHub.filter((c) => c.connected).length,
              usage.channelsLimit
            )}
          </strong>
        </div>
      </section>

      {isSupervisor && !onboardDone && (
        <section className="org-admin-panel onboard-checklist">
          <div className="org-admin-panel-head">
            <div>
              <h2>Быстрый старт салона</h2>
              <p className="muted">Пункты отмечаются сами, когда данные уже есть в салоне</p>
            </div>
          </div>
          <ol className="onboard-steps">
            <li className={teamReady ? 'is-done' : ''}>
              <div>
                <strong>Добавьте сотрудника</strong>
                <p className="muted">
                  {teamReady ? 'В салоне больше одного человека' : 'Раздел «Сотрудники» — пригласите менеджера'}
                </p>
              </div>
              <Link className="btn" to="/org/team">
                К сотрудникам
              </Link>
            </li>
            <li className={channelReady ? 'is-done' : ''}>
              <div>
                <strong>Подключите канал заявок</strong>
                <p className="muted">
                  {channelReady ? 'Канал уже подключён' : 'Сайт, Telegram или MAX — достаточно одного'}
                </p>
              </div>
              <Link
                className="btn"
                to={`/org/channels#${channelHub.find((c) => !c.connected)?.anchor || 'channel-telegram'}`}
              >
                Настроить
              </Link>
            </li>
            <li className={stockReady ? 'is-done' : ''}>
              <div>
                <strong>Добавьте авто на склад</strong>
                <p className="muted">
                  {stockReady ? 'На складе есть автомобиль' : 'Одна машина в разделе «Склад»'}
                </p>
              </div>
              <Link className="btn" to="/vehicles">
                К складу
              </Link>
            </li>
          </ol>
        </section>
      )}

      <section className="org-admin-hub-grid">
        <Link className="org-admin-hub-card" to="/org/billing">
          <h2>Подписка</h2>
          <p>Тариф, оплата, карта и история платежей</p>
          <span className="org-admin-hub-cta">Открыть →</span>
        </Link>
        <Link className="org-admin-hub-card" to="/org/channels">
          <h2>Каналы</h2>
          <p>Сайт, Telegram, MAX, Авито и WhatsApp</p>
          <span className="org-admin-hub-cta">Открыть →</span>
        </Link>
        <Link className="org-admin-hub-card" to="/org/team">
          <h2>Сотрудники</h2>
          <p>Приглашение менеджеров и роли в салоне</p>
          <span className="org-admin-hub-cta">Открыть →</span>
        </Link>
      </section>

      {isSupervisor && stockSync ? (
        <section className="org-admin-panel">
          <h2>Синхронизация склада</h2>
          {stockSync.enabled ? (
            <>
              <p className="muted">{stockSync.hint}</p>
              <p className="muted">
                Адрес: <code>{stockSync.webhookUrl}</code>
              </p>
              <p className="muted">
                Заголовок: <code>{stockSync.headerName}</code>
              </p>
              {issuedToken ? (
                <label>
                  Токен (показывается один раз)
                  <input readOnly value={issuedToken} onFocus={(e) => e.target.select()} />
                </label>
              ) : (
                <p className="muted">
                  {stockSync.hasToken
                    ? 'Токен создан. Повторно он не показывается.'
                    : 'Токен ещё не создан.'}
                </p>
              )}
              <div className="row gap" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={async () => {
                    try {
                      const data = await api('/org/stock-sync/token', { method: 'POST', body: '{}' });
                      setIssuedToken(data.token || '');
                      setStockSync({ ...data, token: undefined });
                      toast.success(data.message || 'Токен создан');
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }}
                >
                  {stockSync.hasToken ? 'Создать новый токен' : 'Создать токен'}
                </button>
                {issuedToken ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => navigator.clipboard.writeText(issuedToken).then(() => toast.success('Токен скопирован'))}
                  >
                    Скопировать
                  </button>
                ) : null}
                {stockSync.hasToken ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      try {
                        const data = await api('/org/stock-sync/revoke', { method: 'POST', body: '{}' });
                        setIssuedToken('');
                        setStockSync(data);
                        toast.success(data.message || 'Токен отозван');
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }}
                  >
                    Отозвать
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted">
              {stockSync.hint}{' '}
              <Link to="/org/billing">Повысить тариф</Link>
            </p>
          )}
        </section>
      ) : null}
    </OrgAdminShell>
  );
}
