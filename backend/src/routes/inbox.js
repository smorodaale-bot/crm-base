import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { endOfDay, isSupervisor, serializeDeal, startOfDay } from '../utils/helpers.js';
import { overdueContactWhere } from '../utils/tenant.js';

const router = Router();
router.use(authenticate);

function orgDealScope(user) {
  const scope = { deletedAt: null };
  if (user.organizationId) {
    scope.client = { organizationId: user.organizationId };
  }
  if (!isSupervisor(user)) scope.responsibleId = user.id;
  return scope;
}

/** Manager workbench: new leads, overdue contact, visits today, SLA breaches. */
router.get('/', async (req, res, next) => {
  try {
    const dealScope = orgDealScope(req.user);

    const visitScope = {
      status: 'SCHEDULED',
      scheduledAt: { gte: startOfDay(), lte: endOfDay() },
    };
    if (!isSupervisor(req.user)) {
      visitScope.managerId = req.user.id;
    } else if (req.user.organizationId) {
      visitScope.manager = { organizationId: req.user.organizationId };
    }

    const taskScope = {
      deletedAt: null,
      status: 'OPEN',
      ...(isSupervisor(req.user)
        ? req.user.organizationId
          ? { assignee: { organizationId: req.user.organizationId } }
          : {}
        : { assigneeId: req.user.id }),
    };

    const [newLeads, overdueContact, slaBreached, visitsToday, openTasks, overdueCount] = await Promise.all([
      prisma.deal.findMany({
        where: { ...dealScope, stage: 'NEW_LEAD' },
        include: {
          client: { select: { id: true, name: true, phone: true, source: true } },
          responsible: { select: { id: true, name: true } },
          vehicle: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.deal.findMany({
        where: overdueContactWhere(req.user),
        include: {
          client: { select: { id: true, name: true, phone: true, source: true } },
          responsible: { select: { id: true, name: true } },
        },
        orderBy: { nextContactAt: 'asc' },
        take: 200,
      }),
      prisma.deal.findMany({
        where: {
          ...dealScope,
          stage: 'NEW_LEAD',
          firstRespondedAt: null,
          OR: [{ slaBreachedAt: { not: null } }, { nextContactAt: { lt: new Date() } }],
        },
        include: {
          client: { select: { id: true, name: true, phone: true, source: true } },
          responsible: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
      prisma.visit.findMany({
        where: visitScope,
        include: {
          client: { select: { id: true, name: true, phone: true } },
          deal: { select: { id: true, title: true } },
          manager: { select: { id: true, name: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      }),
      prisma.task.count({ where: taskScope }),
      prisma.deal.count({ where: overdueContactWhere(req.user) }),
    ]);

    return res.json({
      newLeads: newLeads.map(serializeDeal),
      overdueContact: overdueContact.map(serializeDeal),
      slaBreached: slaBreached.map(serializeDeal),
      visitsToday,
      counts: {
        newLeads: newLeads.length,
        overdueContact: overdueCount,
        slaBreached: slaBreached.length,
        visitsToday: visitsToday.length,
        openTasks,
      },
      slaMinutes: Number(process.env.LEAD_SLA_MINUTES || 15),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
