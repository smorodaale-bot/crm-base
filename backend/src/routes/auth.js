import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  authenticate,
  clearRefreshCookie,
  clearTrustedDeviceCookie,
  findTrustedDevice,
  hashToken,
  issueRefreshToken,
  issueTrustedDevice,
  revokeAllRefreshTokens,
  revokeAllTrustedDevices,
  setRefreshCookie,
  setTrustedDeviceCookie,
  signAccessToken,
  attachSubscriptionMeta,
} from '../middleware/auth.js';
import { publicUser } from '../utils/helpers.js';
import { TRIAL_DAYS } from '../services/plans.js';
import { createAndSendOtp, verifyOtp } from '../services/otp.js';
import { allowDevSecrets, emailConfigured, sendResetEmail } from '../services/email.js';
import { config } from '../config.js';
import { assertSeatAvailable } from '../services/plans.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

const loginConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
});

const registerOrgSchema = z.object({
  organizationName: z.string().min(2).max(120),
  organizationSlug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug: только латиница, цифры и дефис'),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  passwordHash: z.string().min(20).optional(),
  phone: z.string().max(32).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  plan: z.enum(['START', 'BASIC', 'ADVANCED', 'ULTRA']).optional(),
  ownerRole: z.enum(['owner', 'admin']).optional(),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
  // Cloudflare + nginx add multiple X-Forwarded-For hops; skip strict ERL check
  validate: { xForwardedForHeader: false },
});

const otpPairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return `${req.ip}:${email}`;
  },
  message: { error: 'Слишком много попыток, попробуйте позже' },
});

async function loadUserWithOrg(userId) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { organization: { include: { subscription: true } } },
  });
}

async function buildSession(user, res, { remember = false } = {}) {
  const full = user.organization ? user : await loadUserWithOrg(user.id);
  const enriched = attachSubscriptionMeta(full);
  const accessToken = signAccessToken(full);
  const refreshToken = await issueRefreshToken(full.id, { remember });
  setRefreshCookie(res, refreshToken, { remember });
  return { accessToken, user: publicUser(enriched) };
}

function appBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://nova-crm.online').replace(/\/$/, '');
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function suggestSlug(slug) {
  let suggested = `${slug}-2`;
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${slug}-${i}`;
    const taken = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!taken) {
      suggested = candidate;
      break;
    }
  }
  return suggested;
}

async function createTrialOrganization(tx, payload) {
  const email = String(payload.email || '').toLowerCase();
  const takenEmail = await tx.user.findUnique({ where: { email } });
  if (takenEmail) {
    const err = new Error('Email уже зарегистрирован');
    err.status = 409;
    throw err;
  }
  const takenSlug = await tx.organization.findUnique({ where: { slug: payload.organizationSlug } });
  if (takenSlug) {
    const err = new Error('Slug организации уже занят');
    err.status = 409;
    throw err;
  }
  const owner = await tx.user.create({
    data: {
      email,
      name: payload.name,
      phone: payload.phone || null,
      passwordHash: payload.passwordHash,
      role: 'ADMIN',
      positionLabel: payload.ownerRole === 'admin' ? 'Администратор' : 'Владелец',
    },
  });
  const org = await tx.organization.create({
    data: {
      name: payload.organizationName,
      slug: payload.organizationSlug,
      city: payload.city || null,
      ownerId: owner.id,
    },
  });
  await tx.subscription.create({
    data: {
      organizationId: org.id,
      plan: payload.plan || 'BASIC',
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  const salon = await tx.salon.create({
    data: {
      name: `${payload.organizationName} — основной`,
      slug: `${payload.organizationSlug}-main`,
      organizationId: org.id,
    },
  });
  const updatedOwner = await tx.user.update({
    where: { id: owner.id },
    data: { organizationId: org.id, salonId: salon.id },
    include: { organization: { include: { subscription: true } } },
  });
  return { owner: updatedOwner, org };
}

router.get('/config', (_req, res) => {
  res.json({
    emailOtp: config.emailOtp,
    emailConfigured: emailConfigured(),
  });
});

function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Браузер';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

async function trustBrowser(res, userId, req) {
  const token = await issueTrustedDevice(userId, req.get('user-agent'));
  setTrustedDeviceCookie(res, token);
}

/** Step 1: password. Trusted device skips the email code. */
router.post('/login', loginLimiter, otpPairLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid credentials payload', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: { organization: { include: { subscription: true } } },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const remember = Boolean(parsed.data.remember);
    if (!config.emailOtp) {
      const session = await buildSession(user, res, { remember });
      return res.json({
        requiresOtp: false,
        token: session.accessToken,
        accessToken: session.accessToken,
        user: session.user,
      });
    }

    const trusted = await findTrustedDevice(req.cookies?.trusted_device, user.id);
    if (trusted) {
      await prisma.trustedDevice.update({
        where: { id: trusted.id },
        data: { lastUsedAt: new Date() },
      });
      const session = await buildSession(user, res, { remember });
      return res.json({
        requiresOtp: false,
        token: session.accessToken,
        accessToken: session.accessToken,
        user: session.user,
      });
    }

    const otp = await createAndSendOtp({
      email: user.email,
      purpose: 'LOGIN',
      payload: { userId: user.id, remember },
    });

    return res.json({
      requiresOtp: true,
      emailMasked: otp.emailMasked,
      expiresInSec: otp.expiresInSec,
      sent: otp.sent,
      message: `Код отправлен на ${otp.emailMasked}`,
      ...(allowDevSecrets() && otp.devCode ? { devCode: otp.devCode } : {}),
    });
  } catch (err) {
    return next(err);
  }
});

/** Step 2: confirm OTP and issue session. */
router.post('/login/confirm', loginLimiter, otpPairLimiter, async (req, res, next) => {
  try {
    const parsed = loginConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid OTP payload', details: parsed.error.flatten() });
    }

    const { email, code } = parsed.data;
    const record = await verifyOtp({ email, purpose: 'LOGIN', code });
    const userId = record.payload?.userId;
    if (!userId) {
      return res.status(400).json({ error: 'Некорректный код. Запросите новый.' });
    }

    const user = await loadUserWithOrg(userId);
    if (!user || user.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const session = await buildSession(user, res, {
      remember: Boolean(record.payload?.remember),
    });
    await trustBrowser(res, user.id, req);
    return res.json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: session.user,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

const ROLE_RU = {
  ADMIN: 'Администратор',
  SUPERVISOR: 'Руководитель',
  MANAGER: 'Менеджер',
  READONLY: 'Только чтение',
};

function parseSignup(body) {
  return registerOrgSchema.safeParse({
    ...body,
    organizationSlug: normalizeSlug(body.organizationSlug),
    phone: body.phone ? String(body.phone).trim() : null,
    city: body.city ? String(body.city).trim() : null,
    plan: body.plan ? String(body.plan).toUpperCase() : undefined,
  });
}

router.post('/check-email', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ error: 'Укажите email' });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email уже зарегистрирован', available: false });
    return res.json({ available: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/register/start', loginLimiter, otpPairLimiter, async (req, res, next) => {
  try {
    const parsed = parseSignup(req.body);
    if (!parsed.success || !parsed.data.password || parsed.data.password.length < 8) {
      return res.status(400).json({
        error: parsed.success ? 'Пароль должен быть не короче 8 символов' : 'Проверьте поля регистрации',
        details: parsed.success ? undefined : parsed.error.flatten(),
      });
    }
    const data = parsed.data;
    const existingOrg = await prisma.organization.findUnique({ where: { slug: data.organizationSlug } });
    if (existingOrg) {
      const suggested = await suggestSlug(data.organizationSlug);
      return res.status(409).json({
        error: 'Slug организации уже занят',
        suggestedSlug: suggested,
        hint: `Попробуйте другой URL, например «${suggested}»`,
      });
    }
    const existingUser = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existingUser) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const passwordHash = await bcrypt.hash(data.password, 10);
    if (!config.emailOtp) {
      const created = await prisma.$transaction((tx) =>
        createTrialOrganization(tx, {
          email: data.email,
          name: data.name,
          phone: data.phone || null,
          passwordHash,
          organizationName: data.organizationName,
          organizationSlug: data.organizationSlug,
          city: data.city || null,
          plan: data.plan || 'BASIC',
          ownerRole: data.ownerRole || 'owner',
        })
      );
      const session = await buildSession(created.owner, res, { remember: true });
      return res.status(201).json({
        requiresOtp: false,
        token: session.accessToken,
        accessToken: session.accessToken,
        user: session.user,
        organization: { id: created.org.id, name: created.org.name, slug: created.org.slug },
        message: `Организация создана. Пробный период ${data.plan || 'BASIC'}: ${TRIAL_DAYS} дней.`,
      });
    }

    const otp = await createAndSendOtp({
      email: data.email,
      purpose: 'REGISTER_ORG',
      payload: {
        name: data.name,
        phone: data.phone || null,
        organizationName: data.organizationName,
        organizationSlug: data.organizationSlug,
        city: data.city || null,
        plan: data.plan || 'BASIC',
        ownerRole: data.ownerRole || 'owner',
        passwordHash,
      },
    });
    return res.json({
      requiresOtp: true,
      emailMasked: otp.emailMasked,
      sent: otp.sent,
      message: `Код отправлен на ${otp.emailMasked}`,
      ...(allowDevSecrets() && config.emailOtp && otp.devCode ? { devCode: otp.devCode } : {}),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Организация или email уже существуют' });
    return next(err);
  }
});

router.post('/register/confirm', loginLimiter, otpPairLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase();
    const code = String(req.body.code || '');
    const record = await verifyOtp({ email, purpose: 'REGISTER_ORG', code });
    const payload = record.payload || {};
    if (!payload.passwordHash || !payload.organizationSlug) {
      return res.status(400).json({ error: 'Некорректный код. Запросите новый.' });
    }
    const created = await prisma.$transaction((tx) =>
      createTrialOrganization(tx, { ...payload, email })
    );
    const session = await buildSession(created.owner, res, { remember: true });
    await trustBrowser(res, created.owner.id, req);
    return res.status(201).json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: session.user,
      organization: { id: created.org.id, name: created.org.name, slug: created.org.slug },
      message: `Организация создана. Пробный период ${payload.plan || 'BASIC'}: ${TRIAL_DAYS} дней.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Организация или email уже существуют' });
    return next(err);
  }
});

router.post('/forgot', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ error: 'Укажите email' });
    if (!config.emailOtp) {
      return res.json({
        ok: true,
        message: 'Восстановление по почте временно недоступно. Напишите в поддержку.',
      });
    }
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    const message = 'Если аккаунт есть, мы отправили ссылку';
    if (!user) return res.json({ ok: true, message });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.emailOtp.updateMany({
      where: { email, purpose: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await prisma.emailOtp.create({
      data: {
        email,
        purpose: 'PASSWORD_RESET',
        codeHash: hashToken(token),
        payload: { userId: user.id },
        expiresAt,
      },
    });
    const link = `${appBaseUrl()}/reset?token=${token}`;
    const mail = await sendResetEmail(user.email, link);
    if (!mail.sent) {
      console.error(`[auth] reset email failed to=${user.email} mode=${mail.mode} error=${mail.error || ''}`);
      if (allowDevSecrets()) {
        return res.json({ ok: true, message, devLink: link });
      }
    }
    return res.json({ ok: true, message });
  } catch (err) {
    return next(err);
  }
});

router.post('/reset', loginLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    }
    const record = await prisma.emailOtp.findFirst({
      where: { purpose: 'PASSWORD_RESET', codeHash: hashToken(token), consumedAt: null },
    });
    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Ссылка недействительна или истекла' });
    }
    const userId = record.payload?.userId;
    if (!userId) return res.status(400).json({ error: 'Ссылка недействительна' });
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    await prisma.emailOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    await revokeAllRefreshTokens(userId);
    return res.json({ ok: true, message: 'Пароль обновлён. Теперь можно войти.' });
  } catch (err) {
    return next(err);
  }
});

router.get('/invite/:token', async (req, res, next) => {
  try {
    const invite = await prisma.orgInvite.findFirst({
      where: { tokenHash: hashToken(req.params.token), acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!invite) return res.status(404).json({ error: 'Приглашение не найдено или истекло' });
    return res.json({
      email: invite.email,
      role: invite.role,
      roleLabel: ROLE_RU[invite.role] || invite.role,
      organizationName: invite.organization.name,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/invite/accept', loginLimiter, async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    if (name.length < 1) return res.status(400).json({ error: 'Укажите имя' });
    if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    const invite = await prisma.orgInvite.findFirst({
      where: { tokenHash: hashToken(token), acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { organization: { include: { subscription: true, _count: { select: { users: true } } } } },
    });
    if (!invite) return res.status(404).json({ error: 'Приглашение не найдено или истекло' });
    const email = invite.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt && existing.organizationId && existing.organizationId !== invite.organizationId) {
      return res.status(409).json({ error: 'Этот email уже состоит в другой организации' });
    }
    if (invite.organization.subscription) {
      try {
        assertSeatAvailable(invite.organization.subscription, invite.organization._count.users);
      } catch (err) {
        return res.status(err.status || 403).json({ error: err.message });
      }
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            role: invite.role,
            organizationId: invite.organizationId,
            salonId: invite.salonId,
            deletedAt: null,
          },
          include: { organization: { include: { subscription: true } } },
        })
      : await prisma.user.create({
          data: {
            email,
            name,
            passwordHash,
            role: invite.role,
            organizationId: invite.organizationId,
            salonId: invite.salonId,
          },
          include: { organization: { include: { subscription: true } } },
        });
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    const session = await buildSession(user, res, { remember: true });
    return res.json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: session.user,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.refreshToken;
    if (!raw) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const tokenHash = hashToken(raw);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (stored?.revokedAt) {
      await revokeAllRefreshTokens(stored.userId);
      await revokeAllTrustedDevices(stored.userId);
      clearRefreshCookie(res);
      clearTrustedDeviceCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    if (!stored || stored.expiresAt < new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null },
      include: { organization: { include: { subscription: true } } },
    });
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rotated = await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      await revokeAllRefreshTokens(stored.userId);
      await revokeAllTrustedDevices(stored.userId);
      clearRefreshCookie(res);
      clearTrustedDeviceCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const session = await buildSession(user, res, { remember: stored.remember });
    return res.json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: session.user,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.refreshToken;
    if (raw) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authenticate, async (req, res) => {
  const enriched = attachSubscriptionMeta(req.user);
  return res.json({ user: publicUser(enriched) });
});

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const now = new Date();
    const [devices, sessions] = await Promise.all([
      prisma.trustedDevice.findMany({
        where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastUsedAt: 'desc' },
      }),
      prisma.refreshToken.findMany({
        where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const deviceHash = req.cookies?.trusted_device ? hashToken(req.cookies.trusted_device) : null;
    const refreshHash = req.cookies?.refreshToken ? hashToken(req.cookies.refreshToken) : null;
    return res.json({
      devices: devices.map((d) => ({
        id: d.id,
        label: deviceLabel(d.userAgent),
        createdAt: d.createdAt,
        lastUsedAt: d.lastUsedAt,
        current: d.tokenHash === deviceHash,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        remember: s.remember,
        current: s.tokenHash === refreshHash,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/sessions/revoke-all', authenticate, async (req, res, next) => {
  try {
    await revokeAllRefreshTokens(req.user.id);
    await revokeAllTrustedDevices(req.user.id);
    clearRefreshCookie(res);
    clearTrustedDeviceCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
