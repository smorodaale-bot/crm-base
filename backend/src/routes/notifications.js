import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === '1';
    const where = {
      userId: req.user.id,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(req.query.limit) || 50, 100),
      }),
      prisma.notification.count({
        where: { userId: req.user.id, readAt: null },
      }),
    ]);

    return res.json({ notifications, unreadCount });
  } catch (err) {
    return next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { readAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
