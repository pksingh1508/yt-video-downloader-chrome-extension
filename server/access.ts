import type { RequestHandler } from 'express';
import { EXTENSION_ID } from '../src/config.js';

// Explicit origins only; do not allow other installed extensions or foreign websites.
export const localAccess: RequestHandler = (req, res, next) => {
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname.toLowerCase()) ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {
    res.status(403).json({ error: 'The companion accepts connections from this computer only.' });
    return;
  }
  const origin = req.get('origin');
  if (origin) {
    const extensionOrigin = `chrome-extension://${EXTENSION_ID}`;
    const localOrigins = [process.env.PORT || '3002', process.env.WEB_PORT || '5174']
      .flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (origin !== extensionOrigin && !localOrigins.includes(origin)) {
      res.status(403).json({ error: 'Requests must come from the PostReady extension or local development app.' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
};
