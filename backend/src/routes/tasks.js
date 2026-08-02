import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireWrite } from '../middleware/auth.js';
import { endOfDay, isSupervisor, parsePagination, startOfDay } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  dealId: z.number().int().positive().optional().nullable(),
  clientId: z.number().int().positive().optional().nullable(),
  assigneeId: z.number().int().positive().optional(),
  status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const where = { deletedAt: null };
    if (!isSupervisor(req.user)) {
      where.assigneeId = req.user.id;
    } else if (req.query.assigneeId) {
      where.assigneeId = Number(req.query.assigneeId);
    }
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.dealId) where.dealId = Number(req.query.dealId);
    if (req.query.clientId) where.clientId = Number(req.query.clientId);
    if (req.query.dueFrom || req.query.dueTo) {
      where.dueAt = {};
      if (req.query.dueFrom) where.dueAt.gte = new Date(String(req.query.dueFrom));
      if (req.query.dueTo) where.dueAt.lte = new Date(String(req.query.dueTo));
    }
    if (req.query.overdue === '1') {
      where.status = 'OPEN';
      where.dueAt = { lt: startOfDay() };
    }
    if (req.query.today === '1') {
      where.dueAt = { gte: startOfDay(), lte: endOfDay() };
    }

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        include: {
          assignee: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
          client: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    return res.json({ tasks, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const parsed = taskSchema.safeParse({
      ...req.body,
      dealId: req.body.dealId ? Number(req.body.dealId) : null,
      clientId: req.body.clientId ? Number(req.body.clientId) : null,
      assigneeId: req.body.assigneeId ? Number(req.body.assigneeId) : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    let assigneeId = parsed.data.assigneeId || req.user.id;
    if (!isSupervisor(req.user)) assigneeId = req.user.id;

    const task = await prisma.task.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description || null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        dealId: parsed.data.dealId || null,
        clientId: parsed.data.clientId || null,
        assigneeId,
        createdById: req.user.id,
      },
      include: {
        assignee: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        client: { select: { id: true, name: true } },
      },
    });

    return res.status(201).json({ task });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!isSupervisor(req.user) && existing.assigneeId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const parsed = taskSchema.partial().safeParse({
      ...req.body,
      dealId: req.body.dealId === undefined ? undefined : req.body.dealId ? Number(req.body.dealId) : null,
      clientId:
        req.body.clientId === undefined ? undefined : req.body.clientId ? Number(req.body.clientId) : null,
      assigneeId: req.body.assigneeId === undefined ? undefined : Number(req.body.assigneeId),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = { ...parsed.data };
    if (data.dueAt !== undefined) data.dueAt = data.dueAt ? new Date(data.dueAt) : null;
    if (data.status === 'DONE') data.completedAt = new Date();
    if (data.status && data.status !== 'DONE') data.completedAt = null;
    if (data.assigneeId && !isSupervisor(req.user)) delete data.assigneeId;

    const task = await prisma.task.update({
      where: { id },
      data,
      include: {
        assignee: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        client: { select: { id: true, name: true } },
      },
    });

    return res.json({ task });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!isSupervisor(req.user) && existing.assigneeId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
