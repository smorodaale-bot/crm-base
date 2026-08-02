import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireSupervisor } from '../middleware/auth.js';
import { DEAL_STAGES, STAGE_LABELS, daysBetween, isSupervisor, startOfDay } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const dealWhere = { deletedAt: null };
    if (!isSupervisor(req.user)) dealWhere.responsibleId = req.user.id;

    const deals = await prisma.deal.findMany({
      where: dealWhere,
      include: {
        responsible: { select: { id: true, name: true } },
        client: { select: { id: true, name: true, source: true, utmSource: true } },
      },
    });

    const byStage = Object.fromEntries(
      DEAL_STAGES.map((s) => [s, { count: 0, amount: 0, label: STAGE_LABELS[s] }])
    );
    const byManager = {};
    const bySource = {};
    const lostReasons = {};
    let won = 0;
    let lost = 0;
    let openAmount = 0;
    const sla = [];

    for (const d of deals) {
      const amount = Number(d.amount);
      byStage[d.stage].count += 1;
      byStage[d.stage].amount += amount;

      const mid = d.responsibleId;
      if (!byManager[mid]) {
        byManager[mid] = {
          id: mid,
          name: d.responsible?.name || `#${mid}`,
          count: 0,
          amount: 0,
          open: 0,
        };
      }
      byManager[mid].count += 1;
      byManager[mid].amount += amount;
      if (!['WON', 'LOST'].includes(d.stage)) byManager[mid].open += 1;

      const src = d.client?.source || d.client?.utmSource || 'Не указан';
      if (!bySource[src]) bySource[src] = { source: src, count: 0, amount: 0 };
      bySource[src].count += 1;
      bySource[src].amount += amount;

      if (d.stage === 'WON') won += 1;
      if (d.stage === 'LOST') {
        lost += 1;
        const reason = d.lostReason || 'Не указана';
        lostReasons[reason] = (lostReasons[reason] || 0) + 1;
      }
      if (!['WON', 'LOST'].includes(d.stage)) {
        openAmount += amount;
        const days = daysBetween(d.stageChangedAt);
        if (days >= 3) {
          sla.push({
            id: d.id,
            title: d.title,
            stage: d.stage,
            daysInStage: days,
            responsible: d.responsible?.name,
            amount,
          });
        }
      }
    }

    sla.sort((a, b) => b.daysInStage - a.daysInStage);

    const closed = won + lost;
    const conversion = closed ? Math.round((won / closed) * 100) : 0;

    const overdueContacts = await prisma.deal.count({
      where: {
        ...dealWhere,
        stage: { notIn: ['WON', 'LOST'] },
        nextContactAt: { lt: startOfDay() },
      },
    });

    const overdueTasks = await prisma.task.count({
      where: {
        deletedAt: null,
        status: 'OPEN',
        dueAt: { lt: startOfDay() },
        ...(isSupervisor(req.user) ? {} : { assigneeId: req.user.id }),
      },
    });

    return res.json({
      summary: {
        totalDeals: deals.length,
        openAmount,
        won,
        lost,
        conversion,
        overdueContacts,
        overdueTasks,
      },
      byStage,
      byManager: Object.values(byManager),
      bySource: Object.values(bySource).sort((a, b) => b.count - a.count),
      lostReasons: Object.entries(lostReasons).map(([reason, count]) => ({ reason, count })),
      sla: sla.slice(0, 20),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/supervisor', requireSupervisor, async (req, res, next) => {
  try {
    req.url = '/';
    return router.handle(req, res, next);
  } catch (err) {
    return next(err);
  }
});

export default router;
