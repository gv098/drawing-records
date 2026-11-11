import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultDist = fileURLToPath(new URL('../dist/', import.meta.url));

export function createApp(dist = defaultDist) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/healthz', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', app: 'drawing-records' });
  });
  // Preserve URLs used by older browser bookmarks and their storage origin.
  app.get(['/', '/index.html', '/biji-repaint.html', '/biji-web.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || !/^\/assets\/[\w.-]+$/.test(req.path)) return next();
    const original = path.join(dist, req.path);
    if (!existsSync(original)) return next();
    const choices = ['br', 'gzip'].filter(encoding => existsSync(original + (encoding === 'br' ? '.br' : '.gz')));
    res.vary('Accept-Encoding');
    const encoding = req.acceptsEncodings(...choices, 'identity');
    if (encoding === 'br' || encoding === 'gzip') {
      res.type(path.extname(original));
      res.setHeader('Content-Encoding', encoding);
      req.url = req.path + (encoding === 'br' ? '.br' : '.gz');
    }
    next();
  });
  app.use('/assets', express.static(path.join(dist, 'assets'), {
    dotfiles: 'deny', index: false, maxAge: '1y', immutable: true,
  }));
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status === 404 ? 404 : 500).type('text').send(error.status === 404 ? 'Not found' : 'Server error');
  });
  return app;
}
