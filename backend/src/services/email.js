import nodemailer from 'nodemailer';

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.SMTP_USER);
}

let transporterPromise = null;

async function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporterPromise) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure =
      process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE !== 'false' && port === 465);

    // family: 4 — на многих VPS IPv6 к smtp.gmail.com даёт "Unexpected socket close"
    // Короткие таймауты: иначе логин висит на «Отправка...» минутами
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        requireTLS: !secure,
        family: 4,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
        tls: {
          minVersion: 'TLSv1.2',
          servername: process.env.SMTP_HOST,
        },
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        },
      })
    );
  }
  return transporterPromise;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timeout after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function resetTransporter() {
  transporterPromise = null;
}

const SUPPORT_EMAIL_DEFAULT = 'support@nova-crm.online';

export function supportAddress() {
  const value = String(process.env.SUPPORT_EMAIL || SUPPORT_EMAIL_DEFAULT).trim();
  return value || SUPPORT_EMAIL_DEFAULT;
}

function supportLine() {
  return `Вопросы — ${supportAddress()}`;
}

function appendSupportText(text) {
  const line = supportLine();
  const body = String(text || '').trimEnd();
  if (!body) return line;
  if (body.includes(line)) return body;
  return `${body}\n\n${line}`;
}

function appendSupportHtml(html) {
  if (!html) return undefined;
  const line = supportLine();
  if (String(html).includes(line)) return html;
  const email = supportAddress().replace(/[<>"']/g, '');
  return `${html}\n<p style="color:#666;font-size:13px;margin-top:24px">Вопросы — <a href="mailto:${email}">${email}</a></p>`;
}

export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * Sends email. Returns { sent: boolean, mode: string }.
 * Without SMTP logs to console (caller may expose code in dev).
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function allowDevSecrets() {
  return !isProduction();
}

export async function sendEmail({ to, subject, text, html }) {
  const bodyText = appendSupportText(text);
  const bodyHtml = appendSupportHtml(html);
  const from = process.env.SMTP_FROM;
  const replyTo = /noreply@/i.test(String(from || '')) ? supportAddress() : undefined;
  const transporter = await getTransporter();
  if (!transporter) {
    if (isProduction()) {
      console.error(`[email] SMTP не настроен, письмо не отправлено to=${to} subject=${subject}`);
    } else {
      console.log(`[email:dev] to=${to} subject=${subject}\n${bodyText}`);
    }
    return { sent: false, mode: 'console', error: 'SMTP not configured' };
  }

  try {
    const info = await withTimeout(
      transporter.sendMail({
        from,
        replyTo,
        to,
        subject,
        text: bodyText,
        html: bodyHtml,
      }),
      15000,
      'SMTP sendMail'
    );

    console.log(`[email] sent to=${to} id=${info.messageId}`);
    return {
      sent: true,
      mode: 'smtp',
      messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl?.(info) || null,
    };
  } catch (err) {
    console.error('[email] send failed:', err?.message || err, `to=${to} subject=${subject}`);
    resetTransporter();
    if (!isProduction()) {
      console.log(`[email:fallback] to=${to} subject=${subject}\n${bodyText}`);
    }
    return { sent: false, mode: 'failed', error: err?.message || String(err) };
  }
}

/** Verify SMTP login/connection (for diagnostics on server). */
export async function verifySmtp() {
  if (!smtpConfigured()) {
    return {
      ok: false,
      error: 'SMTP_HOST / SMTP_FROM / SMTP_USER не заданы',
      hint: 'Проверьте backend/.env',
    };
  }
  const transporter = await getTransporter();
  try {
    await transporter.verify();
    return {
      ok: true,
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER,
    };
  } catch (err) {
    resetTransporter();
    return {
      ok: false,
      error: err?.message || String(err),
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      hint: 'На VPS чаще всего помогает SMTP_PORT=587 и SMTP_SECURE=false',
    };
  }
}

export async function sendResetEmail(to, link) {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const subject = `${brand}: сброс пароля`;
  const text = `Ссылка для нового пароля (действует 1 час):\n${link}\n\nЕсли вы не запрашивали сброс — проигнорируйте письмо.`;
  return sendEmail({ to, subject, text });
}

export async function sendInviteEmail(to, { orgName, link, roleLabel }) {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const subject = `${brand}: приглашение в ${orgName}`;
  const text = `Вас пригласили в салон «${orgName}» (${roleLabel}).\n\nПринять приглашение:\n${link}\n\nСсылка действует 7 дней.`;
  return sendEmail({ to, subject, text });
}

export async function sendOtpEmail(to, code, purpose = 'login') {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const subject =
    purpose === 'register'
      ? `${brand}: код подтверждения регистрации`
      : `${brand}: код подтверждения входа`;
  const text = `Ваш код подтверждения: ${code}\n\nКод действует 10 минут.\nЕсли вы не запрашивали вход — проигнорируйте письмо.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">${brand}</h2>
      <p>Ваш код подтверждения:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
      <p style="color:#666">Код действует 10 минут.</p>
    </div>
  `;
  return sendEmail({ to, subject, text, html });
}

export async function sendPaymentReceiptEmail({
  to,
  orgName,
  planName,
  amountRub,
  periodEnd,
}) {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const amount = Number(amountRub).toLocaleString('ru-RU');
  const until = periodEnd
    ? new Date(periodEnd).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';
  const subject = `${brand}: оплата тарифа ${planName} принята`;
  const text = [
    `Оплата успешно получена.`,
    ``,
    `Организация: ${orgName}`,
    `Тариф: ${planName}`,
    `Сумма: ${amount} ₽`,
    `Подписка активна до: ${until}`,
    ``,
    `Спасибо, что пользуетесь ${brand}.`,
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <h2 style="margin:0 0 12px">${brand}</h2>
      <p>Оплата успешно получена.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Организация</td><td>${orgName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Тариф</td><td><strong>${planName}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Сумма</td><td>${amount} ₽</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Активна до</td><td>${until}</td></tr>
      </table>
      <p style="color:#666">Спасибо, что пользуетесь ${brand}.</p>
    </div>
  `;
  return sendEmail({ to, subject, text, html });
}

export async function sendSubscriptionReminderEmail({
  to,
  orgName,
  planName,
  periodEnd,
  renewUrl,
}) {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const until = periodEnd
    ? new Date(periodEnd).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';
  const link = renewUrl || 'https://nova-crm.online/org';
  const subject = `${brand}: подписка ${planName} заканчивается ${until}`;
  const text = [
    `Здравствуйте!`,
    ``,
    `Подписка организации «${orgName}» (тариф ${planName}) действует до ${until}.`,
    `Чтобы не потерять доступ, продлите тариф в личном кабинете:`,
    link,
    ``,
    `Если уже оплатили — просто проигнорируйте это письмо.`,
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <h2 style="margin:0 0 12px">${brand}</h2>
      <p>Подписка организации <strong>${orgName}</strong> (тариф <strong>${planName}</strong>) действует до <strong>${until}</strong>.</p>
      <p>Чтобы не потерять доступ, продлите тариф в личном кабинете.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#5932ea;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">Продлить подписку</a></p>
      <p style="color:#666;font-size:13px">Если уже оплатили — просто проигнорируйте это письмо.</p>
    </div>
  `;
  return sendEmail({ to, subject, text, html });
}

export async function sendSubscriptionRenewFailedEmail({
  to,
  orgName,
  planName,
  reason,
  renewUrl,
}) {
  const brand = process.env.APP_NAME || 'Nova CRM';
  const link = renewUrl || 'https://nova-crm.online/org';
  const subject = `${brand}: не удалось продлить подписку ${planName}`;
  const text = [
    `Не удалось автоматически продлить подписку организации «${orgName}» (тариф ${planName}).`,
    `Причина: ${reason || 'ошибка оплаты'}`,
    ``,
    `Пожалуйста, оплатите тариф вручную:`,
    link,
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <h2 style="margin:0 0 12px">${brand}</h2>
      <p>Не удалось автоматически продлить подписку организации <strong>${orgName}</strong> (тариф <strong>${planName}</strong>).</p>
      <p style="color:#666">Причина: ${reason || 'ошибка оплаты'}</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#5932ea;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">Оплатить вручную</a></p>
    </div>
  `;
  return sendEmail({ to, subject, text, html });
}

export function emailConfigured() {
  return smtpConfigured();
}
