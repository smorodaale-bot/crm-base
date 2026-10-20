import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireSupervisor, requireFeature } from '../middleware/auth.js';
import { assertFeature, assertVehicleAvailable } from '../services/plans.js';
import { findActiveStockCredential, resolveSyncSalon } from '../services/stockSync.js';

const router = Router();

const stockItemSchema = z.object({
  externalId: z.string().min(1),
  vin: z.string().optional().nullable(),
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().optional().nullable(),
  kind: z.enum(['NEW', 'USED']).optional(),
  status: z.enum(['IN_STOCK', 'RESERVED', 'SOLD', 'IN_TRANSIT']).optional(),
  price: z.number().nonnegative(),
  mileageKm: z.number().int().optional().nullable(),
  color: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
});

const syncSchema = z.object({
  sourceSystem: z.string().trim().min(1).max(40).default('sync'),
  salonSlug: z.string().trim().min(1, 'Укажите salonSlug'),
  vehicles: z.array(stockItemSchema).min(1).max(500),
});

const stockSyncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Слишком много запросов синхронизации склада' },
});

async function authorizeStock(req, res, next) {
  const header = String(req.headers['x-stock-token'] || '').trim();
  if (header) {
    try {
      const credential = await findActiveStockCredential(prisma, header);
      assertFeature(credential.organization.subscription, 'stock_api');
      req.stockOrgId = credential.organizationId;
      req.stockSubscription = credential.organization.subscription;
      await prisma.stockSyncCredential.update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      });
      return next();
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, code: err.code || 'PLAN_FEATURE' });
    }
  }
  return authenticate(req, res, () =>
    requireSupervisor(req, res, () => requireFeature('stock_api')(req, res, next))
  );
}

/** Upsert vehicles by externalId into salons of the token's organization. */
router.post('/sync', stockSyncLimiter, authorizeStock, async (req, res, next) => {
  try {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const organizationId = req.stockOrgId || req.user?.organizationId;
    if (!organizationId) return res.status(400).json({ error: 'Нет организации' });

    const slug = parsed.data.salonSlug;
    const ownSalon = await prisma.salon.findFirst({
      where: { slug, organizationId },
    });
    const foreignSalon = ownSalon
      ? null
      : await prisma.salon.findFirst({
          where: { slug },
          select: { id: true, organizationId: true, slug: true },
        });
    let salon;
    try {
      salon = resolveSyncSalon({
        organizationId,
        salonSlug: slug,
        ownSalon,
        foreignSalon,
      });
    } catch (salonErr) {
      return res.status(salonErr.status || 400).json({ error: salonErr.message });
    }

    const subscription =
      req.stockSubscription ||
      (await prisma.subscription.findUnique({ where: { organizationId } }));
    let stockCount = await prisma.vehicle.count({
      where: { deletedAt: null, salon: { organizationId } },
    });

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const item of parsed.data.vehicles) {
      const existing = await prisma.vehicle.findFirst({
        where: {
          deletedAt: null,
          salon: { organizationId },
          OR: [{ externalId: item.externalId }, ...(item.vin ? [{ vin: item.vin }] : [])],
        },
      });

      const data = {
        brand: item.brand,
        model: item.model,
        year: item.year ?? null,
        vin: item.vin || null,
        lotNumber: item.lotNumber || null,
        kind: item.kind || 'USED',
        status: item.status || 'IN_STOCK',
        price: item.price,
        mileageKm: item.mileageKm ?? null,
        color: item.color || null,
        externalId: item.externalId,
        sourceSystem: parsed.data.sourceSystem,
        salonId: salon.id,
        deletedAt: null,
      };

      try {
        if (existing) {
          await prisma.vehicle.update({ where: { id: existing.id }, data });
          updated += 1;
          continue;
        }
        assertVehicleAvailable(subscription, stockCount);
        await prisma.vehicle.create({ data });
        created += 1;
        stockCount += 1;
      } catch (rowErr) {
        if (rowErr.code === 'P2002') {
          errors.push({ externalId: item.externalId, message: 'VIN уже занят' });
          continue;
        }
        if (rowErr.code === 'VEHICLE_LIMIT' || rowErr.status === 403) {
          errors.push({ externalId: item.externalId, message: rowErr.message });
          break;
        }
        throw rowErr;
      }
    }

    return res.json({
      ok: errors.length === 0,
      created,
      updated,
      total: parsed.data.vehicles.length,
      errors,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/salons', authenticate, requireSupervisor, async (_req, res, next) => {
  try {
    const salons = await prisma.salon.findMany({
      include: {
        _count: { select: { users: true, deals: true, vehicles: true } },
      },
      orderBy: { id: 'asc' },
    });
    return res.json({ salons });
  } catch (err) {
    return next(err);
  }
});

router.post('/salons', authenticate, requireSupervisor, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const slug = String(req.body.slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
    const salon = await prisma.salon.create({ data: { name, slug } });
    return res.status(201).json({ salon });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Slug already exists' });
    return next(err);
  }
});

export default router;
