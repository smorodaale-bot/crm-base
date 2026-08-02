import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import {
  authenticate,
  requireSupervisor,
  requireWrite,
} from '../middleware/auth.js';
import { parsePagination } from '../utils/helpers.js';
import { writeActivityLog } from '../utils/audit.js';
import { analyzeTranscript, effectiveScore } from '../qc/analyzer.js';
import { llmConfigured, maybeEnhanceWithLlm, transcribeAudioFile } from '../qc/llm.js';
import { ALL_CRITERIA, CRITERION_LABELS } from '../qc/criteria.js';
import { TEST_CONVERSATIONS } from '../qc/fixtures.js';

const router = Router();

router.use(authenticate, requireSupervisor);

const audioDir = path.join(config.uploadDir, 'qc-audio');
fs.mkdirSync(audioDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, audioDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith('audio/') ||
      /\.(mp3|wav|ogg|webm|m4a|mpeg)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only audio files allowed'), ok);
  },
});

function serializeReview(review) {
  if (!review) return review;
  return {
    ...review,
    effectiveScore: effectiveScore(review),
    criterionLabels: CRITERION_LABELS,
  };
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  managerId: z.coerce.number().int().positive(),
  transcript: z.string().min(20).optional(),
  clientName: z.string().max(200).optional().nullable(),
  useLlm: z.union([z.boolean(), z.string()]).optional(),
});

router.get('/criteria', (_req, res) => {
  res.json({ criteria: ALL_CRITERIA, labels: CRITERION_LABELS });
});

router.get('/fixtures', (_req, res) => {
  res.json({
    fixtures: TEST_CONVERSATIONS.map(({ id, title, clientName, transcript, expected }) => ({
      id,
      title,
      clientName,
      transcript,
      expected,
    })),
  });
});

router.post('/reviews', requireWrite, upload.single('audio'), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    let { title, managerId, transcript, clientName, useLlm: useLlmRaw } = parsed.data;
    // true/false из формы; если поле не передали — включаем ИИ при наличии ключа в .env
    const useLlm =
      useLlmRaw === undefined
        ? llmConfigured()
        : useLlmRaw === true || useLlmRaw === 'true';

    const manager = await prisma.user.findFirst({
      where: { id: managerId, deletedAt: null },
    });
    if (!manager) return res.status(404).json({ error: 'Manager not found' });

    let sourceType = 'TEXT';
    let audioStoredName = null;
    let audioOriginalName = null;

    if (req.file) {
      sourceType = 'AUDIO';
      audioStoredName = req.file.filename;
      audioOriginalName = req.file.originalname;
      if (!transcript) {
        const auto = await transcribeAudioFile(req.file.path);
        if (!auto) {
          return res.status(400).json({
            error:
              'Аудио загружено, но транскрибация недоступна. Передайте поле transcript или задайте OPENAI_API_KEY для Whisper.',
          });
        }
        transcript = auto;
      }
    }

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({ error: 'transcript required (min 20 chars)' });
    }

    let analysis = analyzeTranscript(transcript, { managerName: manager.name });
    if (useLlm) {
      const enhanced = await maybeEnhanceWithLlm(transcript, analysis);
      analysis = {
        ...analysis,
        summary: enhanced.summary || analysis.summary,
        recommendations: enhanced.recommendations || analysis.recommendations,
        errors: enhanced.errors || analysis.errors,
        analyzerVersion: enhanced.analyzerVersion,
      };
    }

    const review = await prisma.qcReview.create({
      data: {
        managerId,
        createdById: req.user.id,
        title,
        clientName: clientName || null,
        sourceType,
        transcript,
        audioStoredName,
        audioOriginalName,
        overallScore: analysis.overallScore,
        isCritical: analysis.isCritical,
        criterionScores: analysis.criterionScores,
        evidence: analysis.evidence,
        errors: analysis.errors,
        recommendations: analysis.recommendations,
        summary: analysis.summary,
        analyzerVersion: analysis.analyzerVersion,
      },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await writeActivityLog(null, {
      userId: req.user.id,
      action: 'qc_review_created',
      entityType: 'qc_review',
      entityId: review.id,
      metadata: { title, overallScore: review.overallScore, isCritical: review.isCritical },
    });

    return res.status(201).json({ review: serializeReview(review), analysisMeta: analysis.meta });
  } catch (err) {
    return next(err);
  }
});

router.get('/reviews', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};

    if (req.query.managerId) {
      where.managerId = Number(req.query.managerId);
    }

    if (req.query.critical === 'true') where.isCritical = true;
    if (req.query.q) {
      where.OR = [
        { title: { contains: String(req.query.q), mode: 'insensitive' } },
        { clientName: { contains: String(req.query.q), mode: 'insensitive' } },
        { summary: { contains: String(req.query.q), mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.qcReview.count({ where }),
      prisma.qcReview.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return res.json({
      items: items.map(serializeReview),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/reviews/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const review = await prisma.qcReview.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        comments: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!review) return res.status(404).json({ error: 'Not found' });

    return res.json({ review: serializeReview(review) });
  } catch (err) {
    return next(err);
  }
});

const patchSchema = z.object({
  manualScore: z.number().int().min(0).max(100).nullable().optional(),
  supervisorComment: z.string().max(5000).nullable().optional(),
  comment: z.string().min(1).max(5000).optional(),
});

router.patch('/reviews/:id', requireWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existing = await prisma.qcReview.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const data = {};
    if (parsed.data.manualScore !== undefined) {
      data.manualScore = parsed.data.manualScore;
      data.reviewedAt = new Date();
    }
    if (parsed.data.supervisorComment !== undefined) {
      data.supervisorComment = parsed.data.supervisorComment;
      data.reviewedAt = new Date();
    }

    const review = await prisma.$transaction(async (tx) => {
      const updated = await tx.qcReview.update({
        where: { id },
        data,
        include: {
          manager: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true } },
          comments: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (parsed.data.comment) {
        await tx.qcComment.create({
          data: {
            reviewId: id,
            authorId: req.user.id,
            text: parsed.data.comment,
          },
        });
        return tx.qcReview.findUnique({
          where: { id },
          include: {
            manager: { select: { id: true, name: true, email: true } },
            createdBy: { select: { id: true, name: true } },
            comments: {
              include: { author: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
        });
      }

      return updated;
    });

    await writeActivityLog(null, {
      userId: req.user.id,
      action: 'qc_review_updated',
      entityType: 'qc_review',
      entityId: id,
      metadata: {
        manualScore: parsed.data.manualScore,
        hasComment: Boolean(parsed.data.comment || parsed.data.supervisorComment),
      },
    });

    return res.json({ review: serializeReview(review) });
  } catch (err) {
    return next(err);
  }
});

router.get('/report', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();

    const reviews = await prisma.qcReview.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { manager: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const byManagerMap = new Map();
    const errorCounts = new Map();
    const dynamicsMap = new Map();
    const critical = [];

    for (const r of reviews) {
      const score = effectiveScore(r);
      if (!byManagerMap.has(r.managerId)) {
        byManagerMap.set(r.managerId, {
          managerId: r.managerId,
          managerName: r.manager.name,
          email: r.manager.email,
          count: 0,
          sum: 0,
          criticalCount: 0,
        });
      }
      const row = byManagerMap.get(r.managerId);
      row.count += 1;
      row.sum += score;
      if (r.isCritical) row.criticalCount += 1;

      const day = r.createdAt.toISOString().slice(0, 10);
      if (!dynamicsMap.has(day)) dynamicsMap.set(day, { date: day, count: 0, sum: 0 });
      const d = dynamicsMap.get(day);
      d.count += 1;
      d.sum += score;

      const errs = Array.isArray(r.errors) ? r.errors : [];
      for (const e of errs) {
        const key = e.criterion || e.code || e.message;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }

      if (r.isCritical) {
        critical.push({
          id: r.id,
          title: r.title,
          managerName: r.manager.name,
          overallScore: score,
          createdAt: r.createdAt,
          summary: r.summary,
          errors: r.errors,
        });
      }
    }

    const byManager = [...byManagerMap.values()]
      .map((m) => ({
        ...m,
        avgScore: m.count ? Math.round((m.sum / m.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    const frequentErrors = [...errorCounts.entries()]
      .map(([key, count]) => ({
        key,
        label: CRITERION_LABELS[key] || key,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const dynamics = [...dynamicsMap.values()].map((d) => ({
      date: d.date,
      count: d.count,
      avgScore: Math.round((d.sum / d.count) * 10) / 10,
    }));

    const avgAll = reviews.length
      ? Math.round(
          (reviews.reduce((s, r) => s + effectiveScore(r), 0) / reviews.length) * 10
        ) / 10
      : 0;

    return res.json({
      period: { from, to },
      summary: {
        checks: reviews.length,
        avgScore: avgAll,
        criticalCount: critical.length,
        managers: byManager.length,
      },
      byManager,
      frequentErrors,
      dynamics,
      critical,
    });
  } catch (err) {
    return next(err);
  }
});

/** Быстрый прогон эталонных диалогов без записи в БД */
router.post('/analyze-preview', requireWrite, async (req, res) => {
  const transcript = String(req.body?.transcript || '');
  if (transcript.length < 20) {
    return res.status(400).json({ error: 'transcript required' });
  }
  const analysis = analyzeTranscript(transcript, {
    managerName: req.body?.managerName || req.user.name,
  });
  return res.json({ analysis });
});

export default router;
