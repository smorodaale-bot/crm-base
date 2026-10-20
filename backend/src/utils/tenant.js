import { isSupervisor } from './helpers.js';

/** Require user to belong to an organization (SaaS tenant). */
export function requireOrganization(req, res, next) {
  if (!req.user?.organizationId) {
    return res.status(400).json({
      error: 'Пользователь не привязан к организации. Завершите регистрацию салона.',
      code: 'NO_ORGANIZATION',
    });
  }
  return next();
}

/** Prisma filter for Client rows in the current tenant. */
export function clientOrgWhere(user, extra = {}) {
  const where = { deletedAt: null, ...extra };
  if (user?.organizationId) {
    where.organizationId = user.organizationId;
  } else {
    where.id = -1;
  }
  return where;
}

/**
 * Prisma filter for Deal rows scoped to tenant (+ manager if not supervisor).
 * Uses client.organizationId because Deal has no direct organizationId.
 */
export function dealOrgWhere(user, extra = {}) {
  const { client: clientExtra, ...rest } = extra;
  const where = { deletedAt: null, ...rest };
  if (user?.organizationId) {
    where.client = {
      ...(typeof clientExtra === 'object' && clientExtra ? clientExtra : {}),
      organizationId: user.organizationId,
    };
  } else {
    where.id = -1;
  }
  if (!isSupervisor(user)) {
    where.responsibleId = user.id;
  }
  return where;
}

/** Open deals whose next contact is already due. Same filter for dashboard, inbox, reminders. */
export function overdueContactWhere(user, now = new Date()) {
  return dealOrgWhere(user, {
    stage: { notIn: ['WON', 'LOST'] },
    nextContactAt: { lt: now },
  });
}

/** User rows in the same organization. */
export function userOrgWhere(user, extra = {}) {
  const where = { deletedAt: null, ...extra };
  if (user?.organizationId) {
    where.organizationId = user.organizationId;
  } else {
    where.id = -1;
  }
  return where;
}

/** Tasks scoped to tenant via assignee.organizationId. */
export function taskOrgWhere(user, extra = {}) {
  const where = { deletedAt: null, ...extra };
  if (user?.organizationId) {
    where.assignee = { organizationId: user.organizationId };
  } else {
    where.id = -1;
  }
  if (!isSupervisor(user)) {
    where.assigneeId = user.id;
  }
  return where;
}

/** Visits scoped via client.organizationId (+ manager for non-supervisors). */
export function visitOrgWhere(user, extra = {}) {
  const { client: clientExtra, ...rest } = extra;
  const where = { ...rest };
  if (user?.organizationId) {
    where.client = {
      ...(typeof clientExtra === 'object' && clientExtra ? clientExtra : {}),
      organizationId: user.organizationId,
    };
  } else {
    where.id = -1;
  }
  if (!isSupervisor(user)) {
    where.managerId = user.id;
  }
  return where;
}

/** Stock vehicles for salons of this organization. */
export function vehicleOrgWhere(user, extra = {}) {
  const where = { deletedAt: null, ...extra };
  if (user?.organizationId) {
    where.salon = { organizationId: user.organizationId };
  } else {
    where.id = -1;
  }
  return where;
}

/** QC reviews for managers in this organization. */
export function qcOrgWhere(user, extra = {}) {
  const where = { ...extra };
  if (user?.organizationId) {
    where.manager = { organizationId: user.organizationId };
  } else {
    where.id = -1;
  }
  return where;
}

/** True if client belongs to user's org (or user has no org — deny). */
export function sameOrganization(user, entityOrgId) {
  if (!user?.organizationId) return false;
  if (entityOrgId == null) return false;
  return Number(user.organizationId) === Number(entityOrgId);
}

export function forbidCrossOrg(user, entityOrgId) {
  if (!sameOrganization(user, entityOrgId)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }
}
