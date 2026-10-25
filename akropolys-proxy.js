import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function akropolysProxy(config, request = fetch) {
  return async (req, res) => {
    const publicSettings = req.method === 'GET' && req.path === '/site-widget' && req.query.siteId === config.site_id;
    if (!publicSettings && (req.get('x-akropolys-token') !== config.api_token || req.get('x-akropolys-site') !== config.site_id)) {
      return res.status(403).json({ error: 'Use the configured shop assistant credentials.' });
    }
    const headers = { accept: req.get('accept') || 'application/json' };
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith('x-akropolys-') || name === 'content-type' || name === 'origin') headers[name] = value;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.on('close', stop);
    try {
      const upstream = await request(`https://api.akropolys.cloud/v1${req.url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) || !req.body?.length ? undefined : req.body,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
        redirect: 'manual'
      });
      res.status(upstream.status);
      for (const name of ['content-type', 'retry-after']) {
        const value = upstream.headers.get(name);
        if (value) res.set(name, value);
      }
      res.set('X-Accel-Buffering', 'no');
      if (!upstream.body) return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (res.headersSent) res.destroy();
      else res.status(502).json({ error: 'The shop assistant could not reach Akropolys. Try again shortly.' });
    } finally { res.off('close', stop); }
  };
}
