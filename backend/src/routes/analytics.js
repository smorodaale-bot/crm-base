import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireSupervisor } from '../middleware/auth.js';
import { DEAL_STAGES, daysBetween } from '../utils/helpers.js';
import { dealOrgWhere, overdueContactWhere, visitOrgWhere, qcOrgWhere } from '../utils/tenant.js';
import { conversionRate, CONVERSION_STALE_DAYS } from '../utils/conversion.js';

const router = Router();
router.use(authenticate, requireSupervisor);

/** Manager-level analytics: conversion, response SLA, visits, vehicles linked. */
router.get('/', async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      where: dealOrgWhere(req.user),
      select: {
        id: true,
        stage: true,
        responsibleId: true,
        vehicleId: true,
        slaBreachedAt: true,
        firstRespondedAt: true,
        createdAt: true,
        stageChangedAt: true,
        responsible: { select: { id: true, name: true } },
      },
    });

    const visits = await prisma.visit.findMany({
      where: visitOrgWhere(req.user),
      select: { status: true, managerId: true },
    });

    const qc = await prisma.qcReview.groupBy({
      by: ['managerId'],
      _avg: { overallScore: true },
      _count: { _all: true },
      where: { ...qcOrgWhere(req.user), isCritical: false },
    });
    const qcCritical = await prisma.qcReview.groupBy({
      by: ['managerId'],
      _count: { _all: true },
      where: { ...qcOrgWhere(req.user), isCritical: true },
    });

    const byManager = {};
    let withVehicle = 0;
    let responseSumMs = 0;
    let responseCount = 0;
    let slaBreaches = 0;
    let visitsTotal = 0;
    let visitsNoShow = 0;
    let visitsCompleted = 0;

    for (const d of deals) {
      const mid = d.responsibleId;
      if (!byManager[mid]) {
        byManager[mid] = {
          id: mid,
          name: d.responsible?.name || `#${mid}`,
          deals: 0,
          won: 0,
          lost: 0,
          withVehicle: 0,
          avgResponseMinutes: null,
          responseSamples: 0,
          responseTotalMs: 0,
          slaBreaches: 0,
          visits: 0,
          noShows: 0,
          staleOpen: 0,
        };
      }
      const row = byManager[mid];
      row.deals += 1;
      if (d.stage === 'WON') row.won += 1;
      if (d.stage === 'LOST') row.lost += 1;
      if (!['WON', 'LOST'].includes(d.stage) && daysBetween(d.createdAt) >= CONVERSION_STALE_DAYS) {
        row.staleOpen += 1;
      }
      if (d.vehicleId) {
        withVehicle += 1;
        row.withVehicle += 1;
      }
      if (d.slaBreachedAt) {
        slaBreaches += 1;
        row.slaBreaches += 1;
      }
      if (d.firstRespondedAt) {
        const ms = new Date(d.firstRespondedAt) - new Date(d.createdAt);
        if (ms >= 0) {
          responseSumMs += ms;
          responseCount += 1;
          row.responseTotalMs += ms;
          row.responseSamples += 1;
        }
      }
    }

    for (const v of visits) {
      visitsTotal += 1;
      if (v.status === 'NO_SHOW') visitsNoShow += 1;
      if (v.status === 'COMPLETED') visitsCompleted += 1;
      const row = byManager[v.managerId];
      if (row) {
        row.visits += 1;
        if (v.status === 'NO_SHOW') row.noShows += 1;
      }
    }

    const qcMap = Object.fromEntries(qc.map((r) => [r.managerId, r]));
    const critMap = Object.fromEntries(qcCritical.map((r) => [r.managerId, r._count._all]));

    const managers = Object.values(byManager).map((m) => {
      const rate = conversionRate({
        won: m.won,
        lost: m.lost,
        staleOpen: m.staleOpen,
        totalDeals: m.deals,
      });
      const avgResponseMinutes =
        m.responseSamples > 0 ? Math.round(m.responseTotalMs / m.responseSamples / 60000) : null;
      const q = qcMap[m.id];
      return {
        id: m.id,
        name: m.name,
        deals: m.deals,
        won: m.won,
        lost: m.lost,
        conversion: rate.conversion,
        conversionLabel: rate.conversionLabel,
        withVehiclePct: m.deals ? Math.round((m.withVehicle / m.deals) * 100) : 0,
        avgResponseMinutes,
        slaBreaches: m.slaBreaches,
        visits: m.visits,
        noShowPct: m.visits ? Math.round((m.noShows / m.visits) * 100) : 0,
        qcAvg: q?._avg?.overallScore != null ? Math.round(q._avg.overallScore) : null,
        qcCount: q?._count?._all || 0,
        qcCritical: critMap[m.id] || 0,
      };
    });

    const stageCounts = Object.fromEntries(DEAL_STAGES.map((s) => [s, 0]));
    for (const d of deals) stageCounts[d.stage] += 1;

    const openDeals = deals.filter((d) => !['WON', 'LOST'].includes(d.stage));
    const needsWork = openDeals.filter((d) => daysBetween(d.stageChangedAt) >= 3).length;

    return res.json({
      summary: {
        totalDeals: deals.length,
        withVehiclePct: deals.length ? Math.round((withVehicle / deals.length) * 100) : 0,
        avgResponseMinutes: responseCount ? Math.round(responseSumMs / responseCount / 60000) : null,
        slaBreaches,
        visitsTotal,
        visitsCompleted,
        noShowPct: visitsTotal ? Math.round((visitsNoShow / visitsTotal) * 100) : 0,
        needsWork,
        overdueContacts: await prisma.deal.count({
          where: overdueContactWhere(req.user),
        }),
      },
      byStage: stageCounts,
      managers: managers.sort((a, b) => b.deals - a.deals),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
