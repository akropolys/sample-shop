import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { products } from './products.js';
import { cartRoutes } from './cart.js';
import { siteActions } from './site-actions.js';

const root = dirname(fileURLToPath(import.meta.url));

export function createApp({ baseUrl = 'http://localhost:3000' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/products', (req, res) => res.json(products));
  app.get('/api/actions', (req, res) => res.json({ actions: siteActions(baseUrl) }));
  cartRoutes(app, baseUrl.startsWith('https:'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  // The page's kiku key comes from the environment, so it stays out of git.
  const page = readFileSync(resolve(root, 'page.html'), 'utf8')
    .replace('KIKU_PUBLIC_KEY', process.env.KIKU_PUBLIC_KEY || process.env.NEXT_PUBLIC_AKROPOLYS_API_TOKEN || '')
    .replace('KIKU_SITE_ID', process.env.KIKU_SITE_ID || process.env.NEXT_PUBLIC_AKROPOLYS_SITE_ID || '');
  app.get(['/', '/index.html'], (req, res) => res.type('html').send(page));
  app.use(express.static(resolve(root, 'public')));
  app.use((req, res) => res.status(404).send('Page not found.'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    const status = error.status || 500;
    if (status >= 500) console.error(error.message);
    res.status(status).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
  });
  return app;
}

// On Vercel the public address comes from its environment.
export function resolveVercelBaseUrl(env) {
  const host = env.VERCEL_ENV === 'production'
    ? (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL)
    : (env.VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL);
  return (env.BASE_URL || (host ? `https://${host}` : '')).replace(/\/$/, '');
}

const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);
export default isVercel ? createApp({ baseUrl: resolveVercelBaseUrl(process.env) }) : express();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
  createApp({ baseUrl }).listen(port, '127.0.0.1', () => console.log(`Simple Shop: ${baseUrl}`));
}
