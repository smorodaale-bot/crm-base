import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { createInboundLead } from '../../services/leads.js';
import { normalizePhone } from '../../utils/phone.js';

const router = Router();

/**
 * WhatsApp inbound webhook (Green-API / Meta-compatible thin adapter).
 * Auth: per-org whatsappWebhookToken (X-WhatsApp-Token) or legacy env.
 */

async function resolveWhatsAppOrg(req) {
  const header =
    req.headers['x-whatsapp-token'] ||
    req.headers['x-lead-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.query.token;
  const token = header ? String(header).trim() : '';

  if (token) {
    const org = await prisma.organization.findFirst({
      where: { whatsappWebhookToken: token },
      select: { id: true, name: true, whatsappVerifyToken: true },
    });
    if (org) return { organization: org };
  }

  const envToken = process.env.WHATSAPP_WEBHOOK_TOKEN || process.env.LEAD_PUBLIC_TOKEN;
  const allowLegacy =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_LEAD_TOKEN === '1';
  if (allowLegacy && envToken && token === envToken) {
    const fallback = await prisma.organization.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, whatsappVerifyToken: true },
    });
    if (fallback) return { organization: fallback };
  }

  return null;
}

/** Meta Cloud API webhook verification */
router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const verify = req.query['hub.verify_token'];
  if (mode !== 'subscribe' || !verify) {
    return res.status(403).send('Forbidden');
  }

  const org = await prisma.organization.findFirst({
    where: { whatsappVerifyToken: String(verify) },
    select: { id: true },
  });
  if (org) return res.status(200).send(challenge);

  const expected = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (expected && verify === expected) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

const simpleSchema = z.object({
  phone: z.string().min(5),
  name: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
});

function parseGreenApi(body) {
  if (body?.typeWebhook !== 'incomingMessageReceived') return null;
  const msgData = body.messageData || {};
  const senderData = body.senderData || {};
  const chatId = senderData.chatId || body.chatId || '';
  const phone = String(chatId).replace(/@.*/, '').replace(/\D/g, '');
  if (!phone) return null;
  const text =
    msgData.textMessageData?.textMessage ||
    msgData.extendedTextMessageData?.text ||
    msgData.caption ||
    '';
  return {
    phone: phone.startsWith('7') || phone.startsWith('8') ? phone : `7${phone}`,
    name: senderData.senderName || senderData.chatName || null,
    text,
    messageId: body.idMessage || body.messageId || null,
  };
}

function parseMeta(body) {
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
  if (!msg?.from) return null;
  return {
    phone: msg.from,
    name: contact?.profile?.name || null,
    text: msg.text?.body || msg.button?.text || '',
    messageId: msg.id || null,
  };
}

router.post('/', async (req, res, next) => {
  try {
    const resolved = await resolveWhatsAppOrg(req);
    if (!resolved?.organization) {
      return res.status(401).json({ error: 'Invalid WhatsApp webhook token' });
    }
    const organizationId = resolved.organization.id;

    let parsed =
      parseGreenApi(req.body) ||
      parseMeta(req.body) ||
      (() => {
        const s = simpleSchema.safeParse(req.body);
        return s.success ? s.data : null;
      })();

    if (!parsed) {
      return res.json({ ok: true, ignored: true });
    }

    const phone = normalizePhone(parsed.phone);
    const externalId = parsed.messageId ? `wa:${organizationId}:${parsed.messageId}` : null;
    if (externalId) {
      const exists = await prisma.chatMessage.findFirst({ where: { externalId } });
      if (exists) return res.json({ ok: true, duplicate: true });
    }

    const name = parsed.name || 'Клиент WhatsApp';
    const text = parsed.text || 'Сообщение из WhatsApp';

    let client = await prisma.client.findFirst({
      where: { phone, deletedAt: null, organizationId },
    });
    let deal = null;
    if (client) {
      deal = await prisma.deal.findFirst({
        where: {
          clientId: client.id,
          deletedAt: null,
          stage: { notIn: ['WON', 'LOST'] },
          client: { organizationId },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (!deal) {
      const result = await createInboundLead({
        name,
        phone,
        organizationId,
        comment: text,
        source: 'WhatsApp',
        title: `WhatsApp: ${name}`,
        idempotencyKey: externalId || `wa:${organizationId}:${phone}:${Date.now()}`,
        notifyTitle: 'Новый лид из WhatsApp',
        initialMessage: text,
        messageChannel: 'WHATSAPP',
        messageExternalId: externalId,
      });
      return res.json({ ok: true, dealId: result.deal.id, duplicate: result.duplicate });
    }

    await prisma.chatMessage.create({
      data: {
        dealId: deal.id,
        channel: 'WHATSAPP',
        direction: 'in',
        body: String(text).slice(0, 4000),
        externalId,
      },
    });

    return res.json({ ok: true, dealId: deal.id, attached: true });
  } catch (err) {
    if (err.message?.includes('Phone')) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

export default router;
