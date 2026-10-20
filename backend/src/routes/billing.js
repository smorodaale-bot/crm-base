import { Router } from 'express';
import { prisma } from '../db.js';
import { activatePaidSubscription, findPaymentByYookassaId, cancelPayment } from '../services/billing.js';
import { getYookassaPayment, isYookassaDemo, yookassaAmountMatches } from '../services/yookassa.js';

const router = Router();

/**
 * YooKassa notification webhook.
 * Docs: https://yookassa.ru/developers/using-api/webhooks
 */
router.post('/yookassa/webhook', async (req, res, next) => {
  try {
    const event = req.body?.event;
    const object = req.body?.object;
    if (!object?.id) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const payment = await findPaymentByYookassaId(object.id);
    if (!payment) {
      // Acknowledge unknown payments to avoid retries storms during tests
      return res.json({ ok: true, ignored: true });
    }

    if (payment.status === 'SUCCEEDED') {
      return res.json({ ok: true, already: true });
    }

    if (event === 'payment.succeeded' || object.status === 'succeeded') {
      if (process.env.NODE_ENV === 'production' && String(object.id).startsWith('demo_')) {
        return res.status(404).json({ error: 'Not found' });
      }
      let paymentMethod = object.payment_method;
      if (!isYookassaDemo() && !String(object.id).startsWith('demo_')) {
        const remote = await getYookassaPayment(object.id);
        if (remote.status !== 'succeeded' && !remote.paid) {
          return res.json({ ok: true, pending: true });
        }
        if (!yookassaAmountMatches(remote, payment.amountRub)) {
          return res.status(400).json({ error: 'Сумма платежа не совпадает' });
        }
        paymentMethod = remote.payment_method || paymentMethod;
      }
      await activatePaidSubscription(payment, { paymentMethod });
      return res.json({ ok: true });
    }

    if (event === 'payment.canceled' || object.status === 'canceled') {
      await cancelPayment(payment.id);
      return res.json({ ok: true, canceled: true });
    }

    return res.json({ ok: true, ignoredEvent: event || object.status });
  } catch (err) {
    return next(err);
  }
});

export default router;
