import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { canWrite, isSupervisor } from '../utils/helpers.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, typ: 'access' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createRefreshTokenValue() {
  return crypto.randomBytes(48).toString('hex');
}

export function refreshExpiryDate() {
  const match = String(config.jwtRefreshExpiresIn).match(/^(\d+)([dhms])$/);
  const amount = match ? Number(match[1]) : 7;
  const unit = match ? match[2] : 'd';
  const ms =
    unit === 'd'
      ? amount * 86400000
      : unit === 'h'
        ? amount * 3600000
        : unit === 'm'
          ? amount * 60000
          : amount * 1000;
  return new Date(Date.now() + ms);
}

export function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

export async function issueRefreshToken(userId) {
  const token = createRefreshTokenValue();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: refreshExpiryDate(),
    },
  });
  return token;
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (payload.typ && payload.typ !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await prisma.user.findFirst({
      where: { id: Number(payload.sub), deletedAt: null },
    });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireSupervisor(req, res, next) {
  if (!isSupervisor(req.user)) {
    return res.status(403).json({ error: 'Only supervisors can perform this action' });
  }
  return next();
}

export function requireWrite(req, res, next) {
  if (!canWrite(req.user)) {
    return res.status(403).json({ error: 'Read-only role cannot modify data' });
  }
  return next();
}

export async function loadDealWithAccess(req, res, next) {
  try {
    const dealId = Number(req.params.id || req.params.dealId);
    if (!Number.isFinite(dealId)) {
      return res.status(400).json({ error: 'Invalid deal id' });
    }

    const deal = await prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      include: {
        client: true,
        responsible: {
          select: { id: true, name: true, email: true, role: true },
        },
        comments: {
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        history: {
          include: {
            changer: { select: { id: true, name: true, email: true } },
          },
          orderBy: { changedAt: 'desc' },
        },
        attachments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        tasks: {
          where: { deletedAt: null },
          include: {
            assignee: { select: { id: true, name: true } },
          },
          orderBy: { dueAt: 'asc' },
        },
      },
    });

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (!isSupervisor(req.user) && deal.responsibleId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this deal' });
    }

    req.deal = deal;
    return next();
  } catch (err) {
    return next(err);
  }
}
