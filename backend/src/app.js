import fs from 'fs';
import express from 'express';
import cors from 'cors';
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

fs.mkdirSync(config.uploadDir, { recursive: true });

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/deals', dealsRoutes);
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
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
