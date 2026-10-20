import crypto from 'crypto';
import { hashToken } from '../middleware/auth.js';

export function createStockToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function stockTokenHash(token) {
  return hashToken(String(token || ''));
}

/**
 * salonSlug is required. A slug that belongs to another organization is 403.
 * An unknown slug is 400. Search never falls back to a default salon.
 */
export function resolveSyncSalon({ organizationId, salonSlug, ownSalon, foreignSalon }) {
  const slug = String(salonSlug || '').trim();
  if (!slug) {
    const err = new Error('Укажите salonSlug');
    err.status = 400;
    throw err;
  }
  if (ownSalon && Number(ownSalon.organizationId) === Number(organizationId)) return ownSalon;
  if (foreignSalon && foreignSalon.organizationId != null && Number(foreignSalon.organizationId) !== Number(organizationId)) {
    const err = new Error('Салон принадлежит другой организации');
    err.status = 403;
    throw err;
  }
  const err = new Error('Салон не найден');
  err.status = 400;
  throw err;
}

export async function findActiveStockCredential(db, rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    const err = new Error('Неверный токен синхронизации склада');
    err.status = 401;
    throw err;
  }
  const row = await db.stockSyncCredential.findFirst({
    where: { tokenHash: stockTokenHash(token), revokedAt: null },
    include: { organization: { include: { subscription: true } } },
  });
  if (!row) {
    const err = new Error('Неверный токен синхронизации склада');
    err.status = 401;
    throw err;
  }
  return row;
}
