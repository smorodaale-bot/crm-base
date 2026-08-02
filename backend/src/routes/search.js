import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { isSupervisor, serializeDeal } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ clients: [], deals: [], tasks: [] });
    }

    const dealWhere = {
      deletedAt: null,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { client: { name: { contains: q, mode: 'insensitive' } } },
        { client: { phone: { contains: q } } },
      ],
    };
    if (!isSupervisor(req.user)) dealWhere.responsibleId = req.user.id;

    const taskWhere = {
      deletedAt: null,
      title: { contains: q, mode: 'insensitive' },
    };
    if (!isSupervisor(req.user)) taskWhere.assigneeId = req.user.id;

    const [clients, deals, tasks] = await Promise.all([
      prisma.client.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.deal.findMany({
        where: dealWhere,
        include: {
          client: true,
          responsible: { select: { id: true, name: true } },
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.task.findMany({
        where: taskWhere,
        include: {
          assignee: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return res.json({
      clients,
      deals: deals.map(serializeDeal),
      tasks,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
