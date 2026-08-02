import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  authenticate,
  clearRefreshCookie,
  hashToken,
  issueRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from '../middleware/auth.js';
import { publicUser } from '../utils/helpers.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

async function buildSession(user, res) {
  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  return { accessToken, user: publicUser(user) };
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid credentials payload', details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const session = await buildSession(user, res);
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
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null },
    });
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const session = await buildSession(user, res);
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
  return res.json({ user: publicUser(req.user) });
});

export default router;
