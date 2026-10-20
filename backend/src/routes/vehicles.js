import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireWrite, requireFeature } from '../middleware/auth.js';
import { isSupervisor, parsePagination } from '../utils/helpers.js';
import { vehicleOrgWhere, dealOrgWhere } from '../utils/tenant.js';
import { extractAvitoItemId, listingNeedsUnlistPatch } from '../utils/avitoListing.js';
import { assertVehicleAvailable } from '../services/plans.js';
import { TEMPLATE_CSV, decodeSpreadsheet, parseVehicleSheet } from '../utils/vehicleImport.js';

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const router = Router();
router.use(authenticate);

const vehicleInclude = {
  reservedBy: { select: { id: true, name: true, email: true } },
  reservedDeal: { select: { id: true, title: true, stage: true } },
  deals: {
    where: { deletedAt: null },
    select: { id: true, title: true, stage: true, responsibleId: true },
    take: 20,
    orderBy: { updatedAt: 'desc' },
  },
};

function toNum(v) {
  if (v == null) return v;
  return Number(v);
}

function daysInStock(vehicle) {
  const from = vehicle.stockedAt || vehicle.createdAt;
  if (!from) return null;
  const ms = Date.now() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function marginHint(vehicle) {
  const price = toNum(vehicle.price);
  const purchase = vehicle.purchasePrice != null ? toNum(vehicle.purchasePrice) : null;
  if (purchase == null || Number.isNaN(price) || Number.isNaN(purchase)) return null;
  const prep = toNum(vehicle.prepCost) || 0;
  return Math.round((price - purchase - prep) * 100) / 100;
}

function serializeVehicle(v) {
  if (!v) return v;
  const photoUrls = Array.isArray(v.photoUrls)
    ? v.photoUrls
    : v.photoUrls && typeof v.photoUrls === 'object'
      ? Object.values(v.photoUrls)
      : [];
  return {
    ...v,
    price: toNum(v.price),
    purchasePrice: v.purchasePrice != null ? toNum(v.purchasePrice) : null,
    prepCost: toNum(v.prepCost) || 0,
    photoUrls,
    daysInStock: daysInStock(v),
    marginHint: marginHint(v),
  };
}

async function expireOverdueReservations(orgUser) {
  const now = new Date();
  const where = vehicleOrgWhere(orgUser, {
    status: 'RESERVED',
    reservedUntil: { lt: now },
  });
  const overdue = await prisma.vehicle.findMany({
    where,
    select: { id: true },
    take: 100,
  });
  if (!overdue.length) return 0;
  await prisma.vehicle.updateMany({
    where: { id: { in: overdue.map((v) => v.id) } },
    data: {
      status: 'IN_STOCK',
      reservedAt: null,
      reservedUntil: null,
      reservedById: null,
      reservedDealId: null,
    },
  });
  return overdue.length;
}

function clearReservationData() {
  return {
    status: 'IN_STOCK',
    reservedAt: null,
    reservedUntil: null,
    reservedById: null,
    reservedDealId: null,
  };
}

const vehicleSchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().optional().nullable(),
  vin: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  kind: z.enum(['NEW', 'USED']).optional(),
  status: z.enum(['IN_STOCK', 'RESERVED', 'SOLD', 'IN_TRANSIT']).optional(),
  price: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  prepCost: z.number().nonnegative().optional().nullable(),
  mileageKm: z.number().int().optional().nullable(),
  color: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  equipment: z.string().optional().nullable(),
  photoUrls: z.array(z.string().min(1)).optional().nullable(),
  salonId: z.number().int().optional().nullable(),
  externalId: z.string().optional().nullable(),
  sourceSystem: z.string().optional().nullable(),
  avitoItemId: z.string().optional().nullable(),
  avitoUrl: z.string().optional().nullable(),
  listingStatus: z.enum(['NONE', 'LISTED', 'NEEDS_UNLIST', 'UNLISTED']).optional(),
});

function parseBodyNumbers(body, { partial = false } = {}) {
  const out = { ...body };
  if (body.price !== undefined) out.price = Number(body.price);
  else if (!partial) out.price = Number(body.price);
  if (body.year !== undefined) out.year = body.year == null || body.year === '' ? null : Number(body.year);
  if (body.mileageKm !== undefined) {
    out.mileageKm = body.mileageKm == null || body.mileageKm === '' ? null : Number(body.mileageKm);
  }
  if (body.salonId !== undefined) {
    out.salonId = body.salonId == null || body.salonId === '' ? null : Number(body.salonId);
  }
  if (body.purchasePrice !== undefined) {
    out.purchasePrice =
      body.purchasePrice == null || body.purchasePrice === '' ? null : Number(body.purchasePrice);
  }
  if (body.prepCost !== undefined) {
    out.prepCost = body.prepCost == null || body.prepCost === '' ? 0 : Number(body.prepCost);
  }
  if (body.photoUrls !== undefined) {
    if (typeof body.photoUrls === 'string') {
      out.photoUrls = body.photoUrls
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(body.photoUrls)) {
      out.photoUrls = body.photoUrls;
    } else if (body.photoUrls == null) {
      out.photoUrls = [];
    }
  }
  if (body.avitoUrl !== undefined) {
    out.avitoUrl = body.avitoUrl == null || body.avitoUrl === '' ? null : String(body.avitoUrl).trim();
  }
  if (body.avitoItemId !== undefined || body.avitoUrl !== undefined) {
    const fromField =
      body.avitoItemId != null && body.avitoItemId !== ''
        ? extractAvitoItemId(body.avitoItemId)
        : null;
    const fromUrl = out.avitoUrl ? extractAvitoItemId(out.avitoUrl) : null;
    if (body.avitoItemId !== undefined || fromUrl) {
      out.avitoItemId = fromField || fromUrl || (body.avitoItemId === '' || body.avitoItemId == null ? null : String(body.avitoItemId));
    }
  }
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    await expireOverdueReservations(req.user);
    const { skip, limit, page } = parsePagination(req.query);
    const where = vehicleOrgWhere(req.user);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.listingStatus) where.listingStatus = String(req.query.listingStatus);
    if (req.query.search) {
      const q = String(req.query.search);
      where.OR = [
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
        { vin: { contains: q, mode: 'insensitive' } },
        { lotNumber: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, vehicles] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.findMany({
        where,
        include: {
          reservedBy: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return res.json({
      page,
      total,
      vehicles: vehicles.map(serializeVehicle),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/import/template', requireFeature('stock_import'), (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sklad-shablon.csv"');
  return res.send(`\uFEFF${TEMPLATE_CSV}`);
});

function listingFields(avitoUrl) {
  if (!avitoUrl) return {};
  const url = String(avitoUrl).trim();
  return {
    avitoUrl: url,
    avitoItemId: extractAvitoItemId(url),
    listingStatus: 'LISTED',
  };
}

router.post(
  '/import',
  requireWrite,
  requireFeature('stock_import'),
  (req, res, next) => {
    importUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'Не удалось прочитать файл (лимит 2 МБ)' });
      return next();
    });
  },
  async (req, res, next) => {
    try {
      if (req.file?.buffer) {
        const sig = req.file.buffer.subarray(0, 2).toString('utf8');
        const ole = req.file.buffer[0] === 0xd0 && req.file.buffer[1] === 0xcf;
        if (sig === 'PK' || ole) {
          return res.status(400).json({
            error: 'Загрузите CSV: в Excel «Файл → Сохранить как → CSV UTF-8». Книга .xlsx напрямую не читается.',
          });
        }
      }
      const text = req.file?.buffer
        ? decodeSpreadsheet(req.file.buffer)
        : String(req.body?.text || req.body?.csv || '');
      const parsed = parseVehicleSheet(text);
      if (!parsed.rows.length && parsed.errors.some((e) => e.line === 1)) {
        return res.status(400).json({ error: parsed.errors[0].message, errors: parsed.errors });
      }

      const salon = await prisma.salon.findFirst({
        where: { organizationId: req.user.organizationId },
        orderBy: { id: 'asc' },
      });
      if (!salon) {
        return res.status(400).json({ error: 'Сначала создайте салон в организации' });
      }

      let created = 0;
      let updated = 0;
      const errors = [...parsed.errors];
      const subscription = await prisma.subscription.findUnique({
        where: { organizationId: req.user.organizationId },
      });
      let stockCount = await prisma.vehicle.count({
        where: { deletedAt: null, salon: { organizationId: req.user.organizationId } },
      });

      for (const row of parsed.rows) {
        const data = {
          brand: row.brand,
          model: row.model,
          price: row.price,
          ...(row.year != null ? { year: row.year } : {}),
          ...(row.lotNumber ? { lotNumber: row.lotNumber } : {}),
          ...(row.purchasePrice != null ? { purchasePrice: row.purchasePrice } : {}),
          ...(row.prepCost != null ? { prepCost: row.prepCost } : {}),
          ...(row.stockedAt ? { stockedAt: row.stockedAt } : {}),
          ...(row.mileageKm != null ? { mileageKm: row.mileageKm } : {}),
          ...(row.color ? { color: row.color } : {}),
          ...(row.kind ? { kind: row.kind } : {}),
          ...listingFields(row.avitoUrl),
        };

        try {
          if (row.vin) {
            const existing = await prisma.vehicle.findFirst({
              where: { vin: row.vin },
              include: { salon: { select: { organizationId: true } } },
            });
            if (existing && existing.salon?.organizationId !== req.user.organizationId) {
              errors.push({ line: row.line, message: `VIN ${row.vin} уже есть в другой организации` });
              continue;
            }
            if (existing) {
              await prisma.vehicle.update({
                where: { id: existing.id },
                data: { ...data, vin: row.vin, deletedAt: null },
              });
              updated += 1;
              continue;
            }
          }

          try {
            assertVehicleAvailable(subscription, stockCount);
          } catch (limitErr) {
            errors.push({ line: row.line, message: limitErr.message });
            break;
          }
          await prisma.vehicle.create({
            data: {
              ...data,
              vin: row.vin,
              salonId: salon.id,
              prepCost: data.prepCost ?? 0,
              photoUrls: [],
              status: row.status || 'IN_STOCK',
              stockedAt: data.stockedAt || new Date(),
            },
          });
          created += 1;
          stockCount += 1;
        } catch (err) {
          if (err.code === 'P2002') {
            errors.push({ line: row.line, message: `VIN ${row.vin || ''} уже занят` });
            continue;
          }
          errors.push({ line: row.line, message: 'Не удалось сохранить строку' });
        }
      }

      return res.json({
        created,
        updated,
        failed: errors.length,
        errors: errors.slice(0, 30),
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/:id', async (req, res, next) => {
  try {
    await expireOverdueReservations(req.user);
    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id: Number(req.params.id) }),
      include: vehicleInclude,
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    return res.json({ vehicle: serializeVehicle(vehicle) });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const parsed = vehicleSchema.safeParse(parseBodyNumbers(req.body));
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    if (parsed.data.salonId) {
      const salon = await prisma.salon.findFirst({
        where: { id: parsed.data.salonId, organizationId: req.user.organizationId },
      });
      if (!salon) return res.status(400).json({ error: 'Salon not found in organization' });
    } else {
      const salon = await prisma.salon.findFirst({
        where: { organizationId: req.user.organizationId },
        orderBy: { id: 'asc' },
      });
      if (salon) parsed.data.salonId = salon.id;
    }

    if (parsed.data.status === 'RESERVED') {
      parsed.data.status = 'IN_STOCK';
    }

    const data = {
      ...parsed.data,
      prepCost: parsed.data.prepCost ?? 0,
      photoUrls: parsed.data.photoUrls ?? [],
      stockedAt: new Date(),
    };

    const [subscription, stockCount] = await Promise.all([
      prisma.subscription.findUnique({ where: { organizationId: req.user.organizationId } }),
      prisma.vehicle.count({
        where: { deletedAt: null, salon: { organizationId: req.user.organizationId } },
      }),
    ]);
    assertVehicleAvailable(subscription, stockCount);

    const vehicle = await prisma.vehicle.create({
      data,
      include: vehicleInclude,
    });
    return res.status(201).json({ vehicle: serializeVehicle(vehicle) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'VIN already exists' });
    return next(err);
  }
});

router.patch('/:id', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    const parsed = vehicleSchema.partial().safeParse(parseBodyNumbers(req.body, { partial: true }));
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    if (parsed.data.salonId) {
      const salon = await prisma.salon.findFirst({
        where: { id: parsed.data.salonId, organizationId: req.user.organizationId },
      });
      if (!salon) return res.status(400).json({ error: 'Salon not found in organization' });
    }

    // Status transitions for reserve/sold go through dedicated endpoints
    if (parsed.data.status && ['RESERVED', 'SOLD'].includes(parsed.data.status)) {
      delete parsed.data.status;
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: parsed.data,
      include: vehicleInclude,
    });
    return res.json({ vehicle: serializeVehicle(vehicle) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'VIN already exists' });
    return next(err);
  }
});

const reserveSchema = z.object({
  dealId: z.number().int().optional().nullable(),
  hours: z.number().positive().max(24 * 30).optional(),
});

router.post('/:id/reserve', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    await expireOverdueReservations(req.user);
    const id = Number(req.params.id);
    const parsed = reserveSchema.safeParse({
      dealId: req.body.dealId != null && req.body.dealId !== '' ? Number(req.body.dealId) : null,
      hours: req.body.hours != null ? Number(req.body.hours) : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.status === 'SOLD') {
      return res.status(409).json({ error: 'Авто уже продано' });
    }
    if (vehicle.status === 'RESERVED' && vehicle.reservedById !== req.user.id && !isSupervisor(req.user)) {
      return res.status(409).json({ error: 'Авто уже забронировано другим менеджером' });
    }
    if (vehicle.status === 'RESERVED' && vehicle.reservedById !== req.user.id && isSupervisor(req.user)) {
      // supervisor may take over
    } else if (vehicle.status !== 'IN_STOCK' && vehicle.status !== 'RESERVED') {
      return res.status(409).json({ error: `Нельзя забронировать авто в статусе ${vehicle.status}` });
    }

    let dealId = parsed.data.dealId || null;
    if (dealId) {
      const deal = await prisma.deal.findFirst({
        where: dealOrgWhere(req.user, { id: dealId, deletedAt: null }),
      });
      if (!deal) return res.status(400).json({ error: 'Сделка не найдена' });
      if (deal.vehicleId && deal.vehicleId !== id) {
        return res.status(409).json({ error: 'К сделке уже привязано другое авто' });
      }
    }

    const hours = parsed.data.hours || 24;
    const now = new Date();
    const until = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const locked = await tx.vehicle.findFirst({
        where: vehicleOrgWhere(req.user, { id }),
      });
      if (!locked) {
        const err = new Error('Vehicle not found');
        err.status = 404;
        throw err;
      }
      if (locked.status === 'SOLD') {
        const err = new Error('Авто уже продано');
        err.status = 409;
        throw err;
      }
      if (
        locked.status === 'RESERVED' &&
        locked.reservedById &&
        locked.reservedById !== req.user.id &&
        !isSupervisor(req.user)
      ) {
        const err = new Error('Авто уже забронировано другим менеджером');
        err.status = 409;
        throw err;
      }
      if (locked.status !== 'IN_STOCK' && locked.status !== 'RESERVED') {
        const err = new Error(`Нельзя забронировать авто в статусе ${locked.status}`);
        err.status = 409;
        throw err;
      }

      if (dealId) {
        await tx.deal.update({
          where: { id: dealId },
          data: { vehicleId: id },
        });
      }

      return tx.vehicle.update({
        where: { id },
        data: {
          status: 'RESERVED',
          reservedAt: now,
          reservedUntil: until,
          reservedById: req.user.id,
          reservedDealId: dealId,
          ...listingNeedsUnlistPatch(locked),
        },
        include: vehicleInclude,
      });
    });

    return res.json({ vehicle: serializeVehicle(updated), message: 'Авто забронировано' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Эта сделка уже удерживает бронь на другом авто' });
    }
    return next(err);
  }
});

router.post('/:id/release', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.status !== 'RESERVED') {
      return res.status(400).json({ error: 'Авто не в резерве' });
    }
    if (vehicle.reservedById !== req.user.id && !isSupervisor(req.user)) {
      return res.status(403).json({ error: 'Снять бронь может только тот, кто забронировал, или руководитель' });
    }

    const updated = await prisma.vehicle.update({
      where: { id },
      data: clearReservationData(),
      include: vehicleInclude,
    });
    return res.json({ vehicle: serializeVehicle(updated), message: 'Бронь снята' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/sold', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dealId =
      req.body.dealId != null && req.body.dealId !== '' ? Number(req.body.dealId) : null;

    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.status === 'SOLD') {
      return res.status(400).json({ error: 'Авто уже продано' });
    }

    if (dealId) {
      const deal = await prisma.deal.findFirst({
        where: dealOrgWhere(req.user, { id: dealId, deletedAt: null }),
      });
      if (!deal) return res.status(400).json({ error: 'Сделка не найдена' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (dealId) {
        await tx.deal.update({
          where: { id: dealId },
          data: { vehicleId: id },
        });
      }
      return tx.vehicle.update({
        where: { id },
        data: {
          status: 'SOLD',
          reservedAt: null,
          reservedUntil: null,
          reservedById: null,
          reservedDealId: null,
          ...listingNeedsUnlistPatch(vehicle),
        },
        include: vehicleInclude,
      });
    });

    return res.json({ vehicle: serializeVehicle(updated), message: 'Авто отмечено как проданное' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/listing-listed', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const avitoUrl =
      req.body.avitoUrl != null && String(req.body.avitoUrl).trim()
        ? String(req.body.avitoUrl).trim()
        : vehicle.avitoUrl;
    const avitoItemId =
      extractAvitoItemId(req.body.avitoItemId) ||
      extractAvitoItemId(avitoUrl) ||
      vehicle.avitoItemId;

    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        listingStatus: 'LISTED',
        avitoUrl: avitoUrl || null,
        avitoItemId: avitoItemId || null,
      },
      include: vehicleInclude,
    });
    return res.json({ vehicle: serializeVehicle(updated), message: 'Объявление отмечено как выложенное' });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/listing-unlisted', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const vehicle = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const updated = await prisma.vehicle.update({
      where: { id },
      data: { listingStatus: 'UNLISTED' },
      include: vehicleInclude,
    });
    return res.json({ vehicle: serializeVehicle(updated), message: 'Объявление отмечено как снятое' });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', requireWrite, requireFeature('stock'), async (req, res, next) => {
  try {
    if (!isSupervisor(req.user)) {
      return res.status(403).json({ error: 'Only supervisors can delete vehicles' });
    }
    const id = Number(req.params.id);
    const existing = await prisma.vehicle.findFirst({
      where: vehicleOrgWhere(req.user, { id }),
    });
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });
    await prisma.vehicle.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'SOLD',
        reservedAt: null,
        reservedUntil: null,
        reservedById: null,
        reservedDealId: null,
      },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
