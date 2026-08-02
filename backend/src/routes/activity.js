import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { isSupervisor, parsePagination } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const where = {};

    if (!isSupervisor(req.user)) {
      where.userId = req.user.id;
    } else if (req.query.userId) {
      where.userId = Number(req.query.userId);
    }

    if (req.query.action) where.action = String(req.query.action);
    if (req.query.entityType) where.entityType = String(req.query.entityType);
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({
      logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
