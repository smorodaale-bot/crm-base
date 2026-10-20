import { prisma } from '../db.js';
import { earlyPromoForOrg, getPlan, periodEndFrom, quotePlan } from './plans.js';
import { sendPaymentReceiptEmail, sendSubscriptionRenewFailedEmail } from './email.js';
import {
  createRecurringPayment,
  getYookassaPayment,
  isYookassaDemo,
  planRenewDescription,
  publicAppUrl,
} from './yookassa.js';

/**
 * Mark payment succeeded and activate org subscription for one billing period.
 * Optionally attaches saved YooKassa payment method for auto-renew.
 */
export async function activatePaidSubscription(paymentRow, { paymentMethod } = {}) {
  if (!paymentRow) return null;

  if (paymentRow.status === 'SUCCEEDED') {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: paymentRow.organizationId },
    });
    const periodEnd = sub?.currentPeriodEnd || null;
    if (wantsSavedMethod(paymentRow) && paymentMethod?.id && paymentMethod.saved) {
      await attachPaymentMethod(paymentRow.organizationId, paymentMethod);
    }
    const mail = await ensurePaymentReceipt(paymentRow, periodEnd);
    return { payment: paymentRow, periodEnd, already: true, mail };
  }

  const meta = paymentMeta(paymentRow);
  const interval = meta.interval === 'year' ? 'year' : 'month';
  const periodEnd = periodEndFrom(new Date(), interval);

  const subData = {
    plan: paymentRow.plan,
    status: 'ACTIVE',
    currentPeriodEnd: periodEnd,
    billingInterval: interval,
    reminderSentAt: null,
  };
  if (meta.promo === true && interval === 'month') {
    subData.promoMonthsUsed = { increment: 1 };
  }
  if (wantsSavedMethod(paymentRow) && paymentMethod?.id && paymentMethod.saved) {
    subData.yookassaPaymentMethodId = paymentMethod.id;
    subData.paymentMethodTitle = paymentMethodTitle(paymentMethod);
    subData.autoRenew = true;
  }

  const [, payment] = await prisma.$transaction([
    prisma.subscription.update({
      where: { organizationId: paymentRow.organizationId },
      data: subData,
    }),
    prisma.payment.update({
      where: { id: paymentRow.id },
      data: { status: 'SUCCEEDED' },
    }),
  ]);

  const mail = await ensurePaymentReceipt(payment, periodEnd);
  return { payment, periodEnd, already: false, mail };
}

function paymentMethodTitle(pm) {
  if (!pm) return null;
  if (pm.title) return String(pm.title).slice(0, 120);
  if (pm.card?.last4) return `Карта *${pm.card.last4}`;
  return pm.type ? String(pm.type) : 'Сохранённая карта';
}

export async function attachPaymentMethod(organizationId, paymentMethod) {
  if (!organizationId || !paymentMethod?.id || !paymentMethod.saved) return null;
  return prisma.subscription.update({
    where: { organizationId },
    data: {
      yookassaPaymentMethodId: paymentMethod.id,
      paymentMethodTitle: paymentMethodTitle(paymentMethod),
      autoRenew: true,
    },
  });
}

function wantsSavedMethod(payment) {
  return paymentMeta(payment).savePaymentMethod === true;
}

function paymentMeta(payment) {
  return payment.metadata && typeof payment.metadata === 'object' ? { ...payment.metadata } : {};
}

async function resolvePayer(payment) {
  const meta = paymentMeta(payment);
  const createdByUserId = Number(meta.createdByUserId) || null;

  if (createdByUserId) {
    const byId = await prisma.user.findFirst({
      where: { id: createdByUserId, deletedAt: null },
      select: { email: true, name: true },
    });
    if (byId?.email) return byId;
  }

  return prisma.user.findFirst({
    where: {
      organizationId: payment.organizationId,
      deletedAt: null,
      role: { in: ['ADMIN', 'SUPERVISOR'] },
    },
    orderBy: { id: 'asc' },
    select: { email: true, name: true },
  });
}

/** Send receipt if not yet recorded as sent. */
export async function ensurePaymentReceipt(paymentRow, periodEnd) {
  if (!paymentRow) return { sent: false, skipped: true };

  const meta = paymentMeta(paymentRow);
  if (meta.receiptSentAt) {
    return { sent: true, already: true };
  }

  const [org, payer] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: paymentRow.organizationId },
      select: { name: true },
    }),
    resolvePayer(paymentRow),
  ]);

  if (!payer?.email) {
    console.error('[billing] receipt skipped: no payer email', paymentRow.id);
    return { sent: false, error: 'no payer email' };
  }

  const result = await sendPaymentReceiptEmail({
    to: payer.email,
    orgName: org?.name || 'Организация',
    planName: getPlan(paymentRow.plan).name,
    amountRub: paymentRow.amountRub,
    periodEnd,
  });

  if (result.sent) {
    await prisma.payment.update({
      where: { id: paymentRow.id },
      data: {
        metadata: {
          ...meta,
          receiptSentAt: new Date().toISOString(),
          receiptTo: payer.email,
        },
      },
    });
  } else {
    console.error('[billing] receipt not sent:', result.error || result.mode, 'to=', payer.email);
  }

  return { ...result, to: payer.email };
}

export async function findPaymentByYookassaId(yookassaPaymentId) {
  if (!yookassaPaymentId) return null;
  return prisma.payment.findUnique({ where: { yookassaPaymentId } });
}

export async function cancelPayment(paymentId) {
  return prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'CANCELED' },
  });
}

/**
 * Sync a local pending payment with YooKassa and activate if paid.
 */
export async function confirmPaymentWithYookassa(paymentRow, { getYookassaPayment: getPay, isDemo }) {
  if (!paymentRow) return { status: 'missing' };
  if (paymentRow.status === 'SUCCEEDED') {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: paymentRow.organizationId },
    });
    const periodEnd = sub?.currentPeriodEnd || null;
    const mail = await ensurePaymentReceipt(paymentRow, periodEnd);
    return {
      status: 'SUCCEEDED',
      already: true,
      payment: paymentRow,
      periodEnd,
      mail,
    };
  }
  if (paymentRow.status === 'CANCELED') {
    return { status: 'CANCELED', payment: paymentRow };
  }

  if (isDemo || String(paymentRow.yookassaPaymentId || '').startsWith('demo_')) {
    return { status: paymentRow.status, payment: paymentRow, needsDemoComplete: true };
  }

  if (!paymentRow.yookassaPaymentId) {
    return { status: 'PENDING', payment: paymentRow };
  }

  const remote = await getPay(paymentRow.yookassaPaymentId);
  if (remote.status === 'succeeded' || remote.paid) {
    const fresh = await prisma.payment.findUnique({ where: { id: paymentRow.id } });
    if (fresh?.status === 'SUCCEEDED') {
      const sub = await prisma.subscription.findUnique({
        where: { organizationId: paymentRow.organizationId },
      });
      return {
        status: 'SUCCEEDED',
        already: true,
        payment: fresh,
        periodEnd: sub?.currentPeriodEnd || null,
      };
    }
    return {
      status: 'PENDING',
      payment: paymentRow,
      awaitingWebhook: true,
      remoteStatus: remote.status,
    };
  }
  if (remote.status === 'canceled') {
    await cancelPayment(paymentRow.id);
    return { status: 'CANCELED', payment: { ...paymentRow, status: 'CANCELED' } };
  }

  return { status: 'PENDING', payment: paymentRow, remoteStatus: remote.status };
}

/**
 * Attempt auto-renew for one subscription. Creates Payment + charges saved method.
 */
export async function renewSubscription(sub) {
  if (!sub?.autoRenew || !sub.yookassaPaymentMethodId) {
    return { ok: false, reason: 'auto-renew disabled or no payment method' };
  }

  const interval = sub.billingInterval === 'year' ? 'year' : 'month';
  const promoInfo =
    interval === 'month'
      ? await earlyPromoForOrg(sub.organizationId, sub.promoMonthsUsed)
      : { eligible: false };
  const quote = quotePlan(sub.plan, interval, { promo: promoInfo.eligible });
  const amountRub = quote.amountRub;

  const payment = await prisma.payment.create({
    data: {
      organizationId: sub.organizationId,
      plan: sub.plan,
      amountRub,
      status: 'PENDING',
      metadata: { via: 'auto-renew', interval, promo: quote.promo },
    },
  });

  try {
    const yk = await createRecurringPayment({
      amountRub,
      description: planRenewDescription(sub.plan),
      paymentMethodId: sub.yookassaPaymentMethodId,
      metadata: {
        organizationId: String(sub.organizationId),
        plan: sub.plan,
        localPaymentId: String(payment.id),
        via: 'auto-renew',
      },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        yookassaPaymentId: yk.id,
        metadata: {
          via: 'auto-renew',
          demo: Boolean(yk.demo),
        },
      },
    });

    const remote =
      yk.status === 'succeeded' || yk.paid
        ? yk.raw || yk
        : await getYookassaPayment(yk.id);

    if (yk.demo) {
      if (process.env.NODE_ENV === 'production') {
        return { ok: false, reason: 'demo disabled', paymentId: payment.id };
      }
      const pending = await prisma.payment.findUnique({ where: { id: payment.id } });
      const activated = await activatePaidSubscription(pending, {
        paymentMethod: remote.payment_method || yk.paymentMethod,
      });
      return { ok: true, payment: activated.payment, periodEnd: activated.periodEnd, demo: true };
    }

    if (remote.status === 'succeeded' || remote.paid) {
      return { ok: true, pendingWebhook: true, paymentId: payment.id, status: 'PENDING' };
    }

    if (remote.status === 'canceled' || yk.status === 'canceled') {
      await cancelPayment(payment.id);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' },
      });
      await notifyRenewFailed(sub, remote.cancellation_details || yk.cancellationDetails);
      return { ok: false, reason: 'payment canceled', paymentId: payment.id };
    }

    return { ok: false, reason: 'pending', paymentId: payment.id, status: remote.status };
  } catch (err) {
    await cancelPayment(payment.id).catch(() => {});
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAST_DUE' },
    });
    await notifyRenewFailed(sub, { reason: err.message });
    return { ok: false, reason: err.message, paymentId: payment.id };
  }
}

async function notifyRenewFailed(sub, details) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: sub.organizationId },
      select: {
        name: true,
        users: {
          where: { deletedAt: null, role: { in: ['ADMIN', 'SUPERVISOR'] } },
          orderBy: { id: 'asc' },
          take: 1,
          select: { email: true },
        },
      },
    });
    const to = org?.users?.[0]?.email;
    if (!to) return;
    await sendSubscriptionRenewFailedEmail({
      to,
      orgName: org.name,
      planName: getPlan(sub.plan).name,
      reason: details?.reason || 'не удалось списать оплату',
      renewUrl: `${publicAppUrl()}/org`,
    });
  } catch (err) {
    console.error('[billing] renew-fail email:', err?.message || err);
  }
}

export { isYookassaDemo };
