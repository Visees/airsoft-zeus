import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Frontend server (one origin for the browser):
 *  - static files from /browser (long cache for hashed assets, no cache for the SW/index)
 *  - /api and /socket.io (websocket upgrade) proxied to the api container
 *  - server-side rendering for the public results page, client rendering for the app
 *  - security headers, robots.txt, /healthz
 */
const browserDistFolder = join(import.meta.dirname, '../browser');
const API_URL = process.env['API_INTERNAL_URL'] || 'http://localhost:3000';
const SITE_URL = (process.env['SITE_URL'] || 'http://localhost:4000').replace(/\/$/, '');

const allowedHosts = [new URL(SITE_URL).hostname, 'localhost', '127.0.0.1'];
const angularApp = new AngularNodeAppEngine({ allowedHosts, trustProxyHeaders: ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-prefix'] });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /welcome\nAllow: /r/\nDisallow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (_req, res) => {
  res
    .type('application/xml')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/welcome</loc></url></urlset>\n`,
    );
});

// API + realtime proxy. `ws: true` forwards the websocket upgrade.
const apiProxy = createProxyMiddleware({
  target: API_URL,
  changeOrigin: false,
  xfwd: true,
  ws: true,
  pathFilter: ['/api', '/socket.io'],
  proxyTimeout: 30_000,
});
app.use(apiProxy);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      // map tiles, fonts and icons (OpenFreeMap), elevation (AWS open data), satellite (Esri), place search (Photon)
      "connect-src 'self' ws: wss: https://tiles.openfreemap.org https://s3.amazonaws.com https://ibasemaps-api.arcgis.com https://photon.komoot.io",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
});

// A service worker keeps the CSP of the response it was installed from until its script bytes
// change, and ngsw-worker.js is identical across builds: a worker installed under an older
// policy kept blocking the map tiles. The page's CSP already checks every request the worker
// proxies, so the worker is served without one; the stamp makes installed workers update once.
const swPath = join(browserDistFolder, 'ngsw-worker.js');
const swScript = existsSync(swPath) ? `${readFileSync(swPath, 'utf8')}\n// served without CSP (2026-10-23)\n` : null;
app.get('/ngsw-worker.js', (_req, res, next) => {
  if (!swScript) return next();
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript').send(swScript);
});

app.use(
  express.static(browserDistFolder, {
    index: false,
    redirect: false,
    setHeaders: (res, path) => {
      if (/ngsw(-worker)?\.js(on)?$|safety-worker\.js$|manifest\.webmanifest$|index\.csr\.html$/.test(path)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.[0-9a-z]{8,}\.(js|css|woff2?)$/i.test(path) || /-[A-Z0-9]{8}\.(js|css)$/.test(path)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }),
);

app.use((req, res, next) => {
  // Traefik adds headers Angular does not know (X-Forwarded-Server, X-Real-Ip); unknown
  // x-forwarded-* headers make the engine fall back to client rendering, so drop them.
  for (const h of Object.keys(req.headers)) {
    if (h.startsWith('x-forwarded-') && !['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-prefix'].includes(h)) {
      delete req.headers[h];
    }
  }
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 4000);
  const server = app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Frontend listening on http://localhost:${port} (api → ${API_URL})`);
  });
  server.on('upgrade', apiProxy.upgrade);
}

export const reqHandler = createNodeRequestHandler(app);
