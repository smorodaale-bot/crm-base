import { z } from 'zod';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db.js';
import { createInboundLead, leadPublicResponse, runSlaCheck } from '../services/leads.js';
import { isSupervisor, serializeDeal } from '../utils/helpers.js';
import { notifyUser } from '../services/notify.js';
import { authenticate, requireWrite } from '../middleware/auth.js';

const router = Router();

const publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const publicLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().nullable(),
  comment: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  leadType: z.enum(['PURCHASE', 'CREDIT', 'TRADE_IN', 'BUYOUT']).optional(),
  utmSource: z.string().optional().nullable(),
  utmMedium: z.string().optional().nullable(),
  utmCampaign: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  vehicleId: z.number().int().optional().nullable(),
  amount: z.number().optional().nullable(),
  title: z.string().optional().nullable(),
  idempotencyKey: z.string().min(8).max(120).optional().nullable(),
  preferredManagerId: z.number().int().optional().nullable(),
});

async function resolveLeadOrganization(req) {
  const header =
    req.headers['x-lead-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.query.token;
  const token = header ? String(header).trim() : '';
  if (!token) {
    return { error: { status: 401, body: { error: 'Lead token required (X-Lead-Token)' } } };
  }

  const org = await prisma.organization.findFirst({
    where: { leadPublicToken: token },
    select: { id: true, name: true, leadWebsiteOrigins: true },
  });
  if (org) return { organization: org };

  // Legacy fallback: single env token → first organization (local/demo only)
  const allowLegacy =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_LEAD_TOKEN === '1';
  const envToken = process.env.LEAD_PUBLIC_TOKEN;
  if (allowLegacy && envToken && token === envToken) {
    const fallback = await prisma.organization.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, leadWebsiteOrigins: true },
    });
    if (fallback) return { organization: fallback };
  }

  return { error: { status: 401, body: { error: 'Invalid lead token' } } };
}

router.post('/public', publicLeadLimiter, async (req, res, next) => {
  try {
    const resolved = await resolveLeadOrganization(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const parsed = publicLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const result = await createInboundLead({
      ...data,
      organizationId: resolved.organization.id,
      source: data.source || 'Сайт',
      notifyTitle: 'Новый лид с сайта',
      messageChannel: 'SITE_WIDGET',
      initialMessage: data.comment || null,
    });
    return res.status(result.duplicate ? 200 : 201).json(leadPublicResponse(result));
  } catch (err) {
    if (err.message?.includes('Phone')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message?.includes('No managers')) {
      return res.status(503).json({ error: 'В организации нет менеджеров для назначения лида' });
    }
    return next(err);
  }
});

/**
 * Take lead into work: assign current user, stamp first response, NEW_LEAD → FIRST_CONTACT.
 */
router.post('/:id/claim', authenticate, requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid deal id' });

    const deal = await prisma.deal.findFirst({
      where: { id, deletedAt: null },
      include: {
        client: { select: { id: true, name: true, phone: true, source: true, organizationId: true } },
        responsible: { select: { id: true, name: true } },
        vehicle: true,
      },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const orgId = req.user.organizationId;
    if (orgId && deal.client?.organizationId && deal.client.organizationId !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const canClaim =
      isSupervisor(req.user) ||
      deal.responsibleId === req.user.id ||
      deal.responsibleId == null;
    if (!canClaim) {
      return res.status(403).json({ error: 'Лид назначен другому менеджеру' });
    }

    const now = new Date();
    const nextContact = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const data = {
      responsibleId: req.user.id,
      firstRespondedAt: deal.firstRespondedAt || now,
      stage: deal.stage === 'NEW_LEAD' ? 'FIRST_CONTACT' : deal.stage,
      ...(deal.stage === 'NEW_LEAD'
        ? { stageChangedAt: now, nextContactAt: nextContact }
        : {}),
    };

    const updated = await prisma.deal.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, name: true, phone: true, source: true } },
        responsible: { select: { id: true, name: true, email: true, role: true } },
        vehicle: true,
      },
    });

    if (deal.responsibleId && deal.responsibleId !== req.user.id) {
      await notifyUser(deal.responsibleId, {
        title: 'Лид перехвачен',
        body: `${req.user.name} взял в работу: ${deal.client?.name || deal.title}`,
        link: `/deals/${deal.id}`,
      });
    }

    return res.json({
      deal: serializeDeal(updated),
      message: 'Лид взят в работу',
    });
  } catch (err) {
    return next(err);
  }
});

/** Mark first response (manager touched deal). */
router.post('/:id/responded', authenticate, requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const deal = await prisma.deal.findFirst({ where: { id, deletedAt: null } });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (!deal.firstRespondedAt) {
      const updated = await prisma.deal.update({
        where: { id },
        data: {
          firstRespondedAt: new Date(),
          stage: deal.stage === 'NEW_LEAD' ? 'FIRST_CONTACT' : deal.stage,
          ...(deal.stage === 'NEW_LEAD' ? { stageChangedAt: new Date() } : {}),
        },
      });
      return res.json({ deal: serializeDeal(updated) });
    }
    return res.json({ deal: serializeDeal(deal) });
  } catch (err) {
    return next(err);
  }
});

/** Escalate SLA breaches. Used by cron script and manual ops. */
router.post('/sla-check', authenticate, async (req, res, next) => {
  try {
    if (!isSupervisor(req.user) && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Только руководитель может запускать SLA-проверку' });
    }
    const result = await runSlaCheck({
      organizationId: req.user.organizationId || undefined,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
