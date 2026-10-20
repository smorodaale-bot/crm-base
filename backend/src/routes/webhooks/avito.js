import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { createInboundLead, leadPublicResponse } from '../../services/leads.js';
import { extractAvitoItemId, findVehicleByAvitoListing } from '../../utils/avitoListing.js';

const router = Router();

const avitoSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  itemId: z.union([z.string(), z.number()]).optional(),
  avitoItemId: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional().nullable(),
  phone: z.string().min(5),
  email: z.string().email().optional().nullable(),
  comment: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  itemTitle: z.string().optional().nullable(),
  itemUrl: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  amount: z.number().optional().nullable(),
  vehicleId: z.union([z.string(), z.number()]).optional().nullable(),
});

async function resolveAvitoOrg(req) {
  const header =
    req.headers['x-avito-token'] ||
    req.headers['x-lead-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.query.token;
  const token = header ? String(header).trim() : '';
  if (!token) return { error: { status: 401, body: { error: 'Avito token required (X-Avito-Token)' } } };

  const org = await prisma.organization.findFirst({
    where: { avitoWebhookToken: token },
    select: { id: true, name: true },
  });
  if (org) return { organization: org };

  const envToken = process.env.AVITO_WEBHOOK_TOKEN || process.env.LEAD_PUBLIC_TOKEN;
  const allowLegacy =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_LEGACY_LEAD_TOKEN === '1';
  if (allowLegacy && envToken && token === envToken) {
    const fallback = await prisma.organization.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    if (fallback) return { organization: fallback };
  }

  return { error: { status: 401, body: { error: 'Invalid Avito webhook token' } } };
}

/**
 * Generic Avito → CRM lead intake (per-org token from Org → Авито).
 * Map Zapier / Make / middleware to this payload.
 * Matches Vehicle by itemId / itemUrl when linked on the stock card.
 */
router.post('/', async (req, res, next) => {
  try {
    const resolved = await resolveAvitoOrg(req);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const body = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : req.body;
    const parsed = avitoSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const externalId = data.externalId ?? data.id;
    const comment = data.comment || data.message || null;
    const itemTitle = data.itemTitle || data.title || null;
    const itemUrl = data.itemUrl || data.url || null;
    const itemId =
      extractAvitoItemId(data.itemId) ||
      extractAvitoItemId(data.avitoItemId) ||
      extractAvitoItemId(itemUrl);

    let vehicleId = data.vehicleId != null && data.vehicleId !== '' ? Number(data.vehicleId) : null;
    if (vehicleId && Number.isNaN(vehicleId)) vehicleId = null;

    if (!vehicleId) {
      const matched = await findVehicleByAvitoListing(prisma, resolved.organization.id, {
        itemId,
        url: itemUrl,
      });
      if (matched) vehicleId = matched.id;
    } else {
      const owned = await prisma.vehicle.findFirst({
        where: {
          id: vehicleId,
          deletedAt: null,
          salon: { organizationId: resolved.organization.id },
        },
        select: { id: true },
      });
      if (!owned) vehicleId = null;
    }

    const result = await createInboundLead({
      name: data.name || 'Клиент Авито',
      phone: data.phone,
      email: data.email || null,
      comment,
      source: 'Авито',
      title: itemTitle ? `Авито: ${itemTitle}` : `Заявка с Авито: ${data.name || data.phone}`,
      sourceUrl: itemUrl,
      amount: data.amount ?? null,
      vehicleId,
      organizationId: resolved.organization.id,
      idempotencyKey: externalId ? `avito:${resolved.organization.id}:${externalId}` : null,
      notifyTitle: 'Новый лид с Авито',
      initialMessage: comment,
      messageChannel: 'SITE_WIDGET',
      messageExternalId: externalId ? String(externalId) : null,
    });

    const payload = leadPublicResponse(result);
    if (vehicleId) payload.vehicleId = vehicleId;
    if (itemId) payload.avitoItemId = itemId;

    return res.status(result.duplicate ? 200 : 201).json(payload);
  } catch (err) {
    if (err.message?.includes('Phone')) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

export default router;
