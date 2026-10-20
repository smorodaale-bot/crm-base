import { prisma } from '../db.js';
import { config } from '../config.js';

/** Trial length for a new organization (calendar days). */
export const TRIAL_DAYS = 14;

export const TRIAL_NOTE = '14 дней бесплатно на любом тарифе';

/** Paid period after a successful monthly charge. */
export const BILLING_PERIOD_DAYS = 30;

export const PROMO_ORG_LIMIT = 30;
export const PROMO_MONTHS = 3;
export const PROMO_LABEL = 'Скидка первым салонам −50% на 3 мес.';

export const PLAN_ORDER = ['START', 'BASIC', 'ADVANCED', 'ULTRA'];

const PLAN_CATALOG = {
  START: {
    id: 'START',
    name: 'Старт',
    priceRub: 1490,
    priceYearPerMonthRub: 1190,
    seats: 2,
    salons: 1,
    vehicleLimit: 30,
    channels: null,
    allowedChannels: ['site', 'avito'],
    description: 'Авито и форма сайта, склад до 30 авто',
    features: {
      qc: false,
      speechkit: false,
      stock: true,
      analytics: true,
      analytics_export: false,
      multi_salon: false,
      priority_support: false,
    },
    points: ['До 2 пользователей', 'До 30 авто на складе', 'Заявки: Авито и форма сайта'],
  },
  BASIC: {
    id: 'BASIC',
    name: 'Базовый',
    priceRub: 2990,
    priceYearPerMonthRub: 2390,
    seats: 5,
    salons: 1,
    vehicleLimit: null,
    channels: null,
    allowedChannels: null,
    description: 'Лиды, воронка и задачи для салона',
    features: {
      qc: false,
      speechkit: false,
      stock: false,
      analytics: true,
      analytics_export: false,
      multi_salon: false,
      priority_support: false,
    },
    points: ['До 5 пользователей', 'Без склада/1С'],
  },
  ADVANCED: {
    id: 'ADVANCED',
    name: 'Продвинутый',
    priceRub: 6990,
    priceYearPerMonthRub: 5590,
    seats: 15,
    salons: 1,
    vehicleLimit: null,
    channels: null,
    allowedChannels: null,
    description: 'QC, SpeechKit, склад/1С и полная аналитика',
    popular: true,
    features: {
      qc: true,
      speechkit: true,
      stock: true,
      analytics: true,
      analytics_export: false,
      multi_salon: false,
      priority_support: false,
    },
    points: ['До 15 пользователей', 'Склад/1С'],
  },
  ULTRA: {
    id: 'ULTRA',
    name: 'Ultra',
    priceRub: 14990,
    priceYearPerMonthRub: 11990,
    seats: null,
    salons: null,
    vehicleLimit: null,
    channels: null,
    allowedChannels: null,
    description: 'Безлимит сотрудников, несколько салонов, приоритетная поддержка',
    features: {
      qc: true,
      speechkit: true,
      stock: true,
      analytics: true,
      analytics_export: true,
      multi_salon: true,
      priority_support: true,
    },
    points: ['Без ограничений', 'Приоритетная поддержка'],
  },
};

export function getPlan(plan) {
  return PLAN_CATALOG[plan] || PLAN_CATALOG.BASIC;
}

export function listPlans() {
  return PLAN_ORDER.map((id) => PLAN_CATALOG[id]);
}

export function isYearInterval(interval) {
  return interval === 'year';
}

export function periodEndFrom(from, interval) {
  const end = new Date(from);
  if (isYearInterval(interval)) end.setFullYear(end.getFullYear() + 1);
  else end.setDate(end.getDate() + BILLING_PERIOD_DAYS);
  return end;
}

/**
 * Amount to charge. Yearly uses the listed per-month price × 12.
 * Promo is −50% and only on a monthly charge.
 */
export function quotePlan(planId, interval, { promo = false } = {}) {
  const plan = getPlan(planId);
  const year = isYearInterval(interval);
  if (year) {
    return {
      amountRub: plan.priceYearPerMonthRub * 12,
      perMonthRub: plan.priceYearPerMonthRub,
      interval: 'year',
      promo: false,
      periodDays: null,
    };
  }
  const discounted = Boolean(promo);
  const amountRub = discounted ? Math.round(plan.priceRub / 2) : plan.priceRub;
  return {
    amountRub,
    perMonthRub: amountRub,
    interval: 'month',
    promo: discounted,
    periodDays: BILLING_PERIOD_DAYS,
  };
}

export function seatLimit(plan) {
  return getPlan(plan).seats;
}

export function channelLimit(plan) {
  return getPlan(plan).channels;
}

export function vehicleLimit(plan) {
  return getPlan(plan).vehicleLimit;
}

export function hasFeature(plan, feature) {
  return Boolean(getPlan(plan).features?.[feature]);
}

/** Effective subscription after trial expiry. */
export function resolveSubscriptionState(subscription) {
  if (!subscription) {
    return { ok: false, reason: 'Нет подписки', status: 'CANCELLED', plan: 'BASIC' };
  }

  let { status, plan, trialEndsAt, currentPeriodEnd } = subscription;
  const now = Date.now();

  if (status === 'TRIAL' && trialEndsAt && new Date(trialEndsAt).getTime() < now) {
    status = 'PAST_DUE';
  }
  if (status === 'ACTIVE' && currentPeriodEnd && new Date(currentPeriodEnd).getTime() < now) {
    status = 'PAST_DUE';
  }

  const ok = status === 'TRIAL' || status === 'ACTIVE';
  return {
    ok,
    status,
    plan,
    reason: ok ? null : 'Подписка неактивна. Оплатите тариф в разделе «Организация».',
    trialEndsAt,
    currentPeriodEnd,
  };
}

export function assertFeature(subscription, feature) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  if (!hasFeature(state.plan, feature)) {
    const err = new Error(`Функция недоступна на тарифе ${getPlan(state.plan).name}. Повысьте тариф.`);
    err.status = 403;
    err.code = 'PLAN_FEATURE';
    throw err;
  }
  return state;
}

export function assertSubscriptionActive(subscription) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  return state;
}

export function assertSeatAvailable(subscription, currentSeats) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  const limit = seatLimit(state.plan);
  if (limit != null && currentSeats >= limit) {
    const err = new Error(
      `На тарифе ${getPlan(state.plan).name} не больше ${limit} пользователей. Повысьте тариф, чтобы пригласить ещё.`
    );
    err.status = 403;
    err.code = 'SEAT_LIMIT';
    throw err;
  }
  return state;
}

export function assertVehicleAvailable(subscription, currentVehicles) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  const limit = vehicleLimit(state.plan);
  if (limit != null && currentVehicles >= limit) {
    const err = new Error(
      `На тарифе ${getPlan(state.plan).name} не больше ${limit} авто на складе. Повысьте тариф, чтобы добавить ещё.`
    );
    err.status = 403;
    err.code = 'VEHICLE_LIMIT';
    throw err;
  }
  return state;
}

/** site | avito | telegram | max | whatsapp */
export function assertChannelKind(subscription, kind) {
  const state = resolveSubscriptionState(subscription);
  const allowed = getPlan(state.plan).allowedChannels;
  if (!allowed || allowed.includes(kind)) return state;
  const err = new Error(
    `На тарифе ${getPlan(state.plan).name} заявки приходят только с Авито и формы сайта. Повысьте тариф, чтобы подключить этот канал.`
  );
  err.status = 403;
  err.code = 'PLAN_FEATURE';
  throw err;
}

export function assertChannelAvailable(subscription, currentChannels) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  const limit = channelLimit(state.plan);
  if (limit != null && currentChannels >= limit) {
    const err = new Error(
      `На тарифе ${getPlan(state.plan).name} можно подключить не больше ${limit} каналов заявок. Повысьте тариф.`
    );
    err.status = 403;
    err.code = 'CHANNEL_LIMIT';
    throw err;
  }
  return state;
}

export function assertCanCreateSalon(subscription, currentSalons) {
  const state = resolveSubscriptionState(subscription);
  if (!state.ok) {
    const err = new Error(state.reason);
    err.status = 402;
    throw err;
  }
  const limit = getPlan(state.plan).salons;
  if (limit != null && currentSalons >= limit) {
    const err = new Error('Дополнительный салон доступен только на тарифе Ultra. Повысьте тариф.');
    err.status = 403;
    err.code = 'SALON_LIMIT';
    throw err;
  }
  return state;
}

/** First 30 organizations by id, while EARLY_PROMO is on, with promo months left. */
export async function earlyPromoForOrg(organizationId, promoMonthsUsed = 0) {
  const used = Number(promoMonthsUsed) || 0;
  const monthsLeft = Math.max(0, PROMO_MONTHS - used);
  if (!config.earlyPromo || !organizationId || monthsLeft <= 0) {
    return { eligible: false, monthsUsed: used, monthsLeft: 0, label: PROMO_LABEL };
  }
  const rank = await prisma.organization.count({
    where: { id: { lte: Number(organizationId) } },
  });
  const eligible = rank > 0 && rank <= PROMO_ORG_LIMIT;
  return {
    eligible,
    monthsUsed: used,
    monthsLeft: eligible ? monthsLeft : 0,
    label: PROMO_LABEL,
  };
}
