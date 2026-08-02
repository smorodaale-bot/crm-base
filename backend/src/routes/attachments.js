import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { authenticate, loadDealWithAccess, requireWrite } from '../middleware/auth.js';
import { writeActivityLog } from '../utils/audit.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router({ mergeParams: true });

router.get('/:id/files', authenticate, loadDealWithAccess, async (req, res) => {
  return res.json({ files: req.deal.attachments || [] });
});

router.post(
  '/:id/files',
  authenticate,
  requireWrite,
  loadDealWithAccess,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });

      const file = await prisma.attachment.create({
        data: {
          dealId: req.deal.id,
          uploadedById: req.user.id,
          originalName: req.file.originalname,
          storedName: req.file.filename,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
      });

      await writeActivityLog(null, {
        userId: req.user.id,
        action: 'file_uploaded',
        entityType: 'deal',
        entityId: req.deal.id,
        metadata: { file: file.originalName },
      });

      return res.status(201).json({ file });
    } catch (err) {
      return next(err);
    }
  }
);

router.get('/:id/files/:fileId/download', authenticate, loadDealWithAccess, async (req, res, next) => {
  try {
    const fileId = Number(req.params.fileId);
    const file = await prisma.attachment.findFirst({
      where: { id: fileId, dealId: req.deal.id, deletedAt: null },
    });
    if (!file) return res.status(404).json({ error: 'File not found' });

    const full = path.join(config.uploadDir, file.storedName);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing on disk' });

    return res.download(full, file.originalName);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/files/:fileId', authenticate, requireWrite, loadDealWithAccess, async (req, res, next) => {
  try {
    const fileId = Number(req.params.fileId);
    const file = await prisma.attachment.findFirst({
      where: { id: fileId, dealId: req.deal.id, deletedAt: null },
    });
    if (!file) return res.status(404).json({ error: 'File not found' });

    await prisma.attachment.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
