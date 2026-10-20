import { Router } from 'express';
import { prisma } from '../../db.js';
import { processTelegramDialog } from '../../services/telegramDialog.js';
import { sendTelegramMessage } from '../../services/telegram.js';

async function deliverTelegramReplies(organization, chatId, replies) {
  if (!organization?.telegramBotToken || chatId == null || !replies?.length) return;
  for (const item of replies) {
    if (!item?.text) continue;
    try {
      await sendTelegramMessage(organization.telegramBotToken, {
        chatId,
        text: item.text,
        reply_markup: item.reply_markup,
      });
    } catch (err) {
      console.error('Telegram reply failed', err.message);
    }
  }
}

const router = Router();

async function loadOrgForWebhook(orgId) {
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      telegramBotToken: true,
      telegramWebhookSecret: true,
      telegramBotConfig: true,
    },
  });
}

async function handleTelegramUpdate(req, res, next, organization) {
  try {
    const secret = organization.telegramWebhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== secret) {
        return res.status(401).json({ error: 'Invalid Telegram webhook secret' });
      }
    }

    if (!organization.telegramBotToken) {
      return res.status(404).json({ error: 'Telegram not connected for this organization' });
    }

    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message?.chat) {
      return res.json({ ok: true, ignored: true, replies: [] });
    }

    if (message.chat.type && message.chat.type !== 'private') {
      return res.json({ ok: true, ignored: true, reason: 'not_private', replies: [] });
    }

    const result = await processTelegramDialog({ organization, message });
    await deliverTelegramReplies(organization, message.chat.id, result.replies);
    return res.json({
      ok: true,
      dealId: result.dealId || null,
    });
  } catch (err) {
    if (err.message?.includes('Phone')) {
      return res.status(400).json({ error: err.message, replies: [] });
    }
    if (err.message?.includes('No managers')) {
      const chatId = req.body?.message?.chat?.id || req.body?.edited_message?.chat?.id;
      await deliverTelegramReplies(organization, chatId, [
        {
          text: 'Сейчас не можем принять заявку. Позвоните в салон, пожалуйста.',
          reply_markup: { remove_keyboard: true },
        },
      ]);
      return res.status(503).json({
        error: 'В организации нет менеджеров для назначения лида',
      });
    }
    return next(err);
  }
}

router.post('/:orgId', async (req, res, next) => {
  try {
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ error: 'Invalid organization id' });
    }
    const organization = await loadOrgForWebhook(orgId);
    if (!organization?.telegramBotToken) {
      return res.status(404).json({ error: 'Telegram not connected for this organization' });
    }
    return handleTelegramUpdate(req, res, next, organization);
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    let organization = await prisma.organization.findFirst({
      where: { telegramBotToken: { not: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        telegramBotToken: true,
        telegramWebhookSecret: true,
        telegramBotConfig: true,
      },
    });
    if (!organization) {
      return res.status(503).json({ error: 'No Telegram-connected organization', replies: [] });
    }
    return handleTelegramUpdate(req, res, next, organization);
  } catch (err) {
    return next(err);
  }
});

export default router;
