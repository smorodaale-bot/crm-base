import { Router } from 'express';
import { z } from 'zod';
import pkg from '@prisma/client';
import { prisma } from '../db.js';
import { authenticate, requireWrite } from '../middleware/auth.js';
import { normalizePhone } from '../utils/phone.js';
import { writeActivityLog } from '../utils/audit.js';
import { isSupervisor, parsePagination, parseSort, serializeDeal } from '../utils/helpers.js';

const { Prisma } = pkg;
const router = Router();
router.use(authenticate);

const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().nullable().or(z.literal('')),
  source: z.string().optional().nullable(),
  sourceId: z.number().int().positive().optional().nullable(),
  utmSource: z.string().optional().nullable(),
  utmMedium: z.string().optional().nullable(),
  utmCampaign: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  responsibleManagerId: z.number().int().positive().optional().nullable(),
});

function mapClient(client) {
  return {
    ...client,
    responsibleManager: client.responsibleManager
      ? {
          id: client.responsibleManager.id,
          name: client.responsibleManager.name,
          email: client.responsibleManager.email,
        }
      : null,
    leadSource: client.leadSource || null,
  };
}

router.get('/duplicates', async (req, res, next) => {
  try {
    const phone = req.query.phone ? normalizePhone(String(req.query.phone)) : null;
    const email = req.query.email ? String(req.query.email).toLowerCase().trim() : null;
    const name = req.query.name ? String(req.query.name).trim() : null;
    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;

    const or = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
    if (name && name.length >= 3) {
      or.push({ name: { equals: name, mode: 'insensitive' } });
    }

    if (!or.length) return res.json({ duplicates: [] });

    const duplicates = await prisma.client.findMany({
      where: {
        deletedAt: null,
        OR: or,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      include: {
        responsibleManager: { select: { id: true, name: true, email: true } },
        _count: { select: { deals: true } },
      },
      take: 20,
    });

    return res.json({ duplicates: duplicates.map(mapClient) });
  } catch (err) {
    if (err.message?.includes('Phone')) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { search, responsibleManagerId, sourceId } = req.query;
    const where = { deletedAt: null };

    if (search) {
      const q = String(search);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (responsibleManagerId) where.responsibleManagerId = Number(responsibleManagerId);
    if (sourceId) where.sourceId = Number(sourceId);

    const { page, limit, skip } = parsePagination(req.query);
    const orderBy = parseSort(req.query, ['updatedAt', 'createdAt', 'name'], {
      field: 'updatedAt',
      dir: 'desc',
    });

    const [total, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        include: {
          responsibleManager: { select: { id: true, name: true, email: true } },
          leadSource: true,
          _count: { select: { deals: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return res.json({
      clients: clients.map(mapClient),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      include: {
        responsibleManager: { select: { id: true, name: true, email: true } },
        leadSource: true,
        deals: {
          where: { deletedAt: null },
          include: {
            responsible: { select: { id: true, name: true, email: true } },
          },
          orderBy: { updatedAt: 'desc' },
        },
        tasks: {
          where: { deletedAt: null },
          include: { assignee: { select: { id: true, name: true } } },
          orderBy: { dueAt: 'asc' },
        },
      },
    });

    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (!isSupervisor(req.user)) {
      client.deals = client.deals.filter((d) => d.responsibleId === req.user.id);
    }

    return res.json({
      client: {
        ...mapClient(client),
        deals: client.deals.map(serializeDeal),
        tasks: client.tasks,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const parsed = clientSchema.safeParse({
      ...req.body,
      sourceId:
        req.body.sourceId == null || req.body.sourceId === ''
          ? null
          : Number(req.body.sourceId),
      responsibleManagerId:
        req.body.responsibleManagerId == null || req.body.responsibleManagerId === ''
          ? null
          : Number(req.body.responsibleManagerId),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    let phone;
    try {
      phone = normalizePhone(parsed.data.phone);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const existing = await prisma.client.findFirst({
      where: { phone, deletedAt: null },
    });
    if (existing) {
      return res.status(409).json({
        error: 'Клиент с таким телефоном уже существует',
        clientId: existing.id,
      });
    }

    if (parsed.data.email) {
      const byEmail = await prisma.client.findFirst({
        where: {
          deletedAt: null,
          email: { equals: parsed.data.email, mode: 'insensitive' },
        },
      });
      if (byEmail) {
        return res.status(409).json({
          error: 'Клиент с таким email уже существует',
          clientId: byEmail.id,
          warning: true,
        });
      }
    }

    const responsibleManagerId =
      parsed.data.responsibleManagerId ?? (isSupervisor(req.user) ? null : req.user.id);

    let sourceName = parsed.data.source || null;
    if (parsed.data.sourceId) {
      const src = await prisma.leadSource.findUnique({ where: { id: parsed.data.sourceId } });
      if (src) sourceName = src.name;
    }

    const client = await prisma.client.create({
      data: {
        name: parsed.data.name,
        phone,
        email: parsed.data.email || null,
        source: sourceName,
        sourceId: parsed.data.sourceId || null,
        utmSource: parsed.data.utmSource || null,
        utmMedium: parsed.data.utmMedium || null,
        utmCampaign: parsed.data.utmCampaign || null,
        comment: parsed.data.comment || null,
        responsibleManagerId,
      },
      include: {
        responsibleManager: { select: { id: true, name: true, email: true } },
        leadSource: true,
      },
    });

    return res.status(201).json({ client: mapClient(client) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Клиент с таким телефоном уже существует' });
    }
    return next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.client.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const parsed = clientSchema.partial().safeParse({
      ...req.body,
      sourceId:
        req.body.sourceId === undefined
          ? undefined
          : req.body.sourceId == null || req.body.sourceId === ''
            ? null
            : Number(req.body.sourceId),
      responsibleManagerId:
        req.body.responsibleManagerId === undefined
          ? undefined
          : req.body.responsibleManagerId == null || req.body.responsibleManagerId === ''
            ? null
            : Number(req.body.responsibleManagerId),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = { ...parsed.data };
    if (data.email === '') data.email = null;

    if (data.phone) {
      try {
        data.phone = normalizePhone(data.phone);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const duplicate = await prisma.client.findFirst({
        where: { phone: data.phone, deletedAt: null, NOT: { id } },
      });
      if (duplicate) {
        return res.status(409).json({
          error: 'Клиент с таким телефоном уже существует',
          clientId: duplicate.id,
        });
      }
    }

    if (data.sourceId) {
      const src = await prisma.leadSource.findUnique({ where: { id: data.sourceId } });
      if (src) data.source = src.name;
    }

    const client = await prisma.client.update({
      where: { id },
      data,
      include: {
        responsibleManager: { select: { id: true, name: true, email: true } },
        leadSource: true,
      },
    });

    return res.json({ client: mapClient(client) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Клиент с таким телефоном уже существует' });
    }
    return next(err);
  }
});

router.post('/:id/merge', requireWrite, async (req, res, next) => {
  try {
    if (!isSupervisor(req.user)) {
      return res.status(403).json({ error: 'Only supervisors can merge clients' });
    }

    const sourceId = Number(req.params.id);
    const targetId = Number(req.body.targetId);
    if (!targetId || sourceId === targetId) {
      return res.status(400).json({ error: 'targetId required and must differ' });
    }

    const [source, target] = await Promise.all([
      prisma.client.findFirst({ where: { id: sourceId, deletedAt: null } }),
      prisma.client.findFirst({ where: { id: targetId, deletedAt: null } }),
    ]);
    if (!source || !target) return res.status(404).json({ error: 'Client not found' });

    await prisma.$transaction(async (tx) => {
      await tx.deal.updateMany({
        where: { clientId: sourceId, deletedAt: null },
        data: { clientId: targetId },
      });
      await tx.task.updateMany({
        where: { clientId: sourceId, deletedAt: null },
        data: { clientId: targetId },
      });
      await tx.client.update({
        where: { id: sourceId },
        data: {
          deletedAt: new Date(),
          phone: `${source.phone}__merged_${sourceId}`,
          comment: `${source.comment || ''}\n[merged into #${targetId}]`.trim(),
        },
      });
      if (!target.email && source.email) {
        await tx.client.update({ where: { id: targetId }, data: { email: source.email } });
      }
      await writeActivityLog(tx, {
        userId: req.user.id,
        action: 'client_merged',
        entityType: 'client',
        entityId: targetId,
        metadata: { from: sourceId, to: targetId },
      });
    });

    const client = await prisma.client.findUnique({
      where: { id: targetId },
      include: {
        responsibleManager: { select: { id: true, name: true, email: true } },
        leadSource: true,
      },
    });

    return res.json({ client: mapClient(client) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.client.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    await prisma.client.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        phone: `${existing.phone}__deleted_${id}`,
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
