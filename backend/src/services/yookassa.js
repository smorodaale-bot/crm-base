import crypto from 'crypto';
import { BILLING_PERIOD_DAYS, getPlan } from './plans.js';

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

export function isYookassaDemo() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.YOOKASSA_DEMO === 'true') return true;
  if (process.env.YOOKASSA_DEMO === 'false') return false;
  return !(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

function authHeader() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secret) return null;
  return `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`;
}

export function publicAppUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.YOOKASSA_RETURN_URL?.replace(/\/org.*$/, '') ||
    process.env.CORS_ORIGIN ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
}

export function paymentReturnUrl(localPaymentId) {
  const base =
    process.env.YOOKASSA_RETURN_URL || `${publicAppUrl()}/org/billing?payment=success`;
  if (!localPaymentId) return base;
  const join = base.includes('?') ? '&' : '?';
  if (/[?&]paymentId=/.test(base)) return base;
  return `${base}${join}paymentId=${encodeURIComponent(String(localPaymentId))}`;
}

/** Optional URL for abandoned checkout (link from emails / support). */
export function paymentCancelUrl() {
  return `${publicAppUrl()}/payment/cancel`;
}

/**
 * Create a YooKassa payment (or demo stub).
 * savePaymentMethod=true only when the user opted in to auto-renew.
 */
export async function createPayment({
  amountRub,
  description,
  returnUrl,
  metadata = {},
  savePaymentMethod = false,
}) {
  if (isYookassaDemo()) {
    const id = `demo_${crypto.randomUUID()}`;
    const paymentId = metadata.localPaymentId;
    const confirmationUrl = `${publicAppUrl()}/org/billing?payment=demo&paymentId=${paymentId || ''}&yk=${id}`;
    return {
      id,
      status: 'pending',
      confirmationUrl,
      paid: false,
      demo: true,
    };
  }

  const auth = authHeader();
  if (!auth) {
    const err = new Error('ЮKassa не настроена (YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY)');
    err.status = 503;
    throw err;
  }

  const idempotenceKey = crypto.randomUUID();
  const body = {
    amount: {
      value: Number(amountRub).toFixed(2),
      currency: 'RUB',
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: returnUrl || paymentReturnUrl(),
    },
    description: String(description).slice(0, 128),
    metadata,
  };
  if (savePaymentMethod) {
    body.save_payment_method = true;
  }

  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.description || data?.message || `ЮKassa error ${res.status}`);
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    id: data.id,
    status: data.status,
    confirmationUrl: data.confirmation?.confirmation_url || null,
    paid: Boolean(data.paid),
    demo: false,
    raw: data,
  };
}

/**
 * Charge saved payment method (no user confirmation).
 */
export async function createRecurringPayment({
  amountRub,
  description,
  paymentMethodId,
  metadata = {},
}) {
  if (isYookassaDemo()) {
    return {
      id: `demo_recurring_${crypto.randomUUID()}`,
      status: 'succeeded',
      paid: true,
      demo: true,
      paymentMethod: { id: paymentMethodId, saved: true, title: 'Demo card' },
    };
  }

  const auth = authHeader();
  if (!auth) {
    const err = new Error('ЮKassa не настроена');
    err.status = 503;
    throw err;
  }
  if (!paymentMethodId) {
    const err = new Error('Нет сохранённого способа оплаты');
    err.status = 400;
    throw err;
  }

  const idempotenceKey = crypto.randomUUID();
  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
    },
    body: JSON.stringify({
      amount: {
        value: Number(amountRub).toFixed(2),
        currency: 'RUB',
      },
      capture: true,
      payment_method_id: paymentMethodId,
      description: String(description).slice(0, 128),
      metadata,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.description || data?.message || `ЮKassa recurring error ${res.status}`);
    err.status = 502;
    err.data = data;
    throw err;
  }

  return {
    id: data.id,
    status: data.status,
    paid: Boolean(data.paid),
    demo: false,
    paymentMethod: data.payment_method || null,
    cancellationDetails: data.cancellation_details || null,
    raw: data,
  };
}

export async function getYookassaPayment(paymentId) {
  if (isYookassaDemo() || String(paymentId).startsWith('demo_')) {
    return {
      id: paymentId,
      status: 'succeeded',
      paid: true,
      demo: true,
      payment_method: {
        id: 'demo_method',
        saved: true,
        title: 'Demo card *0000',
        type: 'bank_card',
      },
    };
  }

  const auth = authHeader();
  if (!auth) {
    const err = new Error('ЮKassa не настроена');
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${YOOKASSA_API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: auth },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.description || `ЮKassa get failed ${res.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

/** True when the payment fetched from YooKassa is for the same ruble amount we stored. */
export function yookassaAmountMatches(remote, amountRub) {
  const value = Number(remote?.amount?.value);
  if (!Number.isFinite(value) || !Number.isFinite(Number(amountRub))) return false;
  return Math.round(value * 100) === Math.round(Number(amountRub) * 100);
}

export function planCheckoutDescription(plan, interval) {
  const p = getPlan(plan);
  if (interval === 'year') return `Nova CRM — тариф ${p.name} на год`;
  return `Nova CRM — тариф ${p.name} на ${BILLING_PERIOD_DAYS} дн.`;
}

export function planRenewDescription(plan) {
  const p = getPlan(plan);
  return `Nova CRM — автопродление тарифа ${p.name}`;
}
