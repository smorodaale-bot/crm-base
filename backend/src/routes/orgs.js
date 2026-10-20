import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authenticate, hashToken, requireWrite, requireWriteRole, revokeAllRefreshTokens, revokeAllTrustedDevices } from '../middleware/auth.js';
import { isAdmin, isSupervisor, publicUser } from '../utils/helpers.js';
import {
  assertSeatAvailable,
  assertSubscriptionActive,
  getPlan,
  listPlans,
  resolveSubscriptionState,
  assertChannelAvailable,
  assertChannelKind,
  assertFeature,
  channelLimit,
  seatLimit,
  vehicleLimit,
  quotePlan,
  earlyPromoForOrg,
  publicPromoOffer,
  PLAN_ORDER,
  TRIAL_NOTE,
} from '../services/plans.js';
import {
  createPayment,
  getYookassaPayment,
  isYookassaDemo,
  isDemoCompleteEnabled,
  paymentReturnUrl,
  planCheckoutDescription,
} from '../services/yookassa.js';
import { allowDevSecrets, sendInviteEmail } from '../services/email.js';
import { config } from '../config.js';
import { activatePaidSubscription, confirmPaymentWithYookassa } from '../services/billing.js';
import {
  buildLeadFormSnippet,
  normalizeOriginInput,
  parseWebsiteOrigins,
} from '../services/leads.js';
import { clearCorsOriginsCache } from '../services/corsOrigins.js';
import {
  buildSetWebhookCurl,
  buildSetWebhookPhoneUrl,
  connectTelegramWebhook,
  disconnectTelegramWebhook,
  isTelegramNetworkError,
  maskBotToken,
  newTelegramWebhookSecret,
  telegramWebhookUrl,
} from '../services/telegram.js';
import {
  connectMaxWebhook,
  disconnectMaxWebhook,
  maskMaxToken,
  maxWebhookUrl,
  newMaxWebhookSecret,
  normalizeMaxToken,
} from '../services/max.js';
import { DEFAULT_TELEGRAM_BOT_CONFIG, normalizeBotConfig } from '../services/telegramDialog.js';

const router = Router();

function publicApiBase() {
  return (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
}

function newLeadToken() {
  return crypto.randomBytes(32).toString('hex');
}

function leadIntakePayload(org) {
  const token = org.leadPublicToken || null;
  const origins = parseWebsiteOrigins(org.leadWebsiteOrigins);
  return {
    leadPublicToken: token,
    websiteOrigins: origins,
    formSnippet: token
      ? buildLeadFormSnippet({ apiBase: publicApiBase(), token })
      : null,
    apiUrl: `${publicApiBase()}/api/leads/public`,
  };
}

function requireOrgAdmin(req, res, next) {
  if (!isSupervisor(req.user) && !isAdmin(req.user)) {
    return res.status(403).json({ error: 'Только администратор или руководитель организации' });
  }
  return next();
}

async function loadOrgBundle(organizationId) {
  if (!organizationId) return null;
  return prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      subscription: true,
      salons: { select: { id: true, name: true, slug: true } },
      _count: { select: { users: { where: { deletedAt: null } } } },
    },
  });
}

function countOrgChannels(org) {
  if (!org) return 0;
  return [
    org.leadPublicToken,
    org.telegramBotToken && org.telegramConnectedAt,
    org.maxBotToken && org.maxConnectedAt,
    org.avitoWebhookToken && org.avitoConnectedAt,
    org.whatsappWebhookToken && org.whatsappConnectedAt,
  ].filter(Boolean).length;
}

async function guardChannelKind(organizationId, kind) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  assertChannelKind(org?.subscription, kind);
}

async function guardNewChannel(organizationId, alreadyConnected) {
  if (alreadyConnected || !organizationId) return;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (!org) return;
  assertChannelAvailable(org.subscription, countOrgChannels(org));
}

async function serializeOrg(org) {
  if (!org) return null;
  const sub = org.subscription;
  const state = resolveSubscriptionState(sub);
  const plan = getPlan(state.plan);
  const seatsUsed = org._count?.users ?? 0;
  const promo = await earlyPromoForOrg(org.id, sub?.promoMonthsUsed || 0);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    ownerId: org.ownerId,
    salons: org.salons || [],
    subscription: sub
      ? {
          plan: state.plan,
          status: state.status,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          active: state.ok,
          autoRenew: Boolean(sub.autoRenew),
          billingInterval: sub.billingInterval === 'year' ? 'year' : 'month',
          hasPaymentMethod: Boolean(sub.yookassaPaymentMethodId),
          paymentMethodTitle: sub.paymentMethodTitle || null,
        }
      : null,
    promo,
    usage: {
      seatsUsed,
      seatsLimit: seatLimit(state.plan),
      channelsUsed: countOrgChannels(org),
      channelsLimit: channelLimit(state.plan),
      salonsUsed: (org.salons || []).length,
      salonsLimit: plan.salons,
    },
    planDetails: plan,
  };
}

router.get('/plans', async (_req, res, next) => {
  try {
    const promo = await publicPromoOffer();
    return res.json({ plans: listPlans(), trialNote: TRIAL_NOTE, promo });
  } catch (err) {
    return next(err);
  }
});

router.use(authenticate);

router.get('/channels', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: {
        leadPublicToken: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        maxBotToken: true,
        maxBotUsername: true,
        maxConnectedAt: true,
        avitoWebhookToken: true,
        avitoConnectedAt: true,
        whatsappWebhookToken: true,
        whatsappConnectedAt: true,
        whatsappGreenIdInstance: true,
      },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });

    return res.json({
      channels: [
        {
          id: 'website',
          name: 'Сайт',
          connected: Boolean(org.leadPublicToken),
          detail: org.leadPublicToken ? 'Ключ формы создан' : 'Ключ не создан',
          anchor: 'channel-website',
        },
        {
          id: 'telegram',
          name: 'Telegram',
          connected: Boolean(org.telegramBotToken && org.telegramConnectedAt),
          detail: org.telegramBotUsername
            ? `@${org.telegramBotUsername}`
            : org.telegramConnectedAt
              ? 'Подключён'
              : 'Не подключён',
          connectedAt: org.telegramConnectedAt || null,
          anchor: 'channel-telegram',
        },
        {
          id: 'max',
          name: 'MAX',
          connected: Boolean(org.maxBotToken && org.maxConnectedAt),
          detail: org.maxBotUsername
            ? `@${org.maxBotUsername}`
            : org.maxConnectedAt
              ? 'Подключён'
              : 'Не подключён',
          connectedAt: org.maxConnectedAt || null,
          anchor: 'channel-max',
        },
        {
          id: 'avito',
          name: 'Авито',
          connected: Boolean(org.avitoWebhookToken && org.avitoConnectedAt),
          detail: org.avitoWebhookToken ? 'Webhook-токен создан' : 'Не подключён',
          connectedAt: org.avitoConnectedAt || null,
          anchor: 'channel-avito',
        },
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          connected: Boolean(org.whatsappWebhookToken && org.whatsappConnectedAt),
          detail: org.whatsappGreenIdInstance
            ? `Green-API ${org.whatsappGreenIdInstance}`
            : org.whatsappWebhookToken
              ? 'Webhook-токен создан'
              : 'Не подключён',
          connectedAt: org.whatsappConnectedAt || null,
          anchor: 'channel-whatsapp',
        },
      ],
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    return res.json({ organization: await serializeOrg(org) });
  } catch (err) {
    return next(err);
  }
});

/** Website lead intake settings for admin / supervisor. */
router.get('/lead-intake', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, leadPublicToken: true, leadWebsiteOrigins: true },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    return res.json(leadIntakePayload(org));
  } catch (err) {
    return next(err);
  }
});

router.post('/lead-intake/token', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const current = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { leadPublicToken: true },
    });
    await guardNewChannel(req.user.organizationId, Boolean(current?.leadPublicToken));
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { leadPublicToken: newLeadToken() },
      select: { id: true, leadPublicToken: true, leadWebsiteOrigins: true },
    });
    return res.json({
      ...leadIntakePayload(org),
      message: 'Ключ создан. Вставьте новый код формы на сайт.',
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/lead-intake', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const rawOrigins = req.body.websiteOrigins ?? req.body.origins ?? [];
    const list = Array.isArray(rawOrigins)
      ? rawOrigins
      : String(rawOrigins)
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);

    const origins = [];
    for (const item of list) {
      const origin = normalizeOriginInput(item);
      if (!origin) {
        return res.status(400).json({ error: `Некорректный адрес сайта: ${item}` });
      }
      if (!origins.includes(origin)) origins.push(origin);
    }

    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { leadWebsiteOrigins: origins },
      select: { id: true, leadPublicToken: true, leadWebsiteOrigins: true },
    });
    clearCorsOriginsCache();
    return res.json({
      ...leadIntakePayload(org),
      message: 'Домены сайта сохранены',
    });
  } catch (err) {
    return next(err);
  }
});

async function stockSyncView(org) {
  const plan = org.subscription?.plan || 'BASIC';
  const enabled = Boolean(getPlan(plan).features?.stock_api);
  const active = await prisma.stockSyncCredential.findFirst({
    where: { organizationId: org.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return {
    enabled,
    hasToken: Boolean(active),
    createdAt: active?.createdAt || null,
    lastUsedAt: active?.lastUsedAt || null,
    headerName: 'X-Stock-Token',
    webhookUrl: `${publicAppUrl()}/api/stock/sync`,
    hint: enabled
      ? 'Токен показывается один раз. В базе хранится только хэш. Заголовок X-Stock-Token, в теле обязателен salonSlug этой организации.'
      : 'API синхронизации склада доступно на тарифе Продвинутый.',
  };
}

router.get('/stock-sync', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      include: { subscription: true },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    return res.json(await stockSyncView(org));
  } catch (err) {
    return next(err);
  }
});

router.post('/stock-sync/token', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      include: { subscription: true },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    assertFeature(org.subscription, 'stock_api');
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    await prisma.$transaction([
      prisma.stockSyncCredential.updateMany({
        where: { organizationId: org.id, revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.stockSyncCredential.create({
        data: { organizationId: org.id, tokenHash: hashToken(token) },
      }),
    ]);
    return res.json({
      ...(await stockSyncView(org)),
      token,
      message: 'Скопируйте токен сейчас. Повторно он не показывается. Старый токен отозван.',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    return next(err);
  }
});

router.post('/stock-sync/revoke', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      include: { subscription: true },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    await prisma.stockSyncCredential.updateMany({
      where: { organizationId: org.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.json({
      ...(await stockSyncView(org)),
      message: 'Токен синхронизации склада отозван',
    });
  } catch (err) {
    return next(err);
  }
});

function telegramPayload(org) {
  const connected = Boolean(org.telegramBotToken && org.telegramConnectedAt);
  return {
    connected,
    botUsername: org.telegramBotUsername || null,
    botTokenMasked: maskBotToken(org.telegramBotToken),
    webhookUrl: telegramWebhookUrl(org.id),
    connectedAt: org.telegramConnectedAt || null,
    botLink: org.telegramBotUsername ? `https://t.me/${org.telegramBotUsername}` : null,
    botConfig: normalizeBotConfig(org.telegramBotConfig),
    workerHint:
      'Входящие сообщения приходят на ' +
      telegramWebhookUrl(org.id) +
      '. Если сервер не достучится до api.telegram.org, «Переподключить» вызовет setWebhook через запасной канал, но URL останется этим.',
  };
}

router.get('/telegram', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: {
        id: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        telegramBotConfig: true,
      },
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    return res.json(telegramPayload(org));
  } catch (err) {
    return next(err);
  }
});

router.patch('/telegram/bot-config', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const botConfig = normalizeBotConfig(req.body?.botConfig || req.body || {});
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { telegramBotConfig: botConfig },
      select: {
        id: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        telegramBotConfig: true,
      },
    });
    return res.json({
      ...telegramPayload(org),
      message: 'Сценарий бота сохранён',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/telegram/bot-config/reset', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const botConfig = normalizeBotConfig(DEFAULT_TELEGRAM_BOT_CONFIG);
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { telegramBotConfig: botConfig },
      select: {
        id: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        telegramBotConfig: true,
      },
    });
    return res.json({
      ...telegramPayload(org),
      message: 'Сценарий сброшен к шаблону автосалона',
    });
  } catch (err) {
    return next(err);
  }
});

/** Connect org Telegram bot: save token + setWebhook on Telegram side. */
router.post('/telegram/connect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    await guardChannelKind(req.user.organizationId, 'telegram');
    const existingTg = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { telegramConnectedAt: true },
    });
    await guardNewChannel(req.user.organizationId, Boolean(existingTg?.telegramConnectedAt));
    const botToken = String(req.body.botToken || '').trim();
    if (!botToken || botToken.length < 20) {
      return res.status(400).json({ error: 'Укажите токен бота от @BotFather' });
    }

    const organizationId = req.user.organizationId;
    const secret = newTelegramWebhookSecret();
    let username = null;
    let manualWebhookRequired = false;
    let connectVia = null;

    try {
      const connected = await connectTelegramWebhook({
        botToken,
        organizationId,
        secret,
      });
      username = connected.username;
      connectVia = connected.via || 'direct';
    } catch (err) {
      if (
        err.telegram ||
        String(err.message || '').includes('Unauthorized') ||
        String(err.message || '').toLowerCase().includes('token')
      ) {
        return res.status(400).json({
          error: err.message || 'Неверный токен бота. Проверьте токен от @BotFather.',
        });
      }
      // Direct Telegram + Worker setup both failed → phone link with secret_token
      manualWebhookRequired = true;
      console.warn('Telegram connect fallback to phone URL:', err.message);
    }

    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        telegramBotToken: botToken,
        telegramWebhookSecret: secret,
        telegramBotUsername: username,
        telegramConnectedAt: new Date(),
      },
      select: {
        id: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        telegramBotConfig: true,
      },
    });

    const payload = telegramPayload(org);
    if (manualWebhookRequired) {
      return res.json({
        ...payload,
        manualWebhookRequired: true,
        setWebhookCurl: buildSetWebhookCurl({ botToken, organizationId, secret }),
        setWebhookPhoneUrl: buildSetWebhookPhoneUrl({ botToken, organizationId, secret }),
        message:
          'Автоподключение не удалось. Откройте ссылку setWebhook на телефоне (мобильный интернет) — секрет уже встроен. Затем напишите боту /start.',
      });
    }

    return res.json({
      ...payload,
      connectVia,
      message: username
        ? `Бот @${username} подключён${connectVia === 'worker' ? ' (через Cloudflare)' : ''}. Напишите /start для проверки.`
        : 'Telegram подключён. Напишите боту /start для проверки.',
    });
  } catch (err) {
    if (err.telegram || err.message?.includes('Telegram') || err.message?.includes('Unauthorized')) {
      return res.status(400).json({
        error: err.message || 'Не удалось подключить бота. Проверьте токен.',
      });
    }
    return next(err);
  }
});

router.post('/telegram/disconnect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const current = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { telegramBotToken: true },
    });
    await disconnectTelegramWebhook(current?.telegramBotToken);

    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: {
        telegramBotToken: null,
        telegramWebhookSecret: null,
        telegramBotUsername: null,
        telegramConnectedAt: null,
      },
      select: {
        id: true,
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
        telegramBotConfig: true,
      },
    });

    return res.json({
      ...telegramPayload(org),
      message: 'Telegram отключён',
    });
  } catch (err) {
    return next(err);
  }
});

function maxPayload(org) {
  const connected = Boolean(org.maxBotToken && org.maxConnectedAt);
  return {
    connected,
    botUsername: org.maxBotUsername || null,
    botTokenMasked: maskMaxToken(org.maxBotToken),
    webhookUrl: maxWebhookUrl(org.id),
    connectedAt: org.maxConnectedAt || null,
    botLink: org.maxBotUsername ? `https://max.ru/${org.maxBotUsername}` : null,
    botConfig: normalizeBotConfig(org.maxBotConfig || org.telegramBotConfig),
  };
}

const maxSelect = {
  id: true,
  maxBotToken: true,
  maxBotUsername: true,
  maxConnectedAt: true,
  maxBotConfig: true,
  telegramBotConfig: true,
};

router.get('/max', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: maxSelect,
    });
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    return res.json(maxPayload(org));
  } catch (err) {
    return next(err);
  }
});

router.patch('/max/bot-config', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const botConfig = normalizeBotConfig(req.body?.botConfig || req.body || {});
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { maxBotConfig: botConfig },
      select: maxSelect,
    });
    return res.json({ ...maxPayload(org), message: 'Сценарий бота MAX сохранён' });
  } catch (err) {
    return next(err);
  }
});

router.post('/max/bot-config/reset', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const botConfig = normalizeBotConfig(DEFAULT_TELEGRAM_BOT_CONFIG);
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { maxBotConfig: botConfig },
      select: maxSelect,
    });
    return res.json({ ...maxPayload(org), message: 'Сценарий MAX сброшен к шаблону' });
  } catch (err) {
    return next(err);
  }
});

router.post('/max/connect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    await guardChannelKind(req.user.organizationId, 'max');
    const existingMax = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { maxConnectedAt: true },
    });
    await guardNewChannel(req.user.organizationId, Boolean(existingMax?.maxConnectedAt));
    const botToken = normalizeMaxToken(req.body.botToken);
    if (!botToken || botToken.length < 8) {
      return res.status(400).json({ error: 'Укажите токен бота MAX (платформа → Чат-боты → Настройки)' });
    }

    const organizationId = req.user.organizationId;
    const secret = newMaxWebhookSecret();
    const connected = await connectMaxWebhook({ botToken, organizationId, secret });

    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        maxBotToken: botToken,
        maxWebhookSecret: secret,
        maxBotUsername: connected.username,
        maxConnectedAt: new Date(),
      },
      select: maxSelect,
    });

    return res.json({
      ...maxPayload(org),
      message: connected.username
        ? `Бот @${connected.username} в MAX подключён. Напишите ему в мессенджере.`
        : 'Бот MAX подключён. Напишите ему в мессенджере для проверки.',
    });
  } catch (err) {
    console.error('MAX connect failed:', err.message, err.max || '');
    if (
      err.status === 401 ||
      err.status === 400 ||
      err.status === 502 ||
      err.max ||
      String(err.message || '').includes('MAX')
    ) {
      return res.status(400).json({
        error: err.message || 'Неверный токен или MAX отклонил webhook. Нужен HTTPS на nova-crm.online.',
      });
    }
    return next(err);
  }
});

router.post('/max/disconnect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const current = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { maxBotToken: true },
    });
    await disconnectMaxWebhook(current?.maxBotToken);

    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: {
        maxBotToken: null,
        maxWebhookSecret: null,
        maxBotUsername: null,
        maxConnectedAt: null,
      },
      select: maxSelect,
    });

    return res.json({ ...maxPayload(org), message: 'MAX отключён' });
  } catch (err) {
    return next(err);
  }
});

function publicAppUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
}

function maskSecret(token) {
  if (!token) return null;
  if (token.length < 12) return '••••••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

router.get('/avito', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, avitoWebhookToken: true, avitoConnectedAt: true },
    });
    return res.json({
      connected: Boolean(org?.avitoWebhookToken && org?.avitoConnectedAt),
      tokenMasked: maskSecret(org?.avitoWebhookToken),
      connectedAt: org?.avitoConnectedAt || null,
      webhookUrl: `${publicAppUrl()}/api/webhooks/avito`,
      headerName: 'X-Avito-Token',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/avito/connect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const existingAvito = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { avitoConnectedAt: true },
    });
    await guardNewChannel(req.user.organizationId, Boolean(existingAvito?.avitoConnectedAt));
    const token = newLeadToken();
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { avitoWebhookToken: token, avitoConnectedAt: new Date() },
      select: { id: true, avitoWebhookToken: true, avitoConnectedAt: true },
    });
    return res.json({
      connected: true,
      token: org.avitoWebhookToken,
      tokenMasked: maskSecret(org.avitoWebhookToken),
      connectedAt: org.avitoConnectedAt,
      webhookUrl: `${publicAppUrl()}/api/webhooks/avito`,
      headerName: 'X-Avito-Token',
      message: 'Токен Авито создан. Укажите его в Zapier/Make/интеграции.',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/avito/disconnect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { avitoWebhookToken: null, avitoConnectedAt: null },
    });
    return res.json({ connected: false, message: 'Авито отключён' });
  } catch (err) {
    return next(err);
  }
});

router.get('/whatsapp', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: {
        id: true,
        whatsappWebhookToken: true,
        whatsappVerifyToken: true,
        whatsappGreenIdInstance: true,
        whatsappGreenApiToken: true,
        whatsappConnectedAt: true,
      },
    });
    return res.json({
      connected: Boolean(org?.whatsappWebhookToken && org?.whatsappConnectedAt),
      tokenMasked: maskSecret(org?.whatsappWebhookToken),
      verifyTokenMasked: maskSecret(org?.whatsappVerifyToken),
      greenIdInstance: org?.whatsappGreenIdInstance || '',
      greenApiTokenMasked: maskSecret(org?.whatsappGreenApiToken),
      connectedAt: org?.whatsappConnectedAt || null,
      webhookUrl: `${publicAppUrl()}/api/webhooks/whatsapp`,
      headerName: 'X-WhatsApp-Token',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/whatsapp/connect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    await guardChannelKind(req.user.organizationId, 'whatsapp');
    const existingWa = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { whatsappConnectedAt: true },
    });
    await guardNewChannel(req.user.organizationId, Boolean(existingWa?.whatsappConnectedAt));
    const greenIdInstance = String(req.body.greenIdInstance || '').trim() || null;
    const greenApiToken = String(req.body.greenApiToken || '').trim() || null;
    const token = newLeadToken();
    const verifyToken = String(req.body.verifyToken || '').trim() || newLeadToken().slice(0, 24);
    const org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: {
        whatsappWebhookToken: token,
        whatsappVerifyToken: verifyToken,
        whatsappGreenIdInstance: greenIdInstance,
        whatsappGreenApiToken: greenApiToken,
        whatsappConnectedAt: new Date(),
      },
      select: {
        whatsappWebhookToken: true,
        whatsappVerifyToken: true,
        whatsappGreenIdInstance: true,
        whatsappConnectedAt: true,
      },
    });
    return res.json({
      connected: true,
      token: org.whatsappWebhookToken,
      verifyToken: org.whatsappVerifyToken,
      tokenMasked: maskSecret(org.whatsappWebhookToken),
      verifyTokenMasked: maskSecret(org.whatsappVerifyToken),
      greenIdInstance: org.whatsappGreenIdInstance || '',
      connectedAt: org.whatsappConnectedAt,
      webhookUrl: `${publicAppUrl()}/api/webhooks/whatsapp`,
      headerName: 'X-WhatsApp-Token',
      message: 'WhatsApp webhook настроен. Укажите URL и токен в Green-API / Meta.',
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/whatsapp/disconnect', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: {
        whatsappWebhookToken: null,
        whatsappVerifyToken: null,
        whatsappGreenIdInstance: null,
        whatsappGreenApiToken: null,
        whatsappConnectedAt: null,
      },
    });
    return res.json({ connected: false, message: 'WhatsApp отключён' });
  } catch (err) {
    return next(err);
  }
});

router.patch('/', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });

    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { name },
    });
    const org = await loadOrgBundle(req.user.organizationId);
    return res.json({ organization: await serializeOrg(org) });
  } catch (err) {
    return next(err);
  }
});

router.post('/invites', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = ['ADMIN', 'SUPERVISOR', 'MANAGER', 'READONLY'].includes(req.body.role)
      ? req.body.role
      : 'MANAGER';
    if (!email.includes('@')) return res.status(400).json({ error: 'Укажите email' });
    if (role === 'ADMIN' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Только ADMIN может приглашать администраторов' });
    }
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org) return res.status(404).json({ error: 'Организация не найдена' });
    const token = crypto.randomBytes(24).toString('hex');
    const salonId = req.user.salonId || org.salons?.[0]?.id || null;
    await prisma.orgInvite.create({
      data: {
        tokenHash: hashToken(token),
        email,
        role,
        organizationId: org.id,
        salonId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const base = (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
    const link = `${base}/invite/${token}`;
    const roleLabel = { ADMIN: 'Администратор', SUPERVISOR: 'Руководитель', MANAGER: 'Менеджер', READONLY: 'Только чтение' }[role];
    if (!config.emailOtp) {
      return res.status(201).json({
        ok: true,
        message: 'Скопируйте ссылку и отправьте её сотруднику.',
        inviteLink: link,
      });
    }
    const mail = await sendInviteEmail(email, { orgName: org.name, link, roleLabel });
    if (!mail.sent) {
      console.error(`[org] invite email failed to=${email} mode=${mail.mode} error=${mail.error || ''}`);
      if (!allowDevSecrets()) {
        return res.status(503).json({ error: 'Не удалось отправить письмо, попробуйте позже' });
      }
      return res.status(201).json({
        ok: true,
        message: 'SMTP не настроен — ссылка для разработки ниже.',
        devLink: link,
      });
    }
    return res.status(201).json({
      ok: true,
      message: `Приглашение отправлено на ${email}`,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/members', requireOrgAdmin, async (req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        salonId: true,
        createdAt: true,
      },
    });
    return res.json({ members: members.map(publicUser) });
  } catch (err) {
    return next(err);
  }
});

const memberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'MANAGER', 'READONLY']).default('MANAGER'),
  salonId: z.number().int().optional().nullable(),
});

router.post('/members', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const parsed = memberSchema.safeParse({
      ...req.body,
      salonId: req.body.salonId != null && req.body.salonId !== '' ? Number(req.body.salonId) : null,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });

    if (parsed.data.role === 'ADMIN' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Только ADMIN может добавлять администраторов' });
    }

    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const salonId = parsed.data.salonId || req.user.salonId || org.salons[0]?.id || null;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Soft-deleted in this org → restore and update role/password
      if (existing.deletedAt && existing.organizationId === req.user.organizationId) {
        assertSeatAvailable(org.subscription, org._count.users);
        const restored = await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: parsed.data.name,
            passwordHash,
            role: parsed.data.role,
            salonId,
            deletedAt: null,
            organizationId: req.user.organizationId,
          },
        });
        return res.status(200).json({ user: publicUser(restored), restored: true });
      }
      return res.status(409).json({
        error: existing.deletedAt
          ? 'Email занят удалённым пользователем другой организации'
          : 'Email уже занят',
      });
    }

    assertSeatAvailable(org.subscription, org._count.users);

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        role: parsed.data.role,
        organizationId: req.user.organizationId,
        salonId,
      },
    });

    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email уже занят' });
    return next(err);
  }
});

router.post('/members/:id/sessions/revoke', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const member = await prisma.user.findFirst({
      where: { id, organizationId: req.user.organizationId },
    });
    if (!member) return res.status(404).json({ error: 'Сотрудник не найден' });
    await revokeAllRefreshTokens(id);
    await revokeAllTrustedDevices(id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.patch('/members/:id', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const member = await prisma.user.findFirst({
      where: { id, organizationId: req.user.organizationId },
    });
    if (!member) return res.status(404).json({ error: 'Сотрудник не найден' });

    const data = {};
    if (req.body.role) {
      if (!['ADMIN', 'SUPERVISOR', 'MANAGER', 'READONLY'].includes(req.body.role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      if (req.body.role === 'ADMIN' && !isAdmin(req.user)) {
        return res.status(403).json({ error: 'Только ADMIN может назначать администраторов' });
      }
      data.role = req.body.role;
    }
    if (req.body.deactivate === true || req.body.deleted === true) {
      if (member.id === req.user.id) {
        return res.status(400).json({ error: 'Нельзя деактивировать себя' });
      }
      data.deletedAt = new Date();
    }
    if (req.body.activate === true || req.body.restore === true) {
      data.deletedAt = null;
    }
    if (req.body.name) data.name = String(req.body.name).trim();
    if (req.body.password && String(req.body.password).length >= 8) {
      data.passwordHash = await bcrypt.hash(String(req.body.password), 10);
    }
    if (req.body.salonId !== undefined) {
      data.salonId = req.body.salonId == null ? null : Number(req.body.salonId);
    }

    const updated = await prisma.user.update({ where: { id }, data });
    if (data.deletedAt || data.passwordHash) {
      await revokeAllRefreshTokens(id);
      if (data.deletedAt) await revokeAllTrustedDevices(id);
    }
    return res.json({ user: publicUser(updated) });
  } catch (err) {
    return next(err);
  }
});

/** Plan changes only via successful payment (checkout + webhook). */
router.post('/subscription/change-plan', requireWriteRole, requireOrgAdmin, async (_req, res) => {
  return res.status(403).json({
    error: 'Тариф меняется только после оплаты. Нажмите «Оплатить» у нужного тарифа.',
  });
});

/** Enable/disable auto-renew (requires saved YooKassa payment method). */
router.post('/subscription/auto-renew', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });

    if (enabled && !org.subscription.yookassaPaymentMethodId) {
      return res.status(400).json({
        error: 'Сначала оплатите тариф картой с сохранением способа оплаты — затем можно включить автопродление.',
      });
    }

    await prisma.subscription.update({
      where: { organizationId: org.id },
      data: { autoRenew: enabled },
    });

    const refreshed = await loadOrgBundle(org.id);
    return res.json({
      organization: await serializeOrg(refreshed),
      message: enabled ? 'Автопродление включено' : 'Автопродление выключено',
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * Unbind saved payment method (required by YooKassa for recurring payments).
 * Clearing the id locally stops all auto-charges.
 */
router.post('/subscription/unlink-payment-method', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });
    if (!org.subscription.yookassaPaymentMethodId) {
      return res.status(400).json({ error: 'Сохранённый способ оплаты не найден' });
    }

    await prisma.subscription.update({
      where: { organizationId: org.id },
      data: {
        yookassaPaymentMethodId: null,
        paymentMethodTitle: null,
        autoRenew: false,
      },
    });

    const refreshed = await loadOrgBundle(org.id);
    return res.json({
      organization: await serializeOrg(refreshed),
      message: 'Карта отвязана. Автопродление выключено.',
    });
  } catch (err) {
    return next(err);
  }
});

/** Create YooKassa (or demo) checkout session. */
router.post('/subscription/checkout', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });

    const plan = req.body.plan
      ? String(req.body.plan).toUpperCase()
      : org.subscription.plan;
    if (!PLAN_ORDER.includes(plan)) {
      return res.status(400).json({ error: 'Неизвестный тариф' });
    }

    const seatsUsed = org._count.users;
    const limit = seatLimit(plan);
    if (limit != null && seatsUsed > limit) {
      return res.status(403).json({
        error: `Сейчас ${seatsUsed} сотрудников, лимит тарифа ${getPlan(plan).name}: ${limit}. Повысьте тариф.`,
        code: 'SEAT_LIMIT',
      });
    }

    const carsLimit = vehicleLimit(plan);
    if (carsLimit != null) {
      const cars = await prisma.vehicle.count({
        where: { deletedAt: null, salon: { organizationId: org.id } },
      });
      if (cars > carsLimit) {
        return res.status(403).json({
          error: `На складе ${cars} авто, лимит тарифа ${getPlan(plan).name}: ${carsLimit}. Повысьте тариф.`,
          code: 'VEHICLE_LIMIT',
        });
      }
    }

    const interval = req.body?.interval === 'year' ? 'year' : 'month';
    const promoInfo =
      interval === 'month'
        ? await earlyPromoForOrg(org.id, org.subscription.promoMonthsUsed)
        : { eligible: false };
    const quote = quotePlan(plan, interval, { promo: promoInfo.eligible });
    const amountRub = quote.amountRub;
    const savePaymentMethod = req.body?.savePaymentMethod === true;

    const payment = await prisma.payment.create({
      data: {
        organizationId: org.id,
        plan,
        amountRub,
        status: 'PENDING',
        metadata: {
          createdByUserId: req.user.id,
          savePaymentMethod,
          interval,
          promo: quote.promo,
        },
      },
    });

    const yk = await createPayment({
      amountRub,
      description: planCheckoutDescription(plan, interval),
      returnUrl: paymentReturnUrl(payment.id),
      savePaymentMethod,
      metadata: {
        organizationId: String(org.id),
        plan,
        localPaymentId: String(payment.id),
        savePaymentMethod: savePaymentMethod ? '1' : '0',
      },
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        yookassaPaymentId: yk.id,
        confirmationUrl: yk.confirmationUrl,
        metadata: {
          ...(payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {}),
          createdByUserId: req.user.id,
          demo: Boolean(yk.demo),
        },
      },
    });

    return res.json({
      payment: {
        id: updated.id,
        plan: updated.plan,
        amountRub: updated.amountRub,
        status: updated.status,
        confirmationUrl: updated.confirmationUrl,
        demo: isYookassaDemo() || Boolean(yk.demo),
      },
      confirmationUrl: updated.confirmationUrl,
      message: yk.demo
        ? 'Демо-режим ЮKassa: подтвердите оплату на следующей странице'
        : 'Перейдите по ссылке для оплаты',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

/** Registered only for a local demo. Production never mounts this route. */
if (isDemoCompleteEnabled()) {
router.post('/subscription/demo-complete', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    if (!isYookassaDemo()) {
      return res.status(403).json({ error: 'Демо-оплата отключена' });
    }
    const paymentId = Number(req.body.paymentId);
    if (!paymentId) return res.status(400).json({ error: 'paymentId required' });

    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, organizationId: req.user.organizationId },
    });
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    if (payment.status === 'SUCCEEDED') {
      const refreshed = await loadOrgBundle(req.user.organizationId);
      return res.json({
        organization: await serializeOrg(refreshed),
        status: 'SUCCEEDED',
        message: 'Уже оплачено',
      });
    }

    const activated = await activatePaidSubscription(payment, {
      paymentMethod: { id: 'demo_method', saved: true, title: 'Demo card *0000', type: 'bank_card' },
    });
    const refreshed = await loadOrgBundle(req.user.organizationId);
    const planName = getPlan(payment.plan).name;
    return res.json({
      organization: await serializeOrg(refreshed),
      status: 'SUCCEEDED',
      periodEnd: activated.periodEnd,
      message: `Оплата принята. Тариф ${planName} активен до ${new Date(activated.periodEnd).toLocaleDateString('ru-RU')}.`,
    });
  } catch (err) {
    return next(err);
  }
});
}

/**
 * After return from YooKassa: report status. Activation happens only in the succeeded webhook.
 */
router.post('/subscription/confirm-payment', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    if (!orgId) return res.status(400).json({ error: 'Нет организации' });

    let payment = null;
    const paymentId = Number(req.body.paymentId);
    if (paymentId) {
      payment = await prisma.payment.findFirst({
        where: { id: paymentId, organizationId: orgId },
      });
    }
    if (!payment) {
      payment = await prisma.payment.findFirst({
        where: { organizationId: orgId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!payment) {
      const refreshed = await loadOrgBundle(orgId);
      return res.json({
        organization: await serializeOrg(refreshed),
        status: 'missing',
        message: 'Платёж не найден',
      });
    }

    const result = await confirmPaymentWithYookassa(payment, {
      getYookassaPayment,
      isDemo: isYookassaDemo(),
    });

    const refreshed = await loadOrgBundle(orgId);
    const planName = getPlan(payment.plan).name;
    const periodLabel = result.periodEnd
      ? new Date(result.periodEnd).toLocaleDateString('ru-RU')
      : refreshed?.subscription?.currentPeriodEnd
        ? new Date(refreshed.subscription.currentPeriodEnd).toLocaleDateString('ru-RU')
        : null;

    let message = 'Ожидаем подтверждение оплаты…';
    if (result.status === 'SUCCEEDED') {
      const mailNote =
        result.mail?.sent || result.mail?.already
          ? ' На email отправлено подтверждение.'
          : result.mail?.error
            ? ` Письмо не отправилось (${result.mail.error}).`
            : '';
      message = result.already
        ? `Тариф ${planName} уже активен${periodLabel ? ` до ${periodLabel}` : ''}.${mailNote}`
        : `Оплата прошла успешно. Тариф ${planName} активен${periodLabel ? ` до ${periodLabel}` : ''}.${mailNote}`;
    } else if (result.awaitingWebhook) {
      message = 'ЮKassa подтвердила оплату. Тариф станет активным после webhook со статусом succeeded.';
    } else if (result.status === 'CANCELED') {
      message = 'Платёж отменён. Можно попробовать снова.';
    } else if (result.needsDemoComplete) {
      message = 'Демо-режим: подтвердите оплату на этой странице.';
    }

    return res.json({
      organization: await serializeOrg(refreshed),
      status: result.status,
      paymentId: payment.id,
      periodEnd: result.periodEnd || refreshed?.subscription?.currentPeriodEnd || null,
      message,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.get('/subscription/payments', requireOrgAdmin, async (req, res, next) => {
  try {
    if (!req.user.organizationId) return res.status(400).json({ error: 'Нет организации' });
    const payments = await prisma.payment.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        plan: true,
        amountRub: true,
        status: true,
        confirmationUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return res.json({ payments, demo: isYookassaDemo() });
  } catch (err) {
    return next(err);
  }
});

/** @deprecated use /subscription/checkout */
router.post('/subscription/pay', requireWriteRole, requireOrgAdmin, async (req, res, next) => {
  try {
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });

    const plan = req.body.plan
      ? String(req.body.plan).toUpperCase()
      : org.subscription.plan;
    if (!PLAN_ORDER.includes(plan)) {
      return res.status(400).json({ error: 'Неизвестный тариф' });
    }

    const interval = req.body?.interval === 'year' ? 'year' : 'month';
    const promoInfo =
      interval === 'month'
        ? await earlyPromoForOrg(org.id, org.subscription.promoMonthsUsed)
        : { eligible: false };
    const quote = quotePlan(plan, interval, { promo: promoInfo.eligible });
    const payment = await prisma.payment.create({
      data: {
        organizationId: org.id,
        plan,
        amountRub: quote.amountRub,
        status: 'PENDING',
        metadata: {
          createdByUserId: req.user.id,
          via: 'pay-alias',
          savePaymentMethod: false,
          interval,
          promo: quote.promo,
        },
      },
    });

    const yk = await createPayment({
      amountRub: quote.amountRub,
      description: planCheckoutDescription(plan, interval),
      returnUrl: paymentReturnUrl(payment.id),
      savePaymentMethod: false,
      metadata: {
        organizationId: String(org.id),
        plan,
        localPaymentId: String(payment.id),
      },
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        yookassaPaymentId: yk.id,
        confirmationUrl: yk.confirmationUrl,
      },
    });

    return res.json({
      payment: {
        id: updated.id,
        plan: updated.plan,
        amountRub: updated.amountRub,
        status: updated.status,
        confirmationUrl: updated.confirmationUrl,
        demo: isYookassaDemo() || Boolean(yk.demo),
      },
      confirmationUrl: updated.confirmationUrl,
      message: yk.demo
        ? 'Демо-режим: подтвердите оплату'
        : 'Перейдите по ссылке для оплаты',
      requiresRedirect: true,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.post('/salons', requireWrite, requireOrgAdmin, async (req, res, next) => {
  try {
    const { assertCanCreateSalon } = await import('../services/plans.js');
    const org = await loadOrgBundle(req.user.organizationId);
    if (!org?.subscription) return res.status(400).json({ error: 'Нет подписки' });
    assertSubscriptionActive(org.subscription);
    assertCanCreateSalon(org.subscription, org.salons.length);

    const name = String(req.body.name || '').trim();
    const slug = String(req.body.slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });

    const salon = await prisma.salon.create({
      data: { name, slug, organizationId: org.id },
    });
    return res.status(201).json({ salon });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Slug already exists' });
    return next(err);
  }
});

export default router;
