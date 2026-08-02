import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireSupervisor, requireWrite } from '../middleware/auth.js';
import { isSupervisor, parsePagination, publicUser } from '../utils/helpers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    return res.json({ users: users.map(publicUser) });
  } catch (err) {
    return next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'MANAGER', 'READONLY']),
});

router.post('/', requireSupervisor, requireWrite, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN' && req.body.role === 'ADMIN') {
      return res.status(403).json({ error: 'Only admin can create admins' });
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        passwordHash,
      },
    });
    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return next(err);
  }
});

export default router;
