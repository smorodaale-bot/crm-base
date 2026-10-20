import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, loadDealWithAccess, requireWrite } from '../middleware/auth.js';
import { sendTelegramMessage } from '../services/telegram.js';
import { sendMaxMessage } from '../services/max.js';

const router = Router({ mergeParams: true });
router.use(authenticate);

const messageSchema = z.object({
  body: z.string().min(1).max(4000),
  channel: z.enum(['INTERNAL', 'TELEGRAM', 'WHATSAPP', 'SITE_WIDGET', 'MAX']).optional(),
  direction: z.enum(['in', 'out']).optional(),
});

async function findDealDialog(dealId, organizationId) {
  if (!dealId || !organizationId) return null;
  return prisma.telegramDialog.findFirst({
    where: { dealId, organizationId },
    orderBy: { updatedAt: 'desc' },
  });
}

function parseMessengerTarget(dialog) {
  if (!dialog?.telegramChatId) return null;
  const raw = String(dialog.telegramChatId);
  if (raw.startsWith('max:')) {
    return { channel: 'MAX', userId: raw.slice(4), chatId: raw };
  }
  return { channel: 'TELEGRAM', chatId: raw, userId: dialog.telegramUserId || null };
}

router.get('/:id/chat', loadDealWithAccess, async (req, res, next) => {
  try {
    const orgId = req.user.organizationId || req.deal.client?.organizationId;
    const [messages, dialog] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { dealId: req.deal.id },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      findDealDialog(req.deal.id, orgId),
    ]);

    const target = parseMessengerTarget(dialog);
    const org = orgId
      ? await prisma.organization.findUnique({
          where: { id: orgId },
          select: {
            telegramBotToken: true,
            telegramConnectedAt: true,
            maxBotToken: true,
            maxConnectedAt: true,
          },
        })
      : null;

    return res.json({
      messages,
      replyTargets: {
        telegram: Boolean(
          target?.channel === 'TELEGRAM' && org?.telegramBotToken && org?.telegramConnectedAt
        ),
        max: Boolean(target?.channel === 'MAX' && org?.maxBotToken && org?.maxConnectedAt),
        linkedChannel: target?.channel || null,
        hint:
          target?.channel === 'TELEGRAM'
            ? 'Клиент писал в Telegram-бот — можно ответить в Telegram'
            : target?.channel === 'MAX'
              ? 'Клиент писал в MAX — можно ответить в MAX'
              : 'Исходящие TG/MAX появятся после диалога клиента с ботом салона',
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/chat', requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const channel = parsed.data.channel || 'INTERNAL';
    const body = parsed.data.body;
    const orgId = req.user.organizationId || req.deal.client?.organizationId;
    let externalId = null;

    if (channel === 'TELEGRAM' || channel === 'MAX') {
      if (!orgId) {
        return res.status(400).json({ error: 'Нет организации для отправки' });
      }
      const dialog = await findDealDialog(req.deal.id, orgId);
      const target = parseMessengerTarget(dialog);
      if (!target || target.channel !== channel) {
        return res.status(400).json({
          error:
            channel === 'TELEGRAM'
              ? 'Нет привязанного Telegram-чата. Клиент должен сначала написать боту салона.'
              : 'Нет привязанного MAX-чата. Клиент должен сначала написать боту салона.',
          code: 'NO_MESSENGER_LINK',
        });
      }

      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (channel === 'TELEGRAM') {
        if (!org?.telegramBotToken) {
          return res.status(400).json({ error: 'Telegram-бот не подключён в Организации' });
        }
        const sent = await sendTelegramMessage(org.telegramBotToken, {
          chatId: target.chatId,
          text: body,
        });
        externalId = sent?.message_id != null ? `tg-out:${sent.message_id}` : null;
      } else {
        if (!org?.maxBotToken) {
          return res.status(400).json({ error: 'MAX-бот не подключён в Организации' });
        }
        const sent = await sendMaxMessage(org.maxBotToken, {
          userId: target.userId,
          text: body,
        });
        externalId = sent?.message?.body?.mid || sent?.mid || null;
        if (externalId) externalId = `max-out:${externalId}`;
      }
    }

    const message = await prisma.chatMessage.create({
      data: {
        dealId: req.deal.id,
        authorId: req.user.id,
        body,
        channel,
        direction: parsed.data.direction || 'out',
        externalId,
      },
      include: { author: { select: { id: true, name: true } } },
    });

    if (!req.deal.firstRespondedAt) {
      await prisma.deal.update({
        where: { id: req.deal.id },
        data: {
          firstRespondedAt: new Date(),
          stage: req.deal.stage === 'NEW_LEAD' ? 'FIRST_CONTACT' : req.deal.stage,
        },
      });
    }

    return res.status(201).json({ message });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    return next(err);
  }
});

export default router;
