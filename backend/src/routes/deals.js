import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, loadDealWithAccess, requireSupervisor, requireWrite } from '../middleware/auth.js';
import { notifyUser, writeActivityLog, writeDealHistory } from '../utils/audit.js';
import {
  DEAL_STAGES,
  STAGE_LABELS,
  daysBetween,
  endOfDay,
  isSupervisor,
  parsePagination,
  parseSort,
  serializeDeal,
  startOfDay,
  toCsv,
} from '../utils/helpers.js';
const router = Router();
router.use(authenticate);

const createDealSchema = z.object({
  clientId: z.number().int().positive(),
  title: z.string().min(1),
  amount: z.number().nonnegative(),
  stage: z.enum(DEAL_STAGES).optional(),
  responsibleId: z.number().int().positive().optional(),
  nextContactAt: z.string().datetime().optional().nullable(),
});

const updateDealSchema = z.object({
  title: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional(),
  nextContactAt: z.string().datetime().optional().nullable(),
  clientId: z.number().int().positive().optional(),
  lostReason: z.string().optional().nullable(),
});

const stageSchema = z.object({
  stage: z.enum(DEAL_STAGES),
  lostReason: z.string().optional().nullable(),
});

function dealWhereForUser(user, filters = {}) {
  const where = { deletedAt: null, ...filters };
  if (!isSupervisor(user)) {
    where.responsibleId = user.id;
  }
  return where;
}

function buildDealFilters(req) {
  const { stage, responsibleId, clientId, search, nextContactBefore, overdue, today } = req.query;
  const filters = {};

  if (stage) filters.stage = String(stage);
  if (clientId) filters.clientId = Number(clientId);
  if (responsibleId && isSupervisor(req.user)) {
    filters.responsibleId = Number(responsibleId);
  }

  if (overdue === '1' || overdue === 'true') {
    filters.nextContactAt = { lt: startOfDay() };
    filters.stage = filters.stage || { notIn: ['WON', 'LOST'] };
  } else if (today === '1' || today === 'true') {
    filters.nextContactAt = { gte: startOfDay(), lte: endOfDay() };
  } else if (nextContactBefore) {
    filters.nextContactAt = { lte: new Date(String(nextContactBefore)) };
  }

  const where = dealWhereForUser(req.user, filters);

  if (search) {
    const q = String(search);
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { client: { name: { contains: q, mode: 'insensitive' } } },
          { client: { phone: { contains: q } } },
        ],
      },
    ];
  }

  return where;
}

router.get('/meta/stages', (_req, res) => res.json({ stages: DEAL_STAGES, labels: STAGE_LABELS }));

const NEEDS_WORK_DAYS = 3;

router.get('/pipeline-stats', async (req, res, next) => {
  try {
    const where = dealWhereForUser(req.user);
    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        responsible: { select: { id: true, name: true } },
      },
    });

    const byStage = Object.fromEntries(
      DEAL_STAGES.map((s) => [
        s,
        { stage: s, label: STAGE_LABELS[s], count: 0, amount: 0 },
      ])
    );

    const needsWork = [];
    let openAmount = 0;
    let openDeals = 0;
    const todayStart = startOfDay();

    for (const d of deals) {
      const amount = Number(d.amount);
      byStage[d.stage].count += 1;
      byStage[d.stage].amount += amount;

      const isOpen = !['WON', 'LOST'].includes(d.stage);
      if (isOpen) {
        openDeals += 1;
        openAmount += amount;
        const days = daysBetween(d.stageChangedAt);
        const overdueContact = d.nextContactAt && new Date(d.nextContactAt) < todayStart;
        const stuck = days >= NEEDS_WORK_DAYS;
        if (stuck || overdueContact) {
          needsWork.push({
            ...serializeDeal(d),
            daysInStage: days,
            reason: overdueContact
              ? 'Просрочен следующий контакт'
              : `На этапе уже ${days} дн.`,
            needsWorkReasons: [
              ...(stuck ? [`Долго на этапе (${days} дн.)`] : []),
              ...(overdueContact ? ['Просрочен контакт'] : []),
            ],
          });
        }
      }
    }

    needsWork.sort((a, b) => (b.daysInStage || 0) - (a.daysInStage || 0));

    const snapshotPayload = {
      totalDeals: deals.length,
      openDeals,
      openAmount,
      needsWorkCount: needsWork.length,
      byStage,
    };

    const day = startOfDay();
    const saved = await prisma.funnelSnapshot.upsert({
      where: { day },
      create: {
        day,
        totalDeals: snapshotPayload.totalDeals,
        openDeals: snapshotPayload.openDeals,
        openAmount: snapshotPayload.openAmount,
        needsWorkCount: snapshotPayload.needsWorkCount,
        byStage: byStage,
      },
      update: {
        totalDeals: snapshotPayload.totalDeals,
        openDeals: snapshotPayload.openDeals,
        openAmount: snapshotPayload.openAmount,
        needsWorkCount: snapshotPayload.needsWorkCount,
        byStage: byStage,
      },
    });

    const history = await prisma.funnelSnapshot.findMany({
      orderBy: { day: 'desc' },
      take: 14,
    });

    return res.json({
      ...snapshotPayload,
      needsWork: needsWork.slice(0, 30),
      needsWorkDays: NEEDS_WORK_DAYS,
      snapshotSavedAt: saved.updatedAt,
      history,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/reminders', async (req, res, next) => {
  try {
    const base = dealWhereForUser(req.user, {
      stage: { notIn: ['WON', 'LOST'] },
      nextContactAt: { not: null },
    });

    const [overdue, today] = await Promise.all([
      prisma.deal.findMany({
        where: { ...base, nextContactAt: { lt: startOfDay() } },
        include: {
          client: true,
          responsible: { select: { id: true, name: true } },
        },
        orderBy: { nextContactAt: 'asc' },
        take: 50,
      }),
      prisma.deal.findMany({
        where: { ...base, nextContactAt: { gte: startOfDay(), lte: endOfDay() } },
        include: {
          client: true,
          responsible: { select: { id: true, name: true } },
        },
        orderBy: { nextContactAt: 'asc' },
        take: 50,
      }),
    ]);

    return res.json({
      overdue: overdue.map(serializeDeal),
      today: today.map(serializeDeal),
      counts: { overdue: overdue.length, today: today.length },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/export.csv', async (req, res, next) => {
  try {
    const where = buildDealFilters(req);
    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: true,
        responsible: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });

    const csv = toCsv(deals.map(serializeDeal), [
      { header: 'ID', value: (d) => d.id },
      { header: 'Название', value: (d) => d.title },
      { header: 'Клиент', value: (d) => d.client?.name },
      { header: 'Телефон', value: (d) => d.client?.phone },
      { header: 'Сумма', value: (d) => d.amount },
      { header: 'Этап', value: (d) => STAGE_LABELS[d.stage] || d.stage },
      { header: 'Ответственный', value: (d) => d.responsible?.name },
      { header: 'Причина отказа', value: (d) => d.lostReason },
      { header: 'След. контакт', value: (d) => d.nextContactAt },
      { header: 'Дней на этапе', value: (d) => daysBetween(d.stageChangedAt) },
      { header: 'Создана', value: (d) => d.createdAt },
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deals.csv"');
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const where = buildDealFilters(req);
    const { page, limit, skip } = parsePagination(req.query);
    const orderBy = parseSort(
      req.query,
      ['updatedAt', 'createdAt', 'amount', 'title', 'stage', 'nextContactAt', 'stageChangedAt'],
      { field: 'updatedAt', dir: 'desc' }
    );

    const [total, deals] = await Promise.all([
      prisma.deal.count({ where }),
      prisma.deal.findMany({
        where,
        include: {
          client: true,
          responsible: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    return res.json({
      deals: deals.map((d) => ({
        ...serializeDeal(d),
        daysInStage: daysBetween(d.stageChangedAt),
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const parsed = createDealSchema.safeParse({
      ...req.body,
      clientId: Number(req.body.clientId),
      amount: Number(req.body.amount),
      responsibleId:
        req.body.responsibleId == null || req.body.responsibleId === ''
          ? undefined
          : Number(req.body.responsibleId),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, deletedAt: null },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    let responsibleId = parsed.data.responsibleId;
    if (!isSupervisor(req.user)) {
      responsibleId = req.user.id;
    } else if (!responsibleId) {
      responsibleId = req.user.id;
    } else {
      const assignee = await prisma.user.findFirst({
        where: { id: responsibleId, deletedAt: null },
      });
      if (!assignee) return res.status(400).json({ error: 'Responsible user not found' });
    }

    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          clientId: parsed.data.clientId,
          title: parsed.data.title,
          amount: parsed.data.amount,
          stage: parsed.data.stage || 'NEW_LEAD',
          stageChangedAt: new Date(),
          responsibleId,
          nextContactAt: parsed.data.nextContactAt ? new Date(parsed.data.nextContactAt) : null,
        },
        include: {
          client: true,
          responsible: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      await writeDealHistory(tx, {
        dealId: created.id,
        field: 'created',
        oldValue: null,
        newValue: created.stage,
        changedBy: req.user.id,
      });

      await writeActivityLog(tx, {
        userId: req.user.id,
        action: 'deal_created',
        entityType: 'deal',
        entityId: created.id,
        metadata: { title: created.title, stage: created.stage, responsibleId },
      });

      if (responsibleId !== req.user.id) {
        await notifyUser(tx, {
          userId: responsibleId,
          title: 'Вам назначена сделка',
          body: created.title,
          link: `/deals/${created.id}`,
        });
      }

      return created;
    });

    return res.status(201).json({ deal: serializeDeal(deal) });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', loadDealWithAccess, (req, res) => {
  return res.json({
    deal: {
      ...serializeDeal(req.deal),
      daysInStage: daysBetween(req.deal.stageChangedAt),
    },
  });
});

router.patch('/:id', requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    const parsed = updateDealSchema.safeParse({
      ...req.body,
      amount: req.body.amount === undefined ? undefined : Number(req.body.amount),
      clientId: req.body.clientId === undefined ? undefined : Number(req.body.clientId),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const data = { ...parsed.data };
    if (data.nextContactAt !== undefined) {
      data.nextContactAt = data.nextContactAt ? new Date(data.nextContactAt) : null;
    }

    const deal = await prisma.deal.update({
      where: { id: req.deal.id },
      data,
      include: {
        client: true,
        responsible: { select: { id: true, name: true, email: true, role: true } },
        comments: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
        history: {
          include: { changer: { select: { id: true, name: true, email: true } } },
          orderBy: { changedAt: 'desc' },
        },
        attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        tasks: {
          where: { deletedAt: null },
          include: { assignee: { select: { id: true, name: true } } },
          orderBy: { dueAt: 'asc' },
        },
      },
    });

    return res.json({ deal: serializeDeal(deal) });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/stage', requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    const parsed = stageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    if (parsed.data.stage === 'LOST' && !parsed.data.lostReason && !req.deal.lostReason) {
      return res.status(400).json({ error: 'Укажите причину отказа' });
    }

    if (parsed.data.stage === req.deal.stage && !parsed.data.lostReason) {
      return res.json({ deal: serializeDeal(req.deal) });
    }

    const deal = await prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id: req.deal.id },
        data: {
          stage: parsed.data.stage,
          stageChangedAt: parsed.data.stage !== req.deal.stage ? new Date() : req.deal.stageChangedAt,
          lostReason:
            parsed.data.stage === 'LOST'
              ? parsed.data.lostReason || req.deal.lostReason
              : parsed.data.stage === 'WON'
                ? null
                : req.deal.lostReason,
        },
        include: {
          client: true,
          responsible: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      if (parsed.data.stage !== req.deal.stage) {
        await writeDealHistory(tx, {
          dealId: updated.id,
          field: 'stage',
          oldValue: req.deal.stage,
          newValue: updated.stage,
          changedBy: req.user.id,
        });
        await writeActivityLog(tx, {
          userId: req.user.id,
          action: 'stage_changed',
          entityType: 'deal',
          entityId: updated.id,
          metadata: {
            from: req.deal.stage,
            to: updated.stage,
            lostReason: updated.lostReason,
          },
        });
      }

      if (parsed.data.stage === 'LOST' && parsed.data.lostReason) {
        await writeDealHistory(tx, {
          dealId: updated.id,
          field: 'lost_reason',
          oldValue: req.deal.lostReason,
          newValue: parsed.data.lostReason,
          changedBy: req.user.id,
        });
      }

      return updated;
    });

    return res.json({ deal: serializeDeal(deal) });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/responsible', requireWrite, loadDealWithAccess, requireSupervisor, async (req, res, next) => {
  try {
    const responsibleId = Number(req.body.responsibleId);
    if (!Number.isFinite(responsibleId)) {
      return res.status(400).json({ error: 'responsibleId required' });
    }

    const assignee = await prisma.user.findFirst({
      where: { id: responsibleId, deletedAt: null },
    });
    if (!assignee) return res.status(400).json({ error: 'Responsible user not found' });

    if (responsibleId === req.deal.responsibleId) {
      return res.json({ deal: serializeDeal(req.deal) });
    }

    const deal = await prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id: req.deal.id },
        data: { responsibleId },
        include: {
          client: true,
          responsible: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      await writeDealHistory(tx, {
        dealId: updated.id,
        field: 'responsible_id',
        oldValue: req.deal.responsibleId,
        newValue: updated.responsibleId,
        changedBy: req.user.id,
      });

      await writeActivityLog(tx, {
        userId: req.user.id,
        action: 'responsible_changed',
        entityType: 'deal',
        entityId: updated.id,
        metadata: { from: req.deal.responsibleId, to: updated.responsibleId },
      });

      await notifyUser(tx, {
        userId: responsibleId,
        title: 'Вам передана сделка',
        body: updated.title,
        link: `/deals/${updated.id}`,
      });

      return updated;
    });

    return res.json({ deal: serializeDeal(deal) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    await prisma.deal.update({
      where: { id: req.deal.id },
      data: { deletedAt: new Date() },
    });
    await writeActivityLog(null, {
      userId: req.user.id,
      action: 'deal_deleted',
      entityType: 'deal',
      entityId: req.deal.id,
      metadata: { title: req.deal.title },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/history', loadDealWithAccess, (req, res) => {
  return res.json({ history: req.deal.history || [] });
});

router.get('/:id/comments', loadDealWithAccess, (req, res) => {
  return res.json({ comments: req.deal.comments || [] });
});

router.post('/:id/comments', requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });

    const comment = await prisma.comment.create({
      data: { dealId: req.deal.id, authorId: req.user.id, text },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    if (req.deal.responsibleId !== req.user.id) {
      await notifyUser(null, {
        userId: req.deal.responsibleId,
        title: 'Новый комментарий к сделке',
        body: text.slice(0, 120),
        link: `/deals/${req.deal.id}`,
      });
    }

    return res.status(201).json({ comment });
  } catch (err) {
    return next(err);
  }
});

export default router;
