import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireWrite } from '../middleware/auth.js';
import { endOfDay, isSupervisor, parsePagination, startOfDay } from '../utils/helpers.js';
import { runVisitNoShowAutomation } from '../services/automations.js';
import { clientOrgWhere, sameOrganization, userOrgWhere, visitOrgWhere } from '../utils/tenant.js';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  clientId: z.number().int().positive(),
  dealId: z.number().int().positive().optional().nullable(),
  managerId: z.number().int().positive().optional(),
  scheduledAt: z.string().datetime(),
  note: z.string().optional().nullable(),
});

const updateSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']).optional(),
  note: z.string().optional().nullable(),
  managerId: z.number().int().positive().optional(),
  dealId: z.number().int().positive().optional().nullable(),
});

router.get('/', async (req, res, next) => {
  try {
    const { skip, limit, page } = parsePagination(req.query, { defaultLimit: 50 });
    const where = visitOrgWhere(req.user);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.today === '1' || req.query.today === 'true') {
      where.scheduledAt = { gte: startOfDay(), lte: endOfDay() };
    }
    if (req.query.from || req.query.to) {
      where.scheduledAt = {
        ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}),
      };
    }

    const [total, visits] = await Promise.all([
      prisma.visit.count({ where }),
      prisma.visit.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, phone: true } },
          deal: { select: { id: true, title: true, stage: true } },
          manager: { select: { id: true, name: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({ page, total, visits });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse({
      ...req.body,
      clientId: Number(req.body.clientId),
      dealId: req.body.dealId != null ? Number(req.body.dealId) : null,
      managerId: req.body.managerId != null ? Number(req.body.managerId) : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const managerId = parsed.data.managerId || req.user.id;
    if (!isSupervisor(req.user) && managerId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot assign visit to another manager' });
    }

    const client = await prisma.client.findFirst({
      where: clientOrgWhere(req.user, { id: parsed.data.clientId }),
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (managerId !== req.user.id) {
      const manager = await prisma.user.findFirst({
        where: userOrgWhere(req.user, { id: managerId }),
      });
      if (!manager) return res.status(400).json({ error: 'Manager not found in organization' });
    }

    const visit = await prisma.visit.create({
      data: {
        clientId: parsed.data.clientId,
        dealId: parsed.data.dealId || null,
        managerId,
        scheduledAt: new Date(parsed.data.scheduledAt),
        note: parsed.data.note || null,
      },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        deal: { select: { id: true, title: true } },
        manager: { select: { id: true, name: true } },
      },
    });

    await prisma.task.create({
      data: {
        title: `Визит: ${visit.client.name}`,
        description: visit.note || `Запись на ${visit.scheduledAt.toISOString()}`,
        assigneeId: managerId,
        createdById: req.user.id,
        dealId: visit.dealId || undefined,
        clientId: visit.clientId,
        dueAt: visit.scheduledAt,
      },
    });

    return res.status(201).json({ visit });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.visit.findUnique({
      where: { id },
      include: { client: { select: { organizationId: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Visit not found' });
    if (!sameOrganization(req.user, existing.client?.organizationId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!isSupervisor(req.user) && existing.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parsed = updateSchema.safeParse({
      ...req.body,
      managerId: req.body.managerId != null ? Number(req.body.managerId) : undefined,
      dealId:
        req.body.dealId !== undefined
          ? req.body.dealId == null
            ? null
            : Number(req.body.dealId)
          : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = { ...parsed.data };
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);

    const visit = await prisma.visit.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        deal: { select: { id: true, title: true } },
        manager: { select: { id: true, name: true } },
      },
    });

    if (parsed.data.status === 'NO_SHOW' && existing.status !== 'NO_SHOW') {
      await runVisitNoShowAutomation(visit);
    }

    return res.json({ visit });
  } catch (err) {
    return next(err);
  }
});

export default router;
