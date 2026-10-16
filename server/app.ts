import express from 'express';
import { localAccess } from './access.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  canonicalYouTubeUrl,
  exportSchema,
  validateClip,
  type VideoInfo,
} from '../src/shared.js';
import { inspectVideo } from './downloader.js';
import { friendlyError, toolHealth } from './tools.js';
import { JobManager } from './jobs.js';

export async function createApp(
  manager = new JobManager(),
  inspect = inspectVideo,
) {
  await manager.init();
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'https://i.ytimg.com', 'data:'],
          mediaSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', localAccess);
  const metadata = new Map<string, { video: VideoInfo; expiresAt: number }>();
  let tools = await toolHealth();
  let healthCheckedAt = Date.now();
  const ready = () => Object.values(tools).every(Boolean);
  app.get('/api/health', async (_req, res) => {
    if (!ready() && Date.now() - healthCheckedAt > 30_000) {
      tools = await toolHealth();
      healthCheckedAt = Date.now();
    }
    res.json({ ready: ready(), tools, activeJobs: manager.activeCount() });
  });
  const expensiveLimit = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute, then try again.' },
  });
  let inspections = 0;
  app.post('/api/inspect', expensiveLimit, async (req, res) => {
    const parsed = z.object({ url: z.string().max(2048) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter a YouTube video URL.' });
      return;
    }
    let url: string;
    try {
      url = canonicalYouTubeUrl(parsed.data.url);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
    if (!ready()) {
      res.status(503).json({
        error:
          'The processing tools aren’t ready. Run npm run setup, then restart the server.',
      });
      return;
    }
    for (const [token, entry] of metadata)
      if (entry.expiresAt < Date.now()) metadata.delete(token);
    const cached = [...metadata.values()].find(
      (entry) => entry.video.url === url,
    );
    if (cached) {
      cached.expiresAt = Date.now() + 3600_000;
      res.json(cached.video);
      return;
    }
    if (inspections >= 3) {
      res.status(429).json({
        error: 'Several videos are loading. Please try again in a moment.',
      });
      return;
    }
    inspections++;
    try {
      const video = await inspect(url);
      if (metadata.size >= 200) metadata.delete(metadata.keys().next().value!);
      metadata.set(video.token, { video, expiresAt: Date.now() + 3600_000 });
      res.json(video);
    } catch (error) {
      const message = friendlyError(error);
      console.error(`Video inspection: ${message}`);
      res.status(422).json({ error: message });
    } finally {
      inspections--;
    }
  });
  app.post('/api/jobs', expensiveLimit, async (req, res) => {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Choose valid export settings and clip times.' });
      return;
    }
    if (!ready()) {
      res.status(503).json({
        error: 'The processing tools aren’t ready. Run npm run setup.',
      });
      return;
    }
    const entry = metadata.get(parsed.data.videoToken);
    if (!entry || entry.expiresAt < Date.now()) {
      res
        .status(410)
        .json({ error: 'This video preview expired. Load the link again.' });
      return;
    }
    const error = validateClip(parsed.data, entry.video);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    if (manager.activeCount() >= 10) {
      res.status(429).json({
        error: 'The export queue is full. Wait for an export to finish.',
      });
      return;
    }
    res.status(202).json(await manager.create(entry.video, parsed.data));
  });
  app.get('/api/jobs', (_req, res) => res.json(manager.list()));
  app.get('/api/jobs/:id', (req, res) => {
    const job = manager.jobs.get(req.params.id);
    job
      ? res.json(job)
      : res
          .status(404)
          .json({ error: 'This export was deleted or has expired.' });
  });
  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const cancelled = await manager.cancel(req.params.id);
    cancelled
      ? res.json({ ok: true })
      : res.status(409).json({ error: 'This export is no longer processing.' });
  });
  app.delete('/api/jobs/:id', async (req, res) => {
    try {
      const removed = await manager.remove(req.params.id);
      removed
        ? res.json({ ok: true })
        : res.status(404).json({ error: 'This export was already removed.' });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
  app.get('/api/jobs/:id/file', (req, res) => {
    const job = manager.jobs.get(req.params.id);
    if (
      !job ||
      job.status !== 'completed' ||
      !existsSync(manager.outputPath(job.id))
    ) {
      res
        .status(404)
        .json({ error: 'This video isn’t available for download.' });
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Export storage intentionally lives in .data; allow this known, server-owned path.
    if (req.query.preview === '1')
      res.sendFile(manager.outputPath(job.id), { dotfiles: 'allow' });
    else
      res.download(
        manager.outputPath(job.id),
        job.filename || 'video-x-ready.mp4',
        { dotfiles: 'allow' },
      );
  });
  if (existsSync(path.resolve('dist/index.html'))) {
    app.use(express.static(path.resolve('dist')));
    app.get('/{*path}', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Unknown API endpoint.' });
        return;
      }
      res.sendFile(path.resolve('dist/index.html'));
    });
  }
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: 'Invalid JSON request.' });
        return;
      }
      console.error('Request error:', friendlyError(error));
      res
        .status(500)
        .json({ error: 'Something went wrong. Please try again.' });
    },
  );
  return { app, manager };
}
