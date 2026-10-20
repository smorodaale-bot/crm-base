import { prisma } from '../db.js';
import { isTelegramNetworkError, sendTelegramMessage } from './telegram.js';

function publicAppUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.CORS_ORIGIN ||
    'https://nova-crm.online'
  ).replace(/\/$/, '');
}

function absoluteLink(link) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const path = link.startsWith('/') ? link : `/${link}`;
  return `${publicAppUrl()}${path}`;
}

/** Round-robin: manager with fewest open deals (optionally within organization). */
export async function pickManagerId(preferredId, { organizationId } = {}) {
  const orgFilter = organizationId ? { organizationId } : {};

  if (preferredId) {
    const u = await prisma.user.findFirst({
      where: {
        id: preferredId,
        deletedAt: null,
        role: { in: ['MANAGER', 'SUPERVISOR', 'ADMIN'] },
        ...orgFilter,
      },
    });
    if (u) return u.id;
  }

  const managers = await prisma.user.findMany({
    where: { deletedAt: null, role: 'MANAGER', ...orgFilter },
    select: { id: true },
  });
  if (!managers.length) {
    const any = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        role: { in: ['SUPERVISOR', 'ADMIN'] },
        ...orgFilter,
      },
      select: { id: true },
    });
    if (!any) throw new Error('No managers available');
    return any.id;
  }

  const openCounts = await prisma.deal.groupBy({
    by: ['responsibleId'],
    where: {
      deletedAt: null,
      stage: { notIn: ['WON', 'LOST'] },
      responsibleId: { in: managers.map((m) => m.id) },
    },
    _count: { _all: true },
  });
  const map = Object.fromEntries(openCounts.map((r) => [r.responsibleId, r._count._all]));
  managers.sort((a, b) => (map[a.id] || 0) - (map[b.id] || 0));
  return managers[0].id;
}

/**
 * Prefer the org Telegram bot (Орг → Каналы) so the director configures everything in CRM.
 * Platform TELEGRAM_BOT_TOKEN is only a fallback.
 */
export async function resolveNotifyBot(user) {
  if (user?.organizationId) {
    const org = await prisma.organization.findFirst({
      where: { id: user.organizationId },
      select: {
        telegramBotToken: true,
        telegramBotUsername: true,
        telegramConnectedAt: true,
      },
    });
    if (org?.telegramBotToken) {
      return {
        botToken: org.telegramBotToken,
        botUsername: org.telegramBotUsername || null,
        source: 'org',
      };
    }
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: null,
      source: 'env',
    };
  }
  return null;
}

/**
 * In-app notification + Telegram via org bot (Worker fallback if VPS blocked).
 */
export async function notifyUser(userId, { title, body, link }) {
  const notification = await prisma.notification.create({
    data: { userId, title, body, link },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.telegramChatId) {
    const bot = await resolveNotifyBot(user);
    if (bot?.botToken) {
      try {
        const href = absoluteLink(link);
        const text = `${title}${body ? `\n${body}` : ''}${href ? `\n${href}` : ''}`;
        await sendTelegramMessage(bot.botToken, {
          chatId: user.telegramChatId,
          text,
        });
      } catch (err) {
        console.warn('Telegram notify failed', err.message);
      }
    } else {
      console.warn(
        'Telegram notify skipped: connect org Telegram bot in Channels (or set TELEGRAM_BOT_TOKEN)'
      );
    }
  }

  return notification;
}

export async function notifySupervisors(payload, { organizationId, excludeUserId } = {}) {
  const bosses = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { in: ['SUPERVISOR', 'ADMIN'] },
      ...(organizationId ? { organizationId } : {}),
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  await Promise.all(bosses.map((b) => notifyUser(b.id, payload)));
}

/** Responsible manager + supervisors in org (CRM bell + Telegram). */
export async function notifyLeadAssigned(managerId, payload, { organizationId } = {}) {
  await notifyUser(managerId, payload);
  if (organizationId) {
    await notifySupervisors(payload, { organizationId, excludeUserId: managerId });
  }
}

/**
 * Send a one-off Telegram probe for the current user (no CRM notification spam).
 * Returns { ok, error?, botUsername? } for the Profile "test" button.
 */
export async function testUserTelegram(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: 'Пользователь не найден' };
  if (!user.telegramChatId) {
    return { ok: false, error: 'Сначала сохраните Telegram Chat ID в профиле' };
  }

  const bot = await resolveNotifyBot(user);
  if (!bot?.botToken) {
    return {
      ok: false,
      error:
        'Подключите Telegram-бота салона: Орг → Каналы → Telegram. Тот же бот шлёт уведомления руководителю и менеджерам.',
    };
  }

  try {
    await sendTelegramMessage(bot.botToken, {
      chatId: user.telegramChatId,
      text: 'Тест Nova CRM\nУведомления о новых лидах будут приходить в этот чат.',
    });
    return { ok: true, botUsername: bot.botUsername, source: bot.source };
  } catch (err) {
    const msg = String(err.message || '');
    if (/forbidden|can't initiate|bot was blocked|chat not found/i.test(msg)) {
      const who = bot.botUsername ? `@${bot.botUsername}` : 'бота салона';
      return {
        ok: false,
        error: `Откройте ${who} в Telegram и нажмите Start, затем повторите тест.`,
        botUsername: bot.botUsername,
      };
    }
    if (isTelegramNetworkError(err) || /fetch failed|TELEGRAM_WORKER_URL|Worker/i.test(msg)) {
      return {
        ok: false,
        error:
          msg.includes('TELEGRAM_WORKER_URL') || msg.includes('Worker')
            ? msg
            : 'Сервер не достучался до Telegram. Проверьте, что бот салона подключён в «Орг → Каналы» (через Worker), и повторите тест.',
        botUsername: bot.botUsername,
      };
    }
    return {
      ok: false,
      error: msg && msg !== 'fetch failed' ? msg : 'Не удалось отправить в Telegram',
      botUsername: bot.botUsername,
    };
  }
}
