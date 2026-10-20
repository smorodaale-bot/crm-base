import crypto from 'crypto';

const MAX_API = 'https://platform-api2.max.ru';

function publicAppUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
}

export function maxWebhookUrl(organizationId) {
  return `${publicAppUrl()}/api/webhooks/max/${organizationId}`;
}

export function newMaxWebhookSecret() {
  return crypto.randomBytes(16).toString('hex');
}

export function maskMaxToken(token) {
  if (!token) return null;
  if (token.length < 12) return '••••••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function normalizeMaxToken(token) {
  return String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function authHeaders(token) {
  return {
    Authorization: normalizeMaxToken(token),
    'Content-Type': 'application/json',
  };
}

export async function maxApi(token, method, path, { query, body } = {}) {
  const url = new URL(path, `${MAX_API}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: authHeaders(token),
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const e = new Error(
      `Не удалось связаться с MAX API (${err.message}). Проверьте доступ сервера к platform-api2.max.ru`
    );
    e.status = 502;
    e.max = { network: true };
    throw e;
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text?.slice(0, 200) || `MAX API ${res.status}` };
  }
  if (!res.ok) {
    const err = new Error(
      data.message || data.error || data.title || `MAX API ${res.status}`
    );
    err.status = res.status;
    err.max = data;
    throw err;
  }
  return data;
}

export async function getMaxBot(token) {
  return maxApi(token, 'GET', '/me');
}

export async function listMaxSubscriptions(token) {
  const data = await maxApi(token, 'GET', '/subscriptions');
  return Array.isArray(data.subscriptions) ? data.subscriptions : [];
}

export async function deleteMaxSubscription(token, url) {
  try {
    await maxApi(token, 'DELETE', '/subscriptions', { query: { url } });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export async function subscribeMaxWebhook(token, { url, secret }) {
  return maxApi(token, 'POST', '/subscriptions', {
    body: {
      url,
      update_types: ['message_created', 'message_callback', 'bot_started'],
      secret,
    },
  });
}

export async function sendMaxMessage(token, { userId, chatId, text, attachments }) {
  const query = {};
  if (userId) query.user_id = userId;
  else if (chatId) query.chat_id = chatId;
  const body = { text: String(text || '').slice(0, 4000) };
  if (attachments?.length) body.attachments = attachments;
  return maxApi(token, 'POST', '/messages', { query, body });
}

export async function answerMaxCallback(token, callbackId, { notification } = {}) {
  if (!callbackId) return;
  try {
    await maxApi(token, 'POST', '/answers', {
      query: { callback_id: callbackId },
      body: notification ? { notification } : {},
    });
  } catch (err) {
    console.warn('MAX callback answer:', err.message);
  }
}

export async function connectMaxWebhook({ botToken, organizationId, secret }) {
  const me = await getMaxBot(botToken);
  if (me.is_bot === false) {
    const err = new Error('Токен не принадлежит боту MAX');
    err.status = 400;
    err.max = me;
    throw err;
  }
  const url = maxWebhookUrl(organizationId);
  try {
    const existing = await listMaxSubscriptions(botToken);
    for (const sub of existing) {
      if (sub.url) await deleteMaxSubscription(botToken, sub.url);
    }
  } catch (err) {
    console.warn('MAX list/delete subscriptions:', err.message);
  }
  const result = await subscribeMaxWebhook(botToken, { url, secret });
  if (result.success === false) {
    const err = new Error(result.message || 'MAX отклонил подписку на webhook');
    err.status = 400;
    err.max = result;
    throw err;
  }
  return {
    username: me.username || me.user?.username || null,
    name: me.first_name || me.name || me.user?.first_name || null,
    webhookUrl: url,
  };
}

export async function disconnectMaxWebhook(botToken) {
  if (!botToken) return;
  try {
    const existing = await listMaxSubscriptions(botToken);
    for (const sub of existing) {
      if (sub.url) await deleteMaxSubscription(botToken, sub.url);
    }
  } catch (err) {
    console.warn('MAX disconnect webhook:', err.message);
  }
}

export function telegramReplyToMaxAttachments(replyMarkup) {
  if (!replyMarkup || replyMarkup.remove_keyboard) return undefined;
  const rows = replyMarkup.keyboard;
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const buttons = rows.map((row) =>
    (row || []).map((btn) => {
      if (btn.request_contact) {
        return { type: 'request_contact', text: btn.text || 'Отправить телефон' };
      }
      // type "message" sends the button text as a normal chat message (like Telegram reply keyboard)
      const text = String(btn.text || '').slice(0, 64);
      return { type: 'message', text };
    })
  );
  return [{ type: 'inline_keyboard', payload: { buttons } }];
}

export async function sendMaxReplies(token, { userId, chatId, replies }) {
  const list = Array.isArray(replies) ? replies : [];
  for (const item of list) {
    const attachments = telegramReplyToMaxAttachments(item.reply_markup);
    await sendMaxMessage(token, {
      userId,
      chatId: userId ? undefined : chatId,
      text: item.text,
      attachments,
    });
    await new Promise((r) => setTimeout(r, 450));
  }
}
