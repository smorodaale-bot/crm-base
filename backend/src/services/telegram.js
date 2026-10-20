import crypto from 'crypto';

function publicApiBase() {
  return (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
}

export function maskBotToken(token) {
  if (!token) return null;
  if (token.length < 12) return '••••••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function newTelegramWebhookSecret() {
  return crypto.randomBytes(24).toString('hex');
}

export function telegramWorkerBase() {
  return (process.env.TELEGRAM_WORKER_URL || '').replace(/\/$/, '');
}

/** Inbound updates always land on our API. Worker is only an outbound fallback. */
export function telegramWebhookUrl(organizationId) {
  return `${publicApiBase()}/api/webhooks/telegram/${organizationId}`;
}

export function isTelegramNetworkError(err) {
  const msg = String(err?.message || err || '');
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    msg.includes('fetch failed') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('network')
  );
}

export function buildSetWebhookCurl({ botToken, organizationId, secret }) {
  const url = telegramWebhookUrl(organizationId);
  return `curl.exe -s "https://api.telegram.org/bot${botToken}/setWebhook" -d "url=${url}" -d "secret_token=${secret}" -d "allowed_updates=[\\"message\\",\\"edited_message\\"]"`;
}

/** Open on phone (mobile data / VPN) if Worker setup also failed. Includes secret_token. */
export function buildSetWebhookPhoneUrl({ botToken, organizationId, secret }) {
  const url = telegramWebhookUrl(organizationId);
  const u = new URL(`https://api.telegram.org/bot${botToken}/setWebhook`);
  u.searchParams.set('url', url);
  if (secret) u.searchParams.set('secret_token', secret);
  return u.toString();
}

export async function telegramApi(botToken, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const desc = data.description || `Telegram API error (${res.status})`;
      const err = new Error(desc);
      err.telegram = data;
      throw err;
    }
    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Таймаут запроса к api.telegram.org');
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Cloudflare Worker to call Telegram setWebhook (Worker can reach api.telegram.org).
 */
export async function setWebhookViaWorker({ botToken, organizationId, secret }) {
  const workerBase = telegramWorkerBase();
  if (!workerBase) {
    const err = new Error('TELEGRAM_WORKER_URL not configured');
    err.code = 'NO_WORKER';
    throw err;
  }
  const setupKey =
    process.env.TELEGRAM_WORKER_SETUP_SECRET || 'nova-crm-tg-setup-smoroda-2026';
  const res = await fetch(`${workerBase}/setup-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nova-Setup-Key': setupKey,
    },
    body: JSON.stringify({
      botToken,
      url: telegramWebhookUrl(organizationId),
      secret,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `Worker setWebhook failed (${res.status})`);
    err.worker = data;
    throw err;
  }
  return {
    username: data.username || null,
    webhookUrl: data.webhookUrl || telegramWebhookUrl(organizationId),
    via: 'worker',
  };
}

export async function deleteWebhookViaWorker(botToken) {
  const workerBase = telegramWorkerBase();
  if (!workerBase || !botToken) return;
  const setupKey =
    process.env.TELEGRAM_WORKER_SETUP_SECRET || 'nova-crm-tg-setup-smoroda-2026';
  try {
    await fetch(`${workerBase}/delete-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nova-Setup-Key': setupKey,
      },
      body: JSON.stringify({ botToken }),
    });
  } catch (err) {
    console.warn('Worker deleteWebhook failed', err.message);
  }
}

/**
 * Connect: try Telegram from VPS, on network error fall back to Worker setup.
 */
export async function connectTelegramWebhook({ botToken, organizationId, secret }) {
  try {
    const me = await telegramApi(botToken, 'getMe', {});
    const username = me.username || null;
    await telegramApi(botToken, 'setWebhook', {
      url: telegramWebhookUrl(organizationId),
      secret_token: secret,
      allowed_updates: ['message', 'edited_message'],
      drop_pending_updates: true,
    });
    return { username, webhookUrl: telegramWebhookUrl(organizationId), via: 'direct' };
  } catch (err) {
    if (!isTelegramNetworkError(err)) throw err;
    return setWebhookViaWorker({ botToken, organizationId, secret });
  }
}

/**
 * Send text to a Telegram chat. Tries api.telegram.org from VPS,
 * falls back to Cloudflare Worker when the network is blocked.
 */
export async function sendTelegramMessage(botToken, { chatId, text, reply_markup }) {
  const payload = {
    chat_id: chatId,
    text: String(text || '').slice(0, 4000),
    ...(reply_markup ? { reply_markup } : {}),
  };
  try {
    return await telegramApi(botToken, 'sendMessage', payload);
  } catch (err) {
    if (!isTelegramNetworkError(err)) throw err;
    return sendTelegramMessageViaWorker(botToken, payload);
  }
}

export async function sendTelegramMessageViaWorker(botToken, payload) {
  const workerBase = telegramWorkerBase();
  if (!workerBase) {
    const err = new Error(
      'Не удалось отправить в Telegram: VPS не достучится до api.telegram.org и TELEGRAM_WORKER_URL не задан'
    );
    err.status = 502;
    throw err;
  }
  const setupKey =
    process.env.TELEGRAM_WORKER_SETUP_SECRET || 'nova-crm-tg-setup-smoroda-2026';
  const res = await fetch(`${workerBase}/send-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nova-Setup-Key': setupKey,
    },
    body: JSON.stringify({ botToken, ...payload }),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw?.slice(0, 200) || `HTTP ${res.status}` };
  }
  if (!res.ok || data.ok === false) {
    const detail = data.error || data.description || data.message || raw?.slice(0, 200);
    const err = new Error(
      String(detail || '').includes('orgId required')
        ? 'Cloudflare Worker устарел: задеплойте telegram-worker.js с маршрутом /send-message'
        : detail || `Worker sendMessage failed (${res.status})`
    );
    err.status = 502;
    err.telegram = data;
    throw err;
  }
  return data.result || data;
}

export async function disconnectTelegramWebhook(botToken) {
  if (!botToken) return;
  try {
    await telegramApi(botToken, 'deleteWebhook', { drop_pending_updates: true });
  } catch (err) {
    if (isTelegramNetworkError(err)) {
      await deleteWebhookViaWorker(botToken);
      return;
    }
    console.warn('Telegram deleteWebhook failed', err.message);
  }
}
