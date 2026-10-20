import { prisma } from '../db.js';
import { createInboundLead } from './leads.js';
import { normalizePhone } from '../utils/phone.js';

export const DEFAULT_TELEGRAM_BOT_CONFIG = {
  enabled: true,
  welcome:
    'Здравствуйте! Я бот автосалона. Ответьте на несколько вопросов — менеджер свяжется с вами.',
  askPhone: true,
  phonePrompt: 'Отправьте номер телефона кнопкой ниже или напишите его текстом (+7…).',
  questions: [
    {
      id: 'need',
      text: 'Что вас интересует?',
      options: ['Купить авто', 'Trade-in', 'Кредит', 'Запись на просмотр'],
    },
    {
      id: 'budget',
      text: 'Какой примерно бюджет?',
      options: ['до 1 млн', '1–2 млн', '2–3 млн', 'от 3 млн', 'Пока не знаю'],
    },
  ],
  doneMessage: 'Спасибо! Заявка принята. Менеджер скоро свяжется с вами.',
};

export function normalizeBotConfig(raw) {
  const base = { ...DEFAULT_TELEGRAM_BOT_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  const questions = Array.isArray(base.questions)
    ? base.questions
        .slice(0, 5)
        .map((q, i) => ({
          id: String(q.id || `q${i + 1}`).slice(0, 40),
          text: String(q.text || '').trim().slice(0, 300),
          options: Array.isArray(q.options)
            ? q.options.map((o) => String(o).trim().slice(0, 60)).filter(Boolean).slice(0, 6)
            : [],
        }))
        .filter((q) => q.text)
    : DEFAULT_TELEGRAM_BOT_CONFIG.questions;

  return {
    enabled: base.enabled !== false,
    welcome: String(base.welcome || DEFAULT_TELEGRAM_BOT_CONFIG.welcome).slice(0, 500),
    askPhone: base.askPhone !== false,
    phonePrompt: String(base.phonePrompt || DEFAULT_TELEGRAM_BOT_CONFIG.phonePrompt).slice(0, 300),
    questions,
    doneMessage: String(base.doneMessage || DEFAULT_TELEGRAM_BOT_CONFIG.doneMessage).slice(0, 500),
  };
}

function phoneKeyboard() {
  return {
    keyboard: [[{ text: 'Отправить телефон', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function optionsKeyboard(options) {
  if (!options?.length) return { remove_keyboard: true };
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2).map((t) => ({ text: t })));
  }
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: true };
}

function reply(text, reply_markup) {
  return { text, ...(reply_markup ? { reply_markup } : { reply_markup: { remove_keyboard: true } }) };
}

async function getOrCreateDialog(organizationId, chatId, userId) {
  return prisma.telegramDialog.upsert({
    where: {
      organizationId_telegramChatId: {
        organizationId,
        telegramChatId: String(chatId),
      },
    },
    create: {
      organizationId,
      telegramChatId: String(chatId),
      telegramUserId: userId ? String(userId) : null,
      step: 'welcome',
      answers: {},
    },
    update: {
      telegramUserId: userId ? String(userId) : undefined,
    },
  });
}

/**
 * Process inbound Telegram message for org bot script.
 * Returns replies for Worker to send via Bot API.
 */
export async function processTelegramDialog({ organization, message, channel = 'TELEGRAM' }) {
  const config = normalizeBotConfig(
    channel === 'MAX' ? organization.maxBotConfig || organization.telegramBotConfig : organization.telegramBotConfig
  );
  const chatId = message.chat?.id;
  const from = message.from || {};
  const text = String(message.text || message.caption || '').trim();
  const contactPhone = message.contact?.phone_number || null;
  const isStart = /^\/start\b/i.test(text);
  const botToken = channel === 'MAX' ? organization.maxBotToken : organization.telegramBotToken;
  const sourceLabel = channel === 'MAX' ? 'MAX' : 'Telegram';

  if (!config.enabled) {
    return legacyInstantLead({ organization, message, text, contactPhone, from, channel, botToken, sourceLabel });
  }

  let dialog = await getOrCreateDialog(organization.id, chatId, from.id);
  let answers = dialog.answers && typeof dialog.answers === 'object' ? { ...dialog.answers } : {};
  let step = dialog.step || 'welcome';

  if (isStart) {
    step = 'welcome';
    answers = {};
    await prisma.telegramDialog.update({
      where: { id: dialog.id },
      data: { step: 'welcome', answers: {}, dealId: null },
    });
  } else if (step === 'done' && dialog.dealId) {
    const open = await prisma.deal.findFirst({
      where: { id: dialog.dealId, deletedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      select: { id: true },
    });
    if (open) {
      const externalId = `${channel === 'MAX' ? 'max' : 'tg'}:${organization.id}:${message.message_id || Date.now()}`;
      const exists = await prisma.chatMessage.findFirst({ where: { externalId } });
      if (!exists && text) {
        await prisma.chatMessage.create({
          data: {
            dealId: open.id,
            body: text,
            channel,
            direction: 'in',
            externalId,
          },
        });
      }
      return { replies: [], dealId: open.id, botToken };
    }
  } else if (step === 'done') {
    step = 'welcome';
    answers = {};
    await prisma.telegramDialog.update({
      where: { id: dialog.id },
      data: { step: 'welcome', answers: {} },
    });
  }

  const replies = [];
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(' ') ||
    from.username ||
    `Клиент ${sourceLabel}`;

  // State machine
  if (step === 'welcome') {
    replies.push(reply(config.welcome));
    if (config.askPhone) {
      step = 'phone';
      replies.push(reply(config.phonePrompt, phoneKeyboard()));
    } else if (config.questions.length) {
      step = `q:0`;
      const q = config.questions[0];
      replies.push(reply(q.text, optionsKeyboard(q.options)));
    } else {
      const created = await finishLead({ organization, name, from, answers, text, contactPhone, channel, chatId });
      step = 'done';
      replies.push(reply(config.doneMessage));
      await prisma.telegramDialog.update({
        where: { id: dialog.id },
        data: { step, answers, dealId: created.dealId },
      });
      return { replies, dealId: created.dealId, botToken };
    }
  } else if (step === 'phone') {
    const phoneRaw =
      contactPhone ||
      text.match(/(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/)?.[0] ||
      null;
    if (!phoneRaw) {
      replies.push(reply('Не вижу номер. Нажмите кнопку «Отправить телефон» или напишите +7…', phoneKeyboard()));
    } else {
      try {
        answers.phone = normalizePhone(phoneRaw);
      } catch {
        replies.push(reply('Номер похож на неверный. Попробуйте ещё раз в формате +79001234567.', phoneKeyboard()));
        await prisma.telegramDialog.update({ where: { id: dialog.id }, data: { step, answers } });
        return { replies, botToken };
      }
      if (config.questions.length) {
        step = 'q:0';
        const q = config.questions[0];
        replies.push(reply(q.text, optionsKeyboard(q.options)));
      } else {
        const created = await finishLead({ organization, name, from, answers, text, contactPhone, channel, chatId });
        step = 'done';
        replies.push(reply(config.doneMessage));
        await prisma.telegramDialog.update({
          where: { id: dialog.id },
          data: { step, answers, dealId: created.dealId },
        });
        return { replies, dealId: created.dealId, botToken };
      }
    }
  } else if (step.startsWith('q:')) {
    const idx = Number(step.slice(2));
    const q = config.questions[idx];
    if (!q) {
      step = 'welcome';
    } else if (!text) {
      replies.push(reply(q.text, optionsKeyboard(q.options)));
    } else {
      answers[q.id] = text.slice(0, 200);
      const next = idx + 1;
      if (next < config.questions.length) {
        step = `q:${next}`;
        const nq = config.questions[next];
        replies.push(reply(nq.text, optionsKeyboard(nq.options)));
      } else {
        const created = await finishLead({ organization, name, from, answers, text, contactPhone, channel, chatId });
        step = 'done';
        replies.push(reply(config.doneMessage));
        await prisma.telegramDialog.update({
          where: { id: dialog.id },
          data: { step, answers, dealId: created.dealId },
        });
        return { replies, dealId: created.dealId, botToken };
      }
    }
  }

  await prisma.telegramDialog.update({
    where: { id: dialog.id },
    data: { step, answers },
  });

  return { replies, botToken };
}

async function finishLead({ organization, name, from, answers, text, contactPhone, channel = 'TELEGRAM', chatId = null }) {
  let phone;
  if (answers.phone) {
    phone = answers.phone;
  } else {
    const phoneRaw =
      contactPhone ||
      String(text || '').match(/(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/)?.[0] ||
      null;
    phone = phoneRaw
      ? normalizePhone(phoneRaw)
      : normalizePhone(`7999${String(from.id).padStart(7, '0').slice(-7)}`);
  }

  const answerLines = Object.entries(answers)
    .filter(([k]) => k !== 'phone')
    .map(([k, v]) => `${k}: ${v}`);
  const sourceLabel = channel === 'MAX' ? 'MAX' : 'Telegram';
  const idPrefix = channel === 'MAX' ? 'max' : 'tg';
  const comment = [
    `Диалог ${sourceLabel}`,
    ...answerLines,
    from.username ? `@${from.username}` : null,
    `${idPrefix}_id:${from.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const initialMessage = answerLines.length
    ? answerLines.join('\n')
    : text || 'Клиент прошёл опрос бота';

  const result = await createInboundLead({
    name,
    phone,
    organizationId: organization.id,
    comment,
    source: sourceLabel,
    notifyTitle: `Новый лид из ${sourceLabel}`,
    initialMessage,
    messageChannel: channel,
    messageExternalId: `${idPrefix}-dialog:${organization.id}:${from.id}:${Date.now()}`,
    externalChatId: chatId != null ? String(chatId) : null,
  });

  return { dealId: result.deal.id };
}

async function legacyInstantLead({
  organization,
  message,
  text,
  contactPhone,
  from,
  channel = 'TELEGRAM',
  botToken,
  sourceLabel = 'Telegram',
}) {
  const phoneRaw =
    contactPhone ||
    text.match(/(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/)?.[0] ||
    null;
  if (!phoneRaw && !from.id) {
    return { replies: [], ignored: true };
  }
  const phone = phoneRaw
    ? normalizePhone(phoneRaw)
    : normalizePhone(`7999${String(from.id).padStart(7, '0').slice(-7)}`);
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(' ') ||
    from.username ||
    `Клиент ${sourceLabel}`;
  const idPrefix = channel === 'MAX' ? 'max' : 'tg';
  const externalId = `${idPrefix}:${organization.id}:${message.message_id || Date.now()}`;
  const chatKey = String(message.chat?.id || (channel === 'MAX' ? `max:${from.id}` : from.id));
  const exists = await prisma.chatMessage.findFirst({ where: { externalId } });
  if (exists) return { replies: [], duplicate: true };

  const result = await createInboundLead({
    name,
    phone,
    organizationId: organization.id,
    comment: text || `Сообщение из ${sourceLabel}`,
    source: sourceLabel,
    idempotencyKey: externalId,
    notifyTitle: `Новый лид из ${sourceLabel}`,
    initialMessage: text || `Клиент написал в ${sourceLabel}`,
    messageChannel: channel,
    messageExternalId: externalId,
    externalChatId: chatKey,
  });

  await prisma.telegramDialog.upsert({
    where: {
      organizationId_telegramChatId: {
        organizationId: organization.id,
        telegramChatId: chatKey,
      },
    },
    create: {
      organizationId: organization.id,
      telegramChatId: chatKey,
      telegramUserId: from.id ? String(from.id) : null,
      step: 'done',
      answers: {},
      dealId: result.deal.id,
    },
    update: { dealId: result.deal.id, step: 'done' },
  });

  return {
    replies: [
      reply('Спасибо! Заявка принята. Менеджер скоро свяжется с вами.'),
    ],
    dealId: result.deal.id,
    botToken,
  };
}
