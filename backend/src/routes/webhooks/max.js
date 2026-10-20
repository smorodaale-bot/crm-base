import { Router } from 'express';
import { prisma } from '../../db.js';
import { processTelegramDialog } from '../../services/telegramDialog.js';
import { answerMaxCallback, sendMaxReplies } from '../../services/max.js';

const router = Router();

function phoneFromVcf(vcf) {
  if (!vcf) return null;
  const match = String(vcf).match(/TEL[^:]*:([+\d][\d\s\-()]+)/i);
  return match ? match[1].replace(/[^\d+]/g, '') : null;
}

function phoneFromMaxAttachments(attachments) {
  if (!Array.isArray(attachments)) return null;
  for (const att of attachments) {
    const payload = att?.payload || att || {};
    const phone =
      payload.phone_number ||
      payload.tel ||
      payload.vcf_phone ||
      payload.max_info?.phone ||
      payload.contact?.phone_number ||
      phoneFromVcf(payload.vcf_info || payload.vcfInfo);
    if (phone) return String(phone);
  }
  return null;
}

function maxUpdateToTelegramMessage(update) {
  const type = update.update_type;
  if (type === 'bot_started') {
    const user = update.user || {};
    const userId = user.user_id || update.user_id;
    return {
      telegramMessage: {
        chat: { id: `max:${userId}`, type: 'private' },
        from: {
          id: userId,
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
        },
        text: '/start',
        message_id: `start-${userId}`,
      },
      userId,
      chatId: update.chat_id,
    };
  }

  if (type === 'message_callback') {
    const user = update.user || {};
    const msg = update.message || {};
    const sender = msg.sender || user;
    const recipient = msg.recipient || {};
    const userId =
      sender.user_id ||
      user.user_id ||
      update.user_id ||
      update.callback?.user_id ||
      update.callback?.user?.user_id;
    const payload =
      update.callback?.payload ||
      update.callback?.text ||
      update.callback?.button?.text ||
      '';
    return {
      telegramMessage: {
        chat: { id: `max:${userId}`, type: 'private' },
        from: {
          id: userId,
          first_name: sender.first_name || user.first_name,
          last_name: sender.last_name || user.last_name,
          username: sender.username || user.username,
        },
        text: String(payload),
        message_id: msg.body?.mid || msg.timestamp || `cb-${Date.now()}`,
      },
      userId,
      chatId: recipient.chat_id || update.chat_id,
    };
  }

  if (type === 'message_created' || type === 'message_edited') {
    const msg = update.message || {};
    const body = msg.body || {};
    const sender = msg.sender || {};
    const recipient = msg.recipient || {};
    const userId = sender.user_id;
    const text = String(body.text || '');
    const contactPhone = phoneFromMaxAttachments(body.attachments);
    return {
      telegramMessage: {
        chat: { id: `max:${userId}`, type: 'private' },
        from: {
          id: userId,
          first_name: sender.first_name,
          last_name: sender.last_name,
          username: sender.username,
        },
        text,
        contact: contactPhone ? { phone_number: contactPhone } : undefined,
        message_id: body.mid || msg.timestamp,
      },
      userId,
      chatId: recipient.chat_id || update.chat_id,
    };
  }

  return null;
}

router.post('/:orgId', async (req, res, next) => {
  try {
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ error: 'Invalid organization id' });
    }
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        maxBotToken: true,
        maxWebhookSecret: true,
        maxBotConfig: true,
        telegramBotConfig: true,
      },
    });
    if (!organization?.maxBotToken) {
      return res.status(200).json({ ok: true, ignored: true, reason: 'not_connected' });
    }

    const secret = organization.maxWebhookSecret;
    if (secret) {
      const header = req.headers['x-max-bot-api-secret'];
      if (header !== secret) {
        return res.status(401).json({ error: 'Invalid MAX webhook secret' });
      }
    }

    const update = req.body?.update && !req.body?.update_type ? req.body.update : req.body || {};
    const mapped = maxUpdateToTelegramMessage(update);
    if (!mapped?.telegramMessage?.from?.id) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (update.update_type === 'message_callback' && (update.callback?.callback_id || update.callback_id)) {
      await answerMaxCallback(
        organization.maxBotToken,
        update.callback?.callback_id || update.callback_id
      );
    }

    const result = await processTelegramDialog({
      organization,
      message: mapped.telegramMessage,
      channel: 'MAX',
    });

    if (result.replies?.length) {
      try {
        await sendMaxReplies(organization.maxBotToken, {
          userId: mapped.userId,
          chatId: mapped.chatId,
          replies: result.replies,
        });
      } catch (err) {
        console.error('MAX send replies failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, dealId: result.dealId || null });
  } catch (err) {
    console.error('MAX webhook error:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

export default router;
