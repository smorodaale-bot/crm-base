import { prisma } from '../db.js';

export async function writeActivityLog(tx, { userId, action, entityType, entityId, metadata }) {
  const client = tx || prisma;
  return client.activityLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      metadata: metadata ?? undefined,
    },
  });
}

export async function writeDealHistory(tx, { dealId, field, oldValue, newValue, changedBy }) {
  const client = tx || prisma;
  return client.dealHistory.create({
    data: {
      dealId,
      field,
      oldValue: oldValue == null ? null : String(oldValue),
      newValue: newValue == null ? null : String(newValue),
      changedBy,
    },
  });
}

export async function notifyUser(tx, { userId, title, body, link }) {
  const client = tx || prisma;
  return client.notification.create({
    data: { userId, title, body: body || null, link: link || null },
  });
}
