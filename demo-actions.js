import { randomBytes, randomUUID, createHash } from 'node:crypto';

const empty = { type: 'object', properties: {}, required: [], additionalProperties: false };
const runInput = { type: 'object', properties: { demo_id: { type: 'string', description: 'The demo_id returned by demo_checkout.' } }, required: ['demo_id'], additionalProperties: false };

export function demoActions(baseUrl) {
  const action = (method, path, description, fields = empty) => ({ url: `${baseUrl}${path}`, method, description, fields, requiresSignIn: false });
  return {
    demo_before: action('GET', '/api/demo/before', 'Check whether the free demo is ready. Continue with demo_checkout only when ready is true. No payment or cart is needed.'),
    demo_checkout: {
      ...action('POST', '/api/demo/checkout', 'Start a FREE simulated checkout, never a real payment. First run demo_before and require ready=true. Success means the demo session was created (created=true), not that checkout was completed. After successful creation run demo_after using the returned demo_id. Give the visitor checkout_url to open. When they return, run demo_on_return with that same demo_id; report completed, cancelled, or pending exactly as returned. Never call the real checkout for this demo.'),
      hooks: { before: 'demo_before', after: 'demo_after', onReturn: 'demo_on_return' }
    },
    demo_after: action('POST', '/api/demo/after', 'Record successful creation of a free demo session. Use demo_id from demo_checkout. This confirms session creation, not checkout completion or payment.', runInput),
    demo_on_return: action('GET', '/api/demo/on-return', 'Read the free demo outcome after the visitor returns from checkout_url. Use demo_id from demo_checkout. Only completed confirms demo completion; cancelled and pending are not success. No money is charged in any state.', runInput)
  };
}

export function installDemoActions(app, { db, baseUrl, cookieOptions }) {
  db.exec(`CREATE TABLE IF NOT EXISTS action_demo_runs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    after_recorded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS action_demo_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, demo_id TEXT,
    phase TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS action_demo_events_owner ON action_demo_events(owner, id);`);
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const requests = new Map();
  let lastCleanup = 0;
  app.use('/api/demo', (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup >= 60000) {
      for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
      db.prepare('DELETE FROM action_demo_events WHERE created_at < ?').run(now - 86400000);
      db.prepare('DELETE FROM action_demo_runs WHERE created_at < ?').run(now - 86400000);
      lastCleanup = now;
    }
    const key = req.ip || 'unknown';
    let record = requests.get(key);
    if (!record || record.until <= now) {
      if (requests.size >= 10000) return res.status(503).json({ error: 'Demo is busy. Try again shortly.' });
      record = { count: 0, until: now + 60000 };
      requests.set(key, record);
    }
    if (++record.count > 60) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((record.until - now) / 1000))));
      return res.status(429).json({ error: 'Too many demo requests. Try again in a minute.' });
    }
    next();
  });

  function owner(req, res) {
    let token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('shop_demo='))?.slice(10);
    if (!/^[a-f0-9]{64}$/.test(token || '')) {
      token = randomBytes(32).toString('hex');
      res.cookie('shop_demo', token, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 });
    }
    return createHash('sha256').update(token).digest('hex');
  }
  function event(ownerId, demoId, phase, result) {
    db.exec('DELETE FROM action_demo_events WHERE id <= (SELECT id FROM action_demo_events ORDER BY id DESC LIMIT 1 OFFSET 9999)');
    db.prepare('INSERT INTO action_demo_events (owner, demo_id, phase, result, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ownerId, demoId, phase, result, Date.now());
  }
  function run(req, res, id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail(400, 'Use the demo_id returned by demo_checkout.');
    const row = db.prepare('SELECT * FROM action_demo_runs WHERE id = ? AND owner = ?').get(id, owner(req, res));
    if (!row) fail(404, 'Demo session not found in this browser.');
    return row;
  }
  const result = row => ({ demo: true, demo_id: row.id, status: row.status, completed: row.status === 'completed', charged: false, amount_charged_cents: 0, after_recorded: Boolean(row.after_recorded) });

  app.get('/api/demo/actions', (_req, res) => res.json({ actions: demoActions(baseUrl) }));
  app.get('/api/demo/before', (req, res) => {
    event(owner(req, res), null, 'before', 'ready');
    res.json({ demo: true, ready: true, payment_required: false, message: 'Free demo is ready. No card or cart required.' });
  });
  app.post('/api/demo/checkout', (req, res) => {
    const id = randomUUID(), ownerId = owner(req, res);
    if (db.prepare('SELECT count(*) AS n FROM action_demo_runs WHERE owner = ?').get(ownerId).n >= 20) {
      return res.status(429).json({ error: 'You have reached the daily limit of 20 demo sessions.' });
    }
    if (db.prepare('SELECT count(*) AS n FROM action_demo_runs').get().n >= 1000) {
      return res.status(503).json({ error: 'Demo session capacity reached. Try again later.' });
    }
    db.prepare('INSERT INTO action_demo_runs (id, owner, created_at) VALUES (?, ?, ?)').run(id, ownerId, Date.now());
    event(ownerId, id, 'checkout', 'created');
    res.status(201).json({ demo: true, demo_id: id, created: true, status: 'created', checkout_status: 'pending', charged: false,
      checkout_url: `${baseUrl}/demo-checkout.html?demo_id=${id}`, message: 'Demo session created. The visitor still needs to complete or cancel the free simulation.' });
  });
  app.post('/api/demo/after', (req, res) => {
    const row = run(req, res, req.body.demo_id);
    if (!row.after_recorded) {
      db.prepare('UPDATE action_demo_runs SET after_recorded = 1 WHERE id = ?').run(row.id);
      event(row.owner, row.id, 'after', 'creation recorded');
    }
    res.json({ demo: true, demo_id: row.id, recorded: true, charged: false, message: 'After-success hook recorded session creation.' });
  });
  app.get('/api/demo/on-return', (req, res) => {
    const row = run(req, res, req.query.demo_id);
    event(row.owner, row.id, 'on_return', row.status);
    res.json(result(row));
  });
  app.get('/api/demo/sessions/:id', (req, res) => res.json(result(run(req, res, req.params.id))));
  app.post('/api/demo/sessions/:id/finish', (req, res) => {
    const row = run(req, res, req.params.id);
    const outcome = req.body.outcome;
    if (!['completed', 'cancelled'].includes(outcome)) fail(400, 'Choose completed or cancelled.');
    if (row.status !== 'pending' && row.status !== outcome) fail(409, 'This demo already finished. Start a new demo to try another outcome.');
    if (row.status === 'pending') {
      db.prepare('UPDATE action_demo_runs SET status = ? WHERE id = ?').run(outcome, row.id);
      event(row.owner, row.id, 'visitor', outcome);
    }
    res.json(result({ ...row, status: outcome }));
  });
  app.get('/api/demo/events', (req, res) => res.json({ events: db.prepare('SELECT id, demo_id, phase, result, created_at FROM action_demo_events WHERE owner = ? ORDER BY id DESC LIMIT 50').all(owner(req, res)).reverse() }));
}
