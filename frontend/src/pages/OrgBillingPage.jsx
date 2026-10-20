import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import {
  PAYMENT_STATUS_LABELS,
  PLAN_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatDate,
  formatDay,
  formatMoney,
  formatQuota,
} from '../constants.js';
import OrgAdminShell from '../components/OrgAdminShell.jsx';
import { AppLoader } from '../components/AppLoader.jsx';

function visiblePayments(payments, showAll) {
  const paid = payments.filter((p) => p.status === 'SUCCEEDED');
  const pending = payments.filter((p) => p.status === 'PENDING');
  const latestPending = pending[0] ? [pending[0]] : [];
  const compact = [...paid, ...latestPending];
  const seen = new Set();
  const unique = compact.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return showAll ? payments : unique;
}

function PaymentHistory({ payments, showAll, onToggle }) {
  const rows = visiblePayments(payments, showAll);
  const hidden = payments.length - visiblePayments(payments, false).length;
  return (
    <section className="org-admin-panel">
      <h2>История платежей</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тариф</th>
              <th>Сумма</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.createdAt)}</td>
                <td>{PLAN_LABELS[p.plan] || p.plan}</td>
                <td>{formatMoney(p.amountRub)}</td>
                <td>{PAYMENT_STATUS_LABELS[p.status] || p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" className="btn" style={{ marginTop: '0.75rem' }} onClick={onToggle}>
          {showAll ? 'Скрыть лишние' : `Показать все (${payments.length})`}
        </button>
      )}
    </section>
  );
}

export default function OrgBillingPage() {
  const { user, isSupervisor, setUser } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [org, setOrg] = useState(null);
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [acceptOffer, setAcceptOffer] = useState(false);
  const [autoRenewOptIn, setAutoRenewOptIn] = useState(false);
  const [trialNote, setTrialNote] = useState('14 дней бесплатно на любом тарифе');
  const [paying, setPaying] = useState(false);
  const [interval, setInterval] = useState('month');
  const [catalogPromo, setCatalogPromo] = useState(null);
  const [paymentBanner, setPaymentBanner] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);

  function applyOrg(organization) {
    if (!organization) return;
    setOrg(organization);
    if (setUser && user) {
      setUser({
        ...user,
        plan: organization?.subscription?.plan,
        subscriptionStatus: organization?.subscription?.status,
      });
    }
  }

  async function load() {
    setError('');
    try {
      const [orgData, plansData, paymentsData] = await Promise.all([
        api('/org'),
        api('/org/plans'),
        isSupervisor ? api('/org/subscription/payments') : Promise.resolve({ payments: [] }),
      ]);
      applyOrg(orgData.organization);
      setPlans(plansData.plans || []);
      if (plansData.trialNote) setTrialNote(plansData.trialNote);
      setCatalogPromo(plansData.promo || null);
      setPayments(paymentsData.payments || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [isSupervisor]);

  useEffect(() => {
    if (org?.subscription?.hasPaymentMethod) {
      setAutoRenewOptIn(Boolean(org.subscription.autoRenew));
    }
  }, [org?.subscription?.hasPaymentMethod, org?.subscription?.autoRenew]);

  useEffect(() => {
    const payment = searchParams.get('payment');
    const paymentId = searchParams.get('paymentId');
    if (!payment) return;

    async function handleReturn() {
      if (payment === 'demo' && paymentId && isSupervisor) {
        if (import.meta.env.PROD) {
          setPaymentBanner({
            tone: 'error',
            title: 'Демо-оплата отключена',
            text: 'Тариф включается только после оплаты через ЮKassa.',
          });
          return;
        }
        try {
          const data = await api('/org/subscription/demo-complete', {
            method: 'POST',
            body: JSON.stringify({ paymentId: Number(paymentId) }),
          });
          applyOrg(data.organization);
          setPaymentBanner({
            tone: 'success',
            title: 'Оплата подтверждена',
            text: data.message || 'Подписка активирована',
          });
          toast.success(data.message || 'Оплата подтверждена');
          await load();
        } catch (err) {
          toast.error(err.message);
        }
      } else if (payment === 'cancel') {
        setPaymentBanner({
          tone: 'error',
          title: 'Оплата не завершена',
          text: 'Платёж отменён или не был подтверждён. Можно выбрать тариф и оплатить снова.',
        });
        toast.error('Оплата не завершена');
        await load();
      } else if (payment === 'success' && isSupervisor) {
        setConfirming(true);
        setPaymentBanner({
          tone: 'info',
          title: 'Проверяем оплату…',
          text: 'Сверяем статус платежа с ЮKassa',
        });
        try {
          let data = null;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            data = await api('/org/subscription/confirm-payment', {
              method: 'POST',
              body: JSON.stringify({
                paymentId: paymentId ? Number(paymentId) : undefined,
              }),
            });
            if (data.status === 'SUCCEEDED' || data.status === 'CANCELED') break;
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (data?.organization) applyOrg(data.organization);
          if (data?.status === 'SUCCEEDED') {
            setPaymentBanner({
              tone: 'success',
              title: 'Оплата прошла успешно',
              text: data.message,
            });
            toast.success(data.message);
          } else if (data?.status === 'CANCELED') {
            setPaymentBanner({
              tone: 'error',
              title: 'Платёж отменён',
              text: data.message,
            });
            toast.error(data.message);
          } else {
            setPaymentBanner({
              tone: 'info',
              title: 'Оплата ещё обрабатывается',
              text:
                data?.message ||
                'Статус обновится автоматически. Можно обновить страницу через минуту.',
            });
            toast.success(data?.message || 'Ожидаем подтверждение оплаты');
          }
          await load();
        } catch (err) {
          setPaymentBanner({
            tone: 'error',
            title: 'Не удалось проверить оплату',
            text: err.message,
          });
          toast.error(err.message);
        } finally {
          setConfirming(false);
        }
      }
      setSearchParams({}, { replace: true });
    }

    handleReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function offerAccepted() {
    const box = document.getElementById('billing-offer-accept');
    return box ? box.checked : acceptOffer;
  }

  async function checkout(plan) {
    if (!offerAccepted()) {
      toast.error('Нужно согласие с офертой');
      return;
    }
    setPaying(true);
    try {
      const savePaymentMethod = document.getElementById('billing-autorenew')?.checked === true;
      const data = await api('/org/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan: plan || org?.subscription?.plan,
          savePaymentMethod,
          interval,
        }),
      });
      if (data.confirmationUrl) {
        window.location.assign(data.confirmationUrl);
        return;
      }
      toast.error('Не получена ссылка на оплату');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPaying(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!org) return <AppLoader />;

  const sub = org.subscription || {};
  const usage = org.usage || {};

  return (
    <OrgAdminShell
      title="Подписка"
      lead={`${org.name} · тариф и оплата`}
    >
      <section className="org-admin-panel">
        <div className="org-admin-panel-head">
          <div>
            <h2>Текущий статус</h2>
            <p className="muted">
              {sub.status === 'TRIAL' && sub.trialEndsAt
                ? `${PLAN_LABELS[sub.plan] || sub.plan} · пробный период до ${formatDay(sub.trialEndsAt)}`
                : sub.status === 'ACTIVE' && sub.currentPeriodEnd
                  ? `${PLAN_LABELS[sub.plan] || sub.plan} · до ${formatDay(sub.currentPeriodEnd)}`
                  : `${PLAN_LABELS[sub.plan] || sub.plan} · ${SUBSCRIPTION_STATUS_LABELS[sub.status] || sub.status}`}
            </p>
            <p className="muted">
              Сотрудники: {formatQuota(usage.seatsUsed ?? 0, usage.seatsLimit)}
              {' · '}
              Каналы: {formatQuota(usage.channelsUsed ?? 0, usage.channelsLimit)}
            </p>
          </div>
        </div>

        {isSupervisor && (
          <div className="org-admin-stack">
            <label className="org-admin-check" htmlFor="billing-autorenew">
              <input
                id="billing-autorenew"
                type="checkbox"
                checked={autoRenewOptIn}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setAutoRenewOptIn(enabled);
                  if (!sub.hasPaymentMethod) return;
                  try {
                    const data = await api('/org/subscription/auto-renew', {
                      method: 'POST',
                      body: JSON.stringify({ enabled }),
                    });
                    applyOrg(data.organization);
                    toast.success(data.message || 'Сохранено');
                  } catch (err) {
                    setAutoRenewOptIn(!enabled);
                    toast.error(err.message);
                  }
                }}
              />
              <span>
                Автопродление
                <span className="muted">
                  {' '}
                  — согласен на регулярные списания стоимости тарифа
                  {sub.paymentMethodTitle ? ` · ${sub.paymentMethodTitle}` : ''}
                </span>
              </span>
            </label>

            <div className="org-admin-card-row">
              <div>
                <div className="org-admin-card-title">Сохранённая карта</div>
                <div className="muted">
                  {sub.hasPaymentMethod
                    ? `${sub.paymentMethodTitle || 'Банковская карта'} — можно отвязать самостоятельно`
                    : 'Карта сохраняется только если перед оплатой включено автопродление.'}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                disabled={!sub.hasPaymentMethod}
                title={
                  sub.hasPaymentMethod
                    ? 'Отвязать карту'
                    : 'Станет активной после сохранения карты'
                }
                onClick={async () => {
                  if (!sub.hasPaymentMethod) return;
                  if (!window.confirm('Отвязать карту и выключить автопродление?')) return;
                  try {
                    const data = await api('/org/subscription/unlink-payment-method', {
                      method: 'POST',
                      body: JSON.stringify({}),
                    });
                    applyOrg(data.organization);
                    toast.success(data.message || 'Карта отвязана');
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
              >
                Отвязать карту
              </button>
            </div>
          </div>
        )}

        {paymentBanner && (
          <div
            className={
              paymentBanner.tone === 'success'
                ? 'success'
                : paymentBanner.tone === 'error'
                  ? 'error'
                  : 'sub-banner'
            }
            style={{ marginTop: '1rem' }}
          >
            <strong>{confirming ? 'Проверяем оплату…' : paymentBanner.title}</strong>
            {paymentBanner.text ? <div style={{ marginTop: 4 }}>{paymentBanner.text}</div> : null}
            {sub.status === 'ACTIVE' && sub.currentPeriodEnd ? (
              <div style={{ marginTop: 4 }}>
                Активный тариф: <strong>{PLAN_LABELS[sub.plan] || sub.plan}</strong> до {formatDate(sub.currentPeriodEnd)}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {isSupervisor && (
        <section className="org-admin-panel">
          <h2>Тарифы</h2>
          <p className="muted">{trialNote}</p>
          <div className="bill-interval" role="group" aria-label="Период оплаты">
            <button type="button" className={interval === 'month' ? 'is-on' : ''} onClick={() => setInterval('month')}>
              Месяц
            </button>
            <button type="button" className={interval === 'year' ? 'is-on' : ''} onClick={() => setInterval('year')}>
              Год −20%
            </button>
          </div>
          {interval === 'month' && (org.promo?.eligible || catalogPromo?.active) ? (
            <p className="sub-banner">{org.promo?.label || catalogPromo?.label || 'Скидка первым салонам −50% на 3 мес.'}</p>
          ) : null}
          <label className="org-admin-check" htmlFor="billing-offer-accept" style={{ marginBottom: '1rem' }}>
            <input
              id="billing-offer-accept"
              type="checkbox"
              checked={acceptOffer}
              onChange={(e) => setAcceptOffer(e.target.checked)}
            />
            <span>Согласен с офертой</span>
          </label>
          <p className="muted" style={{ marginTop: '-0.35rem' }}>
            <Link to="/offer" target="_blank">
              Оферта
            </Link>
            {' · '}
            <Link to="/privacy" target="_blank">
              политика ПДн
            </Link>
            . После оплаты доступ активируется в кабинете (цифровая услуга).
          </p>

          <div className="plan-grid">
            {plans.map((p) => {
              const active = sub.plan === p.id;
              const promo =
                interval === 'month' &&
                (Boolean(org.promo?.eligible) ||
                  (Boolean(catalogPromo?.active) && org.promo?.monthsLeft !== 0));
              const perMonth = promo
                ? p.promoPriceRub ?? Math.round(p.priceRub / 2)
                : interval === 'year'
                  ? p.priceYearPerMonthRub
                  : p.priceRub;
              const yearTotal = (p.priceYearPerMonthRub || 0) * 12;
              return (
                <div key={p.id} className={`plan-card ${active ? 'plan-card-active' : ''}`}>
                  <div className="plan-card-top">
                    <h3>{p.name}</h3>
                    <div className="plan-price">
                      {promo ? (
                        <span className="plan-price-old">{formatMoney(p.priceRub)}</span>
                      ) : null}{' '}
                      {formatMoney(perMonth)}/мес
                    </div>
                  </div>
                  {interval === 'year' ? (
                    <p className="muted">К оплате {formatMoney(yearTotal)} за год</p>
                  ) : promo ? (
                    <p className="plan-price-note">
                      первые {catalogPromo?.months || 3} мес., далее {formatMoney(p.priceRub)}
                    </p>
                  ) : null}
                  <p className="muted">{p.description}</p>
                  <ul className="plain-list">
                    {(p.points || []).map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <div className="plan-card-status" aria-hidden={!active || paying}>
                    {active ? 'Текущий тариф' : '\u00a0'}
                  </div>
                  <div className="plan-card-actions">
                    <button
                      type="button"
                      className="btn primary plan-pay-btn"
                      disabled={paying}
                      aria-busy={paying}
                      title={!acceptOffer ? 'Сначала отметьте согласие с офертой' : undefined}
                      onClick={() => checkout(p.id)}
                    >
                      {sub.status === 'TRIAL' || !active ? 'Оплатить' : 'Продлить'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isSupervisor && payments.length > 0 && (
        <PaymentHistory
          payments={payments}
          showAll={showAllPayments}
          onToggle={() => setShowAllPayments((v) => !v)}
        />
      )}
    </OrgAdminShell>
  );
}
