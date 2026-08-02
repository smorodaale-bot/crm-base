import { Router } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireWrite } from '../middleware/auth.js';
import { isSupervisor } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (_req, res, next) => {
  try {
    const templates = await prisma.commentTemplate.findMany({
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { title: 'asc' },
    });
    return res.json({ templates });
  } catch (err) {
    return next(err);
  }
});

router.post('/', requireWrite, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const text = String(req.body.text || '').trim();
    if (!title || !text) return res.status(400).json({ error: 'title and text required' });

    const template = await prisma.commentTemplate.create({
      data: { title, text, createdBy: req.user.id },
      include: { creator: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ template });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.commentTemplate.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!isSupervisor(req.user) && existing.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await prisma.commentTemplate.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
