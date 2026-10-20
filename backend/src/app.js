import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import dealsRoutes from './routes/deals.js';
import activityRoutes from './routes/activity.js';
import tasksRoutes from './routes/tasks.js';
import notificationsRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboard.js';
import searchRoutes from './routes/search.js';
import sourcesRoutes from './routes/sources.js';
import templatesRoutes from './routes/templates.js';
import attachmentsRoutes from './routes/attachments.js';
import qcRoutes from './routes/qc.js';
import leadsRoutes from './routes/leads.js';
import vehiclesRoutes from './routes/vehicles.js';
import visitsRoutes from './routes/visits.js';
import inboxRoutes from './routes/inbox.js';
import chatRoutes from './routes/chat.js';
import analyticsRoutes from './routes/analytics.js';
import stockRoutes from './routes/stock.js';
import orgRoutes from './routes/orgs.js';
import billingRoutes from './routes/billing.js';
import avitoWebhookRoutes from './routes/webhooks/avito.js';
import telegramWebhookRoutes from './routes/webhooks/telegram.js';
import maxWebhookRoutes from './routes/webhooks/max.js';
import whatsappWebhookRoutes from './routes/webhooks/whatsapp.js';
import { queueSize } from './services/queue.js';
import { corsOriginDelegate } from './services/corsOrigins.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

export function createApp() {
  const app = express();

  // Behind nginx — needed for express-rate-limit / correct client IP
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          scriptSrc: ["'self'", 'https://mc.yandex.ru'],
          imgSrc: ["'self'", 'data:', 'https://mc.yandex.ru'],
          connectSrc: ["'self'", 'https://mc.yandex.ru', 'https://mc.yandex.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
    })
  );

  app.use(
    cors({
      origin: corsOriginDelegate,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, queueSize: queueSize() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/org', orgRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/webhooks/avito', avitoWebhookRoutes);
  app.use('/api/webhooks/telegram', telegramWebhookRoutes);
  app.use('/api/webhooks/max', maxWebhookRoutes);
  app.use('/api/webhooks/whatsapp', whatsappWebhookRoutes);
  app.use('/api/vehicles', vehiclesRoutes);
  app.use('/api/visits', visitsRoutes);
  app.use('/api/inbox', inboxRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/deals', dealsRoutes);
  app.use('/api/deals', chatRoutes);
  app.use('/api/deals', attachmentsRoutes);
  app.use('/api/activity', activityRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/sources', sourcesRoutes);
  app.use('/api/templates', templatesRoutes);
  app.use('/api/qc', qcRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    // express-rate-limit validation / config errors
    if (err.code === 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR' || String(err.message || '').includes('X-Forwarded-For')) {
      return res.status(500).json({ error: 'Proxy/rate-limit misconfigured' });
    }
    const msg =
      err.expose || (err.status && err.status < 500) ? err.message : 'Internal server error';
    res.status(err.status || 500).json({
      error: msg,
      ...(err.status && err.status < 500 && err.code ? { code: err.code } : {}),
    });
  });

  return app;
}
