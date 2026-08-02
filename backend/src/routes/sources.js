import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireSupervisor, requireWrite } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (_req, res, next) => {
  try {
    const sources = await prisma.leadSource.findMany({ orderBy: { name: 'asc' } });
    return res.json({ sources });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireSupervisor, requireWrite, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const source = await prisma.leadSource.create({ data: { name } });
    return res.status(201).json({ source });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Source already exists' });
    return next(err);
  }
});

export default router;
