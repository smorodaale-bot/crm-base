import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { sendOtpEmail, maskEmail, emailConfigured } from './email.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function createAndSendOtp({ email, purpose, payload = null }) {
  const normalized = email.toLowerCase();
  const recent = await prisma.emailOtp.findFirst({
    where: { email: normalized },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_MS) {
    const err = new Error('Подождите минуту перед повторной отправкой кода');
    err.status = 429;
    throw err;
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.emailOtp.updateMany({
    where: { email: normalized, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma.emailOtp.create({
    data: {
      email: normalized,
      purpose,
      codeHash,
      payload: payload ?? undefined,
      expiresAt,
    },
  });

  const mail = await sendOtpEmail(normalized, code, purpose === 'REGISTER_ORG' ? 'register' : 'login');
  // OTP_DEV_CODE is ignored in production.
  const exposeDevCode =
    !isProduction() &&
    (!emailConfigured() || !mail.sent || process.env.OTP_DEV_CODE === 'true');

  if (!mail.sent && isProduction()) {
    console.error(
      `[otp] письмо не отправлено purpose=${purpose} to=${maskEmail(normalized)} mode=${mail.mode} error=${mail.error || ''}`
    );
    const err = new Error('Не удалось отправить письмо с кодом, попробуйте позже');
    err.status = 503;
    err.expose = true;
    throw err;
  }

  return {
    emailMasked: maskEmail(normalized),
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    sent: mail.sent,
    mode: mail.mode,
    ...(exposeDevCode ? { devCode: code } : {}),
  };
}

export async function verifyOtp({ email, purpose, code }) {
  const record = await prisma.emailOtp.findFirst({
    where: {
      email: email.toLowerCase(),
      purpose,
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    const err = new Error('Код не найден или уже использован. Запросите новый.');
    err.status = 400;
    throw err;
  }

  if (record.expiresAt < new Date()) {
    await prisma.emailOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    const err = new Error('Код истёк. Запросите новый.');
    err.status = 400;
    throw err;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    const err = new Error('Слишком много попыток. Запросите новый код.');
    err.status = 429;
    throw err;
  }

  const ok = await bcrypt.compare(String(code).trim(), record.codeHash);
  if (!ok) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    const err = new Error('Неверный код подтверждения');
    err.status = 400;
    throw err;
  }

  await prisma.emailOtp.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return record;
}
