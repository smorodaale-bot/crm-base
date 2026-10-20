import { prisma } from '../db.js';
import { normalizePhone } from '../utils/phone.js';
import { serializeDeal } from '../utils/helpers.js';
import { pickManagerId, notifyUser, notifyLeadAssigned, notifySupervisors } from './notify.js';
import { runLeadAutomations } from './automations.js';
import { writeActivityLog } from '../utils/audit.js';

export const SLA_MINUTES = Number(process.env.LEAD_SLA_MINUTES || 15);

const OPEN_DEAL_STAGE = { notIn: ['WON', 'LOST'] };

async function findOpenInboundDeal({ clientId, organizationId, externalChatId }) {
  if (externalChatId && organizationId) {
    const dialog = await prisma.telegramDialog.findUnique({
      where: {
        organizationId_telegramChatId: {
          organizationId,
          telegramChatId: String(externalChatId),
        },
      },
    });
    if (dialog?.dealId) {
      const byChat = await prisma.deal.findFirst({
        where: { id: dialog.dealId, deletedAt: null, stage: OPEN_DEAL_STAGE },
        include: { client: true, responsible: true, vehicle: true },
      });
      if (byChat) return byChat;
    }
  }
  if (!clientId) return null;
  return prisma.deal.findFirst({
    where: { clientId, deletedAt: null, stage: OPEN_DEAL_STAGE },
    orderBy: { updatedAt: 'desc' },
    include: { client: true, responsible: true, vehicle: true },
  });
}

async function appendInboundMessage(deal, { initialMessage, messageChannel, messageExternalId }) {
  const body = String(initialMessage || '').trim();
  if (!body) return;
  if (messageExternalId) {
    const exists = await prisma.chatMessage.findFirst({
      where: { externalId: String(messageExternalId) },
    });
    if (exists) return;
  }
  await prisma.chatMessage.create({
    data: {
      dealId: deal.id,
      channel: messageChannel || 'SITE_WIDGET',
      direction: 'in',
      body: body.slice(0, 4000),
      externalId: messageExternalId ? String(messageExternalId) : null,
    },
  });
}

/**
 * Create or reuse inbound lead (website / Avito / messenger).
 * Pass organizationId so the lead lands in that salon's tenant.
 * @returns {{ deal, duplicate: boolean, client }}
 */
export async function createInboundLead({
  name,
  phone: rawPhone,
  email = null,
  comment = null,
  source = 'website',
  leadType = 'PURCHASE',
  utmSource = null,
  utmMedium = null,
  utmCampaign = null,
  sourceUrl = null,
  vehicleId = null,
  amount = null,
  title = null,
  idempotencyKey = null,
  preferredManagerId = null,
  organizationId = null,
  salonSlug = null,
  salonId = null,
  notifyTitle = null,
  initialMessage = null,
  messageChannel = null,
  messageExternalId = null,
  externalChatId = null,
}) {
  const phone = normalizePhone(rawPhone);
  const key = idempotencyKey
    ? organizationId
      ? `org${organizationId}:${idempotencyKey}`
      : idempotencyKey
    : null;

  if (key) {
    const existing = await prisma.leadIdempotency.findUnique({ where: { key } });
    if (existing) {
      const deal = await prisma.deal.findUnique({
        where: { id: existing.dealId },
        include: { client: true, responsible: true, vehicle: true },
      });
      return { deal, duplicate: true, client: deal?.client || null };
    }
  }

  const managerId = await pickManagerId(preferredManagerId || undefined, { organizationId });

  let salon = null;
  if (salonId) {
    salon = await prisma.salon.findFirst({
      where: {
        id: salonId,
        ...(organizationId ? { organizationId } : {}),
      },
    });
  } else if (salonSlug) {
    salon = await prisma.salon.findFirst({
      where: {
        slug: salonSlug,
        ...(organizationId ? { organizationId } : {}),
      },
    });
  } else if (organizationId) {
    salon = await prisma.salon.findFirst({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });
  } else {
    const slug = process.env.DEFAULT_SALON_SLUG || 'skayavto-msk';
    salon = await prisma.salon.findFirst({ where: { slug } });
  }

  const clientWhere = {
    phone,
    deletedAt: null,
    ...(organizationId ? { organizationId } : {}),
  };

  let client = await prisma.client.findFirst({ where: clientWhere });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: name || phone,
        phone,
        email: email || null,
        source: source || 'website',
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        comment: comment || null,
        responsibleManagerId: managerId,
        salonId: salon?.id || null,
        organizationId: organizationId || salon?.organizationId || null,
      },
    });
  } else {
    await prisma.client.update({
      where: { id: client.id },
      data: {
        source: source || client.source,
        utmSource: utmSource || client.utmSource,
        utmMedium: utmMedium || client.utmMedium,
        utmCampaign: utmCampaign || client.utmCampaign,
        comment: comment ? `${client.comment || ''}\n${comment}`.trim() : client.comment,
        organizationId: client.organizationId || organizationId || null,
      },
    });
  }

  const dealTitle = `Заявка: ${client.name}`;
  const orgId = organizationId || salon?.organizationId || client.organizationId || null;

  const openDeal = await findOpenInboundDeal({
    clientId: client.id,
    organizationId: orgId,
    externalChatId,
  });
  if (openDeal) {
    await appendInboundMessage(openDeal, {
      initialMessage,
      messageChannel,
      messageExternalId,
    });
    if (key) {
      await prisma.leadIdempotency
        .create({ data: { key, dealId: openDeal.id } })
        .catch(() => {});
    }
    await notifyUser(openDeal.responsibleId, {
      title: `Новое сообщение: ${source || 'канал'}`,
      body: `${client.name} · ${String(initialMessage || comment || '').slice(0, 180)}`,
      link: `/deals/${openDeal.id}`,
    });
    return { deal: openDeal, duplicate: true, client, appended: true };
  }

  const deal = await prisma.deal.create({
    data: {
      clientId: client.id,
      title: dealTitle,
      amount: amount ?? 0,
      stage: 'NEW_LEAD',
      responsibleId: managerId,
      leadType: leadType || 'PURCHASE',
      vehicleId: vehicleId || null,
      salonId: salon?.id || null,
      sourceUrl: sourceUrl || null,
      idempotencyKey: key,
      nextContactAt: new Date(Date.now() + SLA_MINUTES * 60 * 1000),
    },
    include: { client: true, responsible: true, vehicle: true },
  });

  if (key) {
    await prisma.leadIdempotency.create({ data: { key, dealId: deal.id } });
  }

  if (initialMessage) {
    await prisma.chatMessage.create({
      data: {
        dealId: deal.id,
        channel: messageChannel || 'SITE_WIDGET',
        direction: 'in',
        body: String(initialMessage).slice(0, 4000),
        externalId: messageExternalId || null,
      },
    });
  }

  await writeActivityLog(null, {
    userId: managerId,
    action: 'lead.inbound_created',
    entityType: 'Deal',
    entityId: deal.id,
    metadata: { source, utmSource, leadType, channel: messageChannel, organizationId },
  });

  await notifyLeadAssigned(
    managerId,
    {
      title: notifyTitle || `Новый лид: ${source || 'сайт'}`,
      body: `${name || phone} · ${phone} · ${dealTitle}`,
      link: `/deals/${deal.id}`,
    },
    { organizationId: organizationId || salon?.organizationId || client.organizationId || null }
  );

  await runLeadAutomations(deal);

  return { deal, duplicate: false, client };
}

export function leadPublicResponse(result) {
  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    deal: serializeDeal(result.deal),
    slaMinutes: SLA_MINUTES,
    message: result.duplicate
      ? `Заявка уже принята. Перезвоним в течение ${SLA_MINUTES} мин.`
      : `Спасибо! Менеджер перезвонит в течение ${SLA_MINUTES} минут.`,
  };
}

export function parseWebsiteOrigins(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      /* comma-separated */
    }
    return value
      .split(/[\n,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeOriginInput(raw) {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.origin;
  } catch {
    return null;
  }
}

export function buildLeadFormSnippet({ apiBase, token }) {
  const safeToken = String(token || '').replace(/'/g, "\\'");
  return `<!-- Nova CRM: форма заявки -->
<form id="crm-lead">
  <input name="name" placeholder="Имя" required />
  <input name="phone" type="tel" placeholder="Телефон" required />
  <textarea name="comment" placeholder="Комментарий"></textarea>
  <button type="submit">Отправить заявку</button>
</form>
<script>
  document.getElementById('crm-lead').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await fetch('${apiBase}/api/leads/public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lead-Token': '${safeToken}',
      },
      body: JSON.stringify({
        name: fd.get('name'),
        phone: fd.get('phone'),
        comment: fd.get('comment'),
        source: 'Сайт',
        sourceUrl: location.href,
        utmSource: new URLSearchParams(location.search).get('utm_source'),
        utmMedium: new URLSearchParams(location.search).get('utm_medium'),
        utmCampaign: new URLSearchParams(location.search).get('utm_campaign'),
        idempotencyKey: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      }),
    });
    const data = await res.json().catch(() => ({}));
    alert(data.message || (res.ok ? 'Заявка принята' : (data.error || 'Ошибка отправки')));
    if (res.ok) e.target.reset();
  });
</script>`;
}

/** Escalate NEW_LEAD deals past SLA without first response. */
export async function runSlaCheck({ organizationId } = {}) {
  const cutoff = new Date(Date.now() - SLA_MINUTES * 60 * 1000);
  const where = {
    deletedAt: null,
    stage: 'NEW_LEAD',
    firstRespondedAt: null,
    slaBreachedAt: null,
    createdAt: { lte: cutoff },
  };
  if (organizationId) {
    where.client = { organizationId };
  }

  const breached = await prisma.deal.findMany({
    where,
    include: { client: true, responsible: true },
    take: 100,
  });

  for (const deal of breached) {
    await prisma.deal.update({
      where: { id: deal.id },
      data: { slaBreachedAt: new Date() },
    });
    await notifySupervisors(
      {
        title: 'SLA: лид без ответа',
        body: `${deal.title} · ${deal.client?.name} · менеджер ${deal.responsible?.name}`,
        link: `/deals/${deal.id}`,
      },
      { organizationId: deal.client?.organizationId || undefined }
    );
    if (deal.responsibleId) {
      await notifyUser(deal.responsibleId, {
        title: 'Просрочен ответ по лиду',
        body: `${deal.client?.name || deal.title} ждёт более ${SLA_MINUTES} мин`,
        link: `/deals/${deal.id}`,
      });
    }
  }

  return { checked: breached.length, slaMinutes: SLA_MINUTES };
}
