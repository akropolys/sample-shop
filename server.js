import express from 'express';
import Stripe from 'stripe';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabase, hashPassword, checkPassword } from './db.js';
import { createAkropolys } from './akropolys.js';
import { createCartStore } from './cart.js';
import { siteActions } from './site-actions.js';
import { akropolysProxy } from './akropolys-proxy.js';
import { installDemoActions } from './demo-actions.js';

const root = dirname(fileURLToPath(import.meta.url));
const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });
const digest = (token) => createHash('sha256').update(token).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });

function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw httpError(400, `${label} must be ${min}–${max} characters.`);
  }
  return value.trim();
}

function productInput(body) {
  const name = text(body.name, 'Name', 1, 100);
  const description = text(body.description, 'Description', 1, 1000);
  const image_url = text(body.image_url, 'Image URL', 1, 2000);
  if (!/^\/images\/[a-z\d_.-]+$/i.test(image_url)) {
    let url;
    try { url = new URL(image_url); } catch { throw httpError(400, 'Use a valid HTTPS image URL or /images/filename.jpg.'); }
    if (url.protocol !== 'https:') throw httpError(400, 'Image URLs must start with https://.');
  }
  if (!Number.isInteger(body.price_cents) || body.price_cents < 50 || body.price_cents > 10000000) {
    throw httpError(400, 'Price must be between $0.50 and $100,000.00.');
  }
  return { name, description, price_cents: body.price_cents, image_url };
}

export function createApp({ db, stripe = null, stripeMode = 'test', webhookSecret = '', baseUrl = 'http://localhost:3000', akropolys = null, akropolysFetch = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  const sessionLength = 7 * 24 * 60 * 60 * 1000;
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: baseUrl.startsWith('https:'), path: '/' };
  const carts = createCartStore(db, cookieOptions);
  const attempts = new Map();

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': akropolys
        ? "default-src 'self'; script-src 'self' https://cdn.akropolys.cloud; style-src 'self' 'unsafe-inline' https://cdn.akropolys.cloud https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https://api.akropolys.cloud https://voice.akropolys.cloud wss://voice.akropolys.cloud wss://api.akropolys.cloud; media-src 'self' blob: https://voice.akropolys.cloud; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    const configured = new URL(baseUrl);
    const currentOrigin = `${configured.protocol}//${req.get('host')}`;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== configured.origin && origin !== currentOrigin) {
      return res.status(403).json({ error: 'Use the shop from its own address.' });
    }
    next();
  });

  if (akropolys) app.use('/api/akropolys', express.raw({ type: '*/*', limit: '2mb' }), akropolysProxy(akropolys.publicConfig, akropolysFetch));

  function settleSession(session) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(session.metadata?.order_id || '');
    if (!order) return;
    if (order.stripe_session_id && order.stripe_session_id !== session.id) throw httpError(400, 'Checkout session does not match the order.');
    if (session.payment_status === 'paid') {
      if (session.amount_total !== order.total_cents || session.currency !== order.currency) throw httpError(400, 'Checkout total does not match the order.');
      if (order.status === 'paid') return;
      db.exec('BEGIN');
      try {
        db.prepare("UPDATE orders SET status = 'paid', stripe_session_id = ?, customer_email = COALESCE(?, customer_email) WHERE id = ?")
          .run(session.id, session.customer_details?.email || null, order.id);
        if (order.cart_id) {
          const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
          for (const item of items) {
            db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ? AND quantity <= ?').run(order.cart_id, item.product_id, item.quantity);
            db.prepare('UPDATE cart_items SET quantity = quantity - ? WHERE cart_id = ? AND product_id = ?').run(item.quantity, order.cart_id, item.product_id);
          }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (session.status === 'expired') {
      db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'").run(order.id);
    }
  }

  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
    if (!stripe || !webhookSecret) return res.status(503).json({ error: 'Stripe webhook is not configured.' });
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), webhookSecret); }
    catch { return res.status(400).json({ error: 'Invalid Stripe webhook signature.' }); }
    try {
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) settleSession(event.data.object);
      res.json({ received: true });
    } catch (error) { next(error); }
  });

  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('shop_session='))?.slice(13);
    if (token) {
      req.user = db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), Date.now());
      req.sessionToken = token;
    }
    next();
  });

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
  }

  function startSession(req, res, user) {
    carts.mergeGuest(req, res, user);
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(req.sessionToken));
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, Date.now() + sessionLength);
    res.cookie('shop_session', token, { ...cookieOptions, maxAge: sessionLength });
    return publicUser(user);
  }

  function authLimit(req, res, next) {
    const now = Date.now();
    for (const [key, record] of attempts) if (record.until < now) attempts.delete(key);
    const record = attempts.get(req.ip) || { count: 0, until: now + 60000 };
    record.count++;
    attempts.set(req.ip, record);
    if (record.count > 20) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    next();
  }

  app.get('/api/config', (req, res) => res.json({
    currency: 'usd', stripe_configured: Boolean(stripe), stripe_mode: stripe ? stripeMode : null,
    akropolys: akropolys?.publicConfig || { enabled: false }
  }));
  app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
  app.get('/api/kiku/identity', async (req, res) => res.json(akropolys ? await akropolys.identity(req.user) : {}));
  app.get('/api/actions', (req, res) => res.json({ actions: siteActions(baseUrl) }));
  installDemoActions(app, { db, baseUrl, cookieOptions });

  app.post('/api/auth/register', authLimit, (req, res) => {
    const name = text(req.body.name, 'Name', 1, 80);
    const email = text(req.body.email, 'Email', 3, 254).toLowerCase();
    const password = text(req.body.password, 'Password', 8, 128);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw httpError(409, 'An account with that email already exists.');
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hashPassword(password));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
    res.status(201).json({ user: startSession(req, res, user) });
  });

  app.post('/api/auth/login', authLimit, (req, res) => {
    const email = text(req.body.email, 'Email', 3, 254).toLowerCase();
    const password = text(req.body.password, 'Password', 1, 128);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !checkPassword(password, user.password_hash)) throw httpError(401, 'Email or password is incorrect.');
    res.json({ user: startSession(req, res, user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(req.sessionToken));
    res.clearCookie('shop_session', cookieOptions).json({ ok: true });
  });

  app.get('/api/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products ORDER BY id').all();
    res.json(products.filter((product) => product.active));
    if (akropolys) void akropolys.publish(products).catch((error) => console.error('Akropolys catalogue:', error.message));
  });
  app.get('/api/products/:id/comments', (req, res) => {
    if (!db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').get(req.params.id)) throw httpError(404, 'Product not found.');
    res.json(db.prepare(`SELECT c.id, c.product_id, c.user_id, c.body, c.created_at, u.name
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.product_id = ? ORDER BY c.id DESC`).all(req.params.id));
  });

  app.post('/api/products/:id/comments', requireUser, (req, res) => {
    if (!db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').get(req.params.id)) throw httpError(404, 'Product not found.');
    const body = text(req.body.body, 'Comment', 1, 1000);
    const result = db.prepare('INSERT INTO comments (product_id, user_id, body) VALUES (?, ?, ?)').run(req.params.id, req.user.id, body);
    res.status(201).json({ id: Number(result.lastInsertRowid), user_id: req.user.id });
  });

  app.delete('/api/comments/:id', requireUser, (req, res) => {
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) throw httpError(404, 'Comment not found.');
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, 'You can only delete your own comments.');
    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/cart', (req, res) => res.json(carts.read(carts.context(req, res))));
  app.post('/api/cart/items', (req, res) => res.json(carts.add(carts.context(req, res), req.body.product_id, req.body.quantity)));
  app.patch('/api/cart/items/:productId', (req, res) => res.json(carts.update(carts.context(req, res), Number(req.params.productId), req.body.quantity)));
  app.delete('/api/cart/items/:productId', (req, res) => res.json(carts.remove(carts.context(req, res), Number(req.params.productId))));
  app.delete('/api/cart', (req, res) => res.json(carts.clear(carts.context(req, res))));

  app.post('/api/checkout', async (req, res) => {
    if (!stripe) throw httpError(503, 'Add your Stripe test secret key to .env to enable checkout.');
    const owner = carts.context(req, res);
    const buyer = owner.user;
    const cart = carts.read(owner);
    if (!cart.items.length) throw httpError(400, 'Your cart is empty. Add a product first.');
    const items = cart.items.map((item) => ({ ...item, id: item.product_id }));
    const orderId = randomUUID();
    const total = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
    if (total > 99999999) throw httpError(400, 'Cart total is too large.');
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO orders (id, user_id, customer_email, total_cents, cart_id) VALUES (?, ?, ?, ?, ?)').run(orderId, buyer?.id || null, buyer?.email || null, total, owner.id);
      const insert = db.prepare('INSERT INTO order_items (order_id, product_id, name, price_cents, quantity) VALUES (?, ?, ?, ?, ?)');
      for (const item of items) insert.run(orderId, item.id, item.name, item.price_cents, item.quantity);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: items.map((item) => ({
          price_data: { currency: 'usd', unit_amount: item.price_cents, product_data: { name: item.name } },
          quantity: item.quantity
        })),
        customer_email: buyer?.email,
        client_reference_id: orderId,
        metadata: { order_id: orderId, user_id: buyer ? String(buyer.id) : 'guest' },
        success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?checkout=cancelled`
      }, { idempotencyKey: orderId });
      db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);
      res.json({ url: session.url, checkout_url: session.url, order_id: orderId, user_id: buyer?.id || null, total_cents: total, currency: 'usd' });
    } catch (error) {
      db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);
      console.error('Stripe checkout failed:', error.type || error.name);
      throw httpError(502, 'Stripe checkout could not start. Check your test key and try again.');
    }
  });

  app.get('/api/checkout/:sessionId', async (req, res) => {
    if (!stripe) throw httpError(503, 'Stripe is not configured.');
    const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(req.params.sessionId);
    if (!order) throw httpError(404, 'Checkout not found.');
    const owner = carts.context(req, res);
    if (order.cart_id !== owner.id || (order.user_id !== null && order.user_id !== req.user?.id)) {
      throw httpError(404, 'Checkout not found.');
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
      settleSession(session);
      const updated = db.prepare('SELECT status, total_cents, currency FROM orders WHERE id = ?').get(order.id);
      res.json({ ...updated, order_id: order.id });
    } catch (error) {
      if (error.status) throw error;
      throw httpError(502, 'Could not verify payment with Stripe. Please try again.');
    }
  });

  function ordersFor(userId) {
    const orders = userId
      ? db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(userId)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 100').all();
    return orders.map((order) => ({ ...order, items: db.prepare('SELECT product_id, name, price_cents, quantity FROM order_items WHERE order_id = ?').all(order.id) }));
  }

  app.get('/api/orders', requireUser, (req, res) => res.json(ordersFor(req.user.id)));
  app.get('/api/admin/products', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const p = productInput(req.body);
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    const result = db.prepare('INSERT INTO products (name, description, price_cents, image_url, active) VALUES (?, ?, ?, ?, ?)').run(p.name, p.description, p.price_cents, p.image_url, active);
    res.status(201).json({ id: Number(result.lastInsertRowid), ...p, active });
  });
  app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
    const p = productInput(req.body);
    const result = db.prepare('UPDATE products SET name = ?, description = ?, price_cents = ?, image_url = ?, active = ? WHERE id = ?')
      .run(p.name, p.description, p.price_cents, p.image_url, req.body.active === false || req.body.active === 0 ? 0 : 1, req.params.id);
    if (!result.changes) throw httpError(404, 'Product not found.');
    res.json({ ok: true });
  });
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const result = db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
    if (!result.changes) throw httpError(404, 'Product not found.');
    res.json({ ok: true });
  });
  app.get('/api/admin/comments', requireAdmin, (req, res) => res.json(db.prepare(`
    SELECT c.*, u.name, p.name AS product_name FROM comments c
    JOIN users u ON u.id = c.user_id JOIN products p ON p.id = c.product_id ORDER BY c.id DESC LIMIT 200`).all()));
  app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(ordersFor()));
  app.get('/api/admin/users', requireAdmin, (req, res) => res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id').all()));
  app.get('/api/admin/akropolys', requireAdmin, (req, res) => res.json(akropolys ? akropolys.status() : { enabled: false }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
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

function createConfiguredApp(baseUrl, databasePath) {
  const db = openDatabase(databasePath, {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD
  });
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 20000 }) : null;
  const akropolys = createAkropolys({
    siteId: process.env.NEXT_PUBLIC_AKROPOLYS_SITE_ID,
    apiToken: process.env.NEXT_PUBLIC_AKROPOLYS_API_TOKEN,
    publicKeyId: process.env.NEXT_PUBLIC_AKROPOLYS_PUBLIC_KEY_ID,
    privateKey: process.env.AKROPOLYS_PRIVATE_KEY,
    voice: process.env.AKROPOLYS_VOICE === 'true',
    baseUrl
  });
  const app = createApp({ db, stripe, stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET, baseUrl, akropolys });
  return { app, db, stripe, akropolys };
}

const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);
export function resolveVercelBaseUrl(env) {
  const host = env.VERCEL_ENV === 'production'
    ? (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL)
    : (env.VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL);
  return (env.BASE_URL || (host ? `https://${host}` : '')).replace(/\/$/, '');
}
const vercelBaseUrl = resolveVercelBaseUrl(process.env);
const vercelRuntime = isVercel ? createConfiguredApp(vercelBaseUrl, '/tmp/shop.sqlite') : null;
export default vercelRuntime?.app || express();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const { app, db, stripe, akropolys } = createConfiguredApp(baseUrl, resolve(root, process.env.DATABASE_PATH || 'data/shop.sqlite'));
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Simple Shop: ${baseUrl}`);
    console.log(`CMS: ${baseUrl}/admin.html`);
    console.log(stripe ? 'Stripe Checkout is configured.' : 'Stripe Checkout needs STRIPE_SECRET_KEY in .env.');
    if (akropolys) console.log(`Kiku: ${akropolys.publicConfig.site_id}`);
  });
  server.on('error', (error) => { console.error(error.message); db.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
