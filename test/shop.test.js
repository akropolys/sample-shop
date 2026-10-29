import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Stripe from 'stripe';
import { openDatabase } from '../db.js';
import { createApp, resolveVercelBaseUrl } from '../server.js';
import { createAkropolys } from '../akropolys.js';
import { generateKeyPairSync, verify, constants } from 'node:crypto';

async function fixture(t, { payments = true, akropolys = null, akropolysFetch = fetch } = {}) {
  const db = openDatabase(':memory:');
  const sessions = new Map();
  const calls = [];
  const verifier = new Stripe('sk_test_dummy');
  const stripe = {
    checkout: { sessions: {
      async create(params) {
        calls.push(params);
        const id = `cs_test_${calls.length}`;
        const session = {
          id, url: `https://checkout.stripe.com/test/${id}`, metadata: params.metadata,
          amount_total: params.line_items.reduce((sum, item) => sum + item.price_data.unit_amount * item.quantity, 0),
          currency: 'usd', payment_status: 'unpaid', status: 'open'
        };
        sessions.set(id, session);
        return session;
      },
      async retrieve(id) { return sessions.get(id); }
    } },
    webhooks: verifier.webhooks
  };
  const app = createApp({ db, stripe: payments ? stripe : null, webhookSecret: 'whsec_test', baseUrl: 'http://localhost:3000', akropolys, akropolysFetch });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });

  function client() {
    const cookies = new Map();
    return async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), ...headers },
        body: body ? JSON.stringify(body) : undefined
      });
      for (const setCookie of response.headers.getSetCookie()) {
        const [name, ...value] = setCookie.split(';')[0].split('=');
        if (value.join('=')) cookies.set(name, value.join('=')); else cookies.delete(name);
      }
      return { status: response.status, data: await response.json() };
    };
  }
  return { db, sessions, calls, client, url, verifier };
}

test('dummy accounts have distinct IDs, persist sessions, and cannot grant themselves admin access', async (t) => {
  const { client } = await fixture(t);
  const request = client();
  assert.equal((await request('/api/me')).data.user, null);
  const created = await request('/api/auth/register', 'POST', { name: 'Test Buyer', email: 'test@example.com', password: 'password123', role: 'admin', id: 1 });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.role, 'customer');
  assert.ok(created.data.user.id > 2);
  assert.equal((await request('/api/me')).data.user.id, created.data.user.id);
  assert.equal((await request('/api/admin/users')).status, 403);
  assert.equal((await request('/api/auth/register', 'POST', { name: 'Duplicate', email: 'TEST@example.com', password: 'password123' })).status, 409);
  await request('/api/auth/logout', 'POST');
  assert.equal((await request('/api/me')).data.user, null);
  assert.equal((await request('/api/auth/login', 'POST', { email: 'test@example.com', password: 'wrong' })).status, 401);
  const login = await request('/api/auth/login', 'POST', { email: 'test@example.com', password: 'password123' });
  assert.equal(login.data.user.id, created.data.user.id);
});

test('comments use the authenticated user ID and only the owner or admin can delete them', async (t) => {
  const { client } = await fixture(t);
  const buyer = client();
  const other = client();
  const admin = client();
  assert.equal((await buyer('/api/products/1/comments', 'POST', { body: 'Guest comment' })).status, 401);
  await buyer('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  const created = await buyer('/api/products/1/comments', 'POST', { body: '<script>example</script>', user_id: 1 });
  assert.equal(created.status, 201);
  assert.equal(created.data.user_id, 2);
  const comments = (await buyer('/api/products/1/comments')).data;
  assert.equal(comments[0].body, '<script>example</script>');
  await other('/api/auth/register', 'POST', { name: 'Other', email: 'other@example.com', password: 'password123' });
  assert.equal((await other(`/api/comments/${created.data.id}`, 'DELETE')).status, 403);
  await admin('/api/auth/login', 'POST', { email: 'admin@example.com', password: 'admin1234' });
  assert.equal((await admin(`/api/comments/${created.data.id}`, 'DELETE')).status, 200);
  assert.equal((await buyer('/api/products/1/comments')).data.length, 0);
});

test('CMS manages products, hides them from the store, and protects account details', async (t) => {
  const { client } = await fixture(t);
  const request = client();
  const product = { name: 'Notebook', description: 'A little notebook.', price_cents: 850, image_url: '/images/mug.jpg' };
  assert.equal((await request('/api/admin/products', 'POST', product)).status, 403);
  await request('/api/auth/login', 'POST', { email: 'admin@example.com', password: 'admin1234' });
  assert.equal((await request('/api/admin/products', 'POST', { ...product, image_url: 'javascript:alert(1)' })).status, 400);
  const created = await request('/api/admin/products', 'POST', product);
  assert.equal(created.status, 201);
  assert.equal((await request('/api/admin/products/' + created.data.id, 'PUT', { ...product, price_cents: 1200 })).status, 200);
  assert.equal((await request('/api/products')).data.find((p) => p.id === created.data.id).price_cents, 1200);
  await request('/api/admin/products/' + created.data.id, 'DELETE');
  assert.equal((await request('/api/products')).data.some((p) => p.id === created.data.id), false);
  assert.equal((await request('/api/admin/products')).data.find((p) => p.id === created.data.id).active, 0);
  assert.equal((await request('/api/admin/users')).data.some((u) => 'password_hash' in u), false);
});

test('checkout uses database prices and passes real user IDs or guest to Stripe', async (t) => {
  const { client, calls, db } = await fixture(t);
  const guest = client();
  const buyer = client();
  await guest('/api/cart/items', 'POST', { product_id: 1, quantity: 2, price_cents: 1 });
  const guestOrder = await guest('/api/checkout', 'POST', { items: [{ product_id: 1, quantity: 2, price_cents: 1 }], user_id: 1 });
  assert.equal(guestOrder.status, 200);
  assert.equal(calls[0].line_items[0].price_data.unit_amount, 3900);
  assert.equal(calls[0].metadata.user_id, 'guest');
  assert.equal(db.prepare('SELECT user_id FROM orders WHERE id = ?').get(guestOrder.data.order_id).user_id, null);
  await buyer('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  await buyer('/api/cart/items', 'POST', { product_id: 2, quantity: 1 });
  const buyerOrder = await buyer('/api/checkout', 'POST', { items: [{ product_id: 2, quantity: 1 }], user_id: 1 });
  assert.equal(buyerOrder.data.user_id, 2);
  assert.equal(calls[1].metadata.user_id, '2');
  assert.equal(calls[1].customer_email, 'buyer@example.com');
  assert.equal((await buyer('/api/orders')).data.length, 1);
  assert.equal((await guest('/api/orders')).status, 401);
  assert.equal((await buyer('/api/cart/items', 'POST', { product_id: 2, quantity: -1 })).status, 400);
  assert.equal((await buyer('/api/cart/items', 'POST', { product_id: 999, quantity: 1 })).status, 400);
  assert.equal((await buyer('/api/cart/items', 'POST', { product_id: 2, quantity: 99 })).status, 400);
  const empty = client();
  assert.equal((await empty('/api/checkout', 'POST', { items: [{ product_id: 1, quantity: 1 }] })).status, 400);
});

test('payment is verified through Stripe, signed webhooks are idempotent, and totals must match', async (t) => {
  const { client, sessions, url, verifier, db } = await fixture(t);
  const request = client();
  await request('/api/cart/items', 'POST', { product_id: 2, quantity: 2 });
  const checkout = await request('/api/checkout', 'POST', { items: [{ product_id: 2, quantity: 2 }] });
  const session = sessions.get('cs_test_1');
  assert.equal((await request('/api/checkout/cs_test_1')).data.status, 'pending');
  session.payment_status = 'paid';
  session.status = 'complete';
  session.customer_details = { email: 'guest@example.com' };
  const payload = JSON.stringify({ id: 'evt_test_1', type: 'checkout.session.completed', data: { object: session } });
  const signature = verifier.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  const webhook = (body, signed) => fetch(`${url}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signed }, body });
  assert.equal((await webhook(payload, 'invalid')).status, 400);
  assert.equal((await webhook(payload, signature)).status, 200);
  assert.equal((await webhook(payload, signature)).status, 200);
  assert.equal((await request('/api/checkout/cs_test_1')).data.status, 'paid');
  assert.equal(db.prepare('SELECT customer_email FROM orders WHERE id = ?').get(checkout.data.order_id).customer_email, 'guest@example.com');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
  session.amount_total = 1;
  assert.equal((await request('/api/checkout/cs_test_1')).status, 400);
});

test('missing Stripe configuration, invalid JSON, empty input, and cross-origin writes fail clearly', async (t) => {
  const { client, url } = await fixture(t, { payments: false });
  const request = client();
  assert.equal((await request('/api/config')).data.stripe_configured, false);
  const result = await request('/api/checkout', 'POST', { items: [{ product_id: 1, quantity: 1 }] });
  assert.equal(result.status, 503);
  assert.match(result.data.error, /Stripe test secret key/);
  assert.equal((await request('/api/auth/register', 'POST')).status, 400);
  const invalid = await fetch(`${url}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(invalid.status, 400);
  const crossOrigin = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { Origin: 'https://example.net' } });
  assert.equal(crossOrigin.status, 403);
});

test('returning from Stripe verifies payment without a webhook and cancelled sessions stay unpaid', async (t) => {
  const { client, sessions } = await fixture(t);
  const request = client();
  await request('/api/cart/items', 'POST', { product_id: 1, quantity: 1 });
  await request('/api/checkout', 'POST', { items: [{ product_id: 1, quantity: 1 }] });
  assert.equal((await request('/api/checkout/cs_test_1')).data.status, 'pending');
  sessions.get('cs_test_1').payment_status = 'paid';
  sessions.get('cs_test_1').status = 'complete';
  assert.equal((await request('/api/checkout/cs_test_1')).data.status, 'paid');
  await request('/api/cart/items', 'POST', { product_id: 2, quantity: 1 });
  await request('/api/checkout', 'POST', { items: [{ product_id: 2, quantity: 1 }] });
  sessions.get('cs_test_2').status = 'expired';
  assert.equal((await request('/api/checkout/cs_test_2')).data.status, 'expired');
});

test('cart action discovery has no identity endpoint or token exchange', async (t) => {
  const { client } = await fixture(t);
  const request = client();
  const definitions = await request('/api/actions');
  assert.equal(definitions.status, 200);
  assert.equal(Object.hasOwn(definitions.data, 'identity_url'), false);
  assert.equal(definitions.data.actions.add_cart_item.method, 'POST');
  assert.equal((await request('/api/actions/identity')).status, 404);
});

test('guest cart actions reuse the browser cookie and cannot select another cart or account', async (t) => {
  const { client, url } = await fixture(t);
  const guest = client();
  const other = client();
  await guest('/api/cart/items', 'POST', { product_id: 1, quantity: 1 });
  const action = await guest('/api/cart/items', 'POST', { product_id: 2, quantity: 2, user_id: 1, cart_id: 'another-cart' });
  assert.equal(action.status, 200);
  assert.equal(action.data.user_id, null);
  assert.equal((await guest('/api/cart')).data.count, 3);
  assert.equal((await other('/api/cart')).data.count, 0);
  assert.equal((await guest('/api/admin/users')).status, 403);
  assert.equal((await fetch(`${url}/api/cart`, { headers: { 'X-Akropolys-Action': 'get_cart' } })).status, 401);
  assert.equal((await fetch(`${url}/api/cart`, { headers: { authorization: 'Bearer retired-cart-token' } })).status, 401);
  assert.equal((await guest('/api/cart/items/2', 'PATCH', { quantity: 3 })).data.count, 4);
  assert.equal((await guest('/api/cart/items/1', 'DELETE')).data.count, 3);
  assert.equal((await guest('/api/cart/items/1', 'DELETE')).data.count, 3);
  assert.equal((await guest('/api/cart', 'DELETE')).data.count, 0);
});

test('login merges guest items and pending checkout; cookie actions follow login and logout', async (t) => {
  const { client, db } = await fixture(t);
  const request = client();
  await request('/api/cart/items', 'POST', { product_id: 2, quantity: 2 });
  const checkout = await request('/api/checkout', 'POST');
  await request('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  const cart = (await request('/api/cart')).data;
  assert.equal(cart.user_id, 2);
  assert.equal(cart.count, 2);
  assert.equal(db.prepare('SELECT cart_id FROM orders WHERE id = ?').get(checkout.data.order_id).cart_id, cart.cart_id);
  const actionCheckout = await request('/api/checkout', 'POST', { user_id: 1 });
  assert.equal(actionCheckout.data.user_id, 2);
  await request('/api/auth/logout', 'POST');
  const guestCart = (await request('/api/cart')).data;
  assert.equal(guestCart.count, 0);
  assert.equal(guestCart.user_id, null);
  assert.equal((await request('/api/orders')).status, 401);
  const freshBrowser = client();
  await freshBrowser('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  assert.equal((await freshBrowser('/api/cart')).data.count, 2);
});

test('payment removes purchased quantities once while retaining products added after checkout', async (t) => {
  const { client, sessions } = await fixture(t);
  const request = client();
  await request('/api/cart/items', 'POST', { product_id: 2, quantity: 2 });
  await request('/api/checkout', 'POST');
  await request('/api/cart/items', 'POST', { product_id: 2, quantity: 1 });
  await request('/api/cart/items', 'POST', { product_id: 1, quantity: 1 });
  sessions.get('cs_test_1').payment_status = 'paid';
  sessions.get('cs_test_1').status = 'complete';
  await request('/api/checkout/cs_test_1');
  await request('/api/checkout/cs_test_1');
  const cart = (await request('/api/cart')).data;
  assert.equal(cart.count, 2);
  assert.equal(cart.items.find((item) => item.product_id === 2).quantity, 1);
  assert.equal(cart.total_cents, 5100);
});

test('signed Kiku identity comes from the authenticated session and never exposes the signing key', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const akropolys = createAkropolys({ siteId: 'test-shop', apiToken: 'public-test-token', privateKey: privatePem, publicKeyId: 'test-key', baseUrl: 'http://localhost:3000' });
  const { client } = await fixture(t, { akropolys });
  const request = client();
  assert.deepEqual((await request('/api/kiku/identity')).data, {});
  await request('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  const identity = (await request('/api/kiku/identity?user_id=1')).data;
  assert.equal(identity.shopperId, '2');
  const [payload, signature] = identity.userProof.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(decoded.shopperId, '2');
  assert.equal(decoded.siteId, 'test-shop');
  assert.equal(verify('sha256', Buffer.from(payload, 'base64url'), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature, 'base64url')), true);
  const config = (await request('/api/config')).data;
  assert.equal(config.akropolys.api_token, 'public-test-token');
  assert.equal(JSON.stringify(config).includes('PRIVATE KEY'), false);
  await request('/api/auth/logout', 'POST');
  assert.deepEqual((await request('/api/kiku/identity')).data, {});
});

test('the loaded catalogue publishes stable IDs, prices, images, and hidden availability as a signed batch', async (t) => {
  const batches = [];
  const akropolys = createAkropolys({ siteId: 'test-shop', apiToken: 'public', privateKey: 'server-private', publicKeyId: 'test-key', baseUrl: 'http://localhost:3000' }, {
    client: { async ingestBatch(records, signing) { batches.push({ records, signing }); return { success: true, indexed: records.length, queued: 0 }; } }
  });
  const { client, db } = await fixture(t, { akropolys });
  db.prepare('UPDATE products SET active = 0 WHERE id = 1').run();
  const response = await client()('/api/products');
  assert.equal(response.data.length, 3);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].records.length, 4);
  const record = batches[0].records.find((item) => item.id === 1);
  assert.equal(record.fields.available, false);
  assert.equal(record.fields.price, 39);
  assert.match(record.image, /^https:\/\//);
  assert.equal(batches[0].signing.signed, true);
});

test('the assistant proxy streams responses, forwards shopper proof, and excludes shop cookies', async (t) => {
  const requests = [];
  const akropolys = createAkropolys({ siteId: 'test-shop', apiToken: 'public-token', baseUrl: 'http://localhost:3000' });
  const { client, url } = await fixture(t, { akropolys, akropolysFetch: async (url, options) => {
    requests.push({ url, options });
    return new Response('data: The Ceramic Mug is $12.\n\nevent:done\ndata: \n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const request = client();
  await request('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  const response = await fetch(`${url}/api/akropolys/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Akropolys-Token': 'public-token', 'X-Akropolys-Site': 'test-shop', 'X-Akropolys-Shopper-Proof': 'signed-proof', cookie: 'shop_session=private-session' },
    body: JSON.stringify({ query: 'Ceramic Mug' })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /Ceramic Mug is \$12/);
  assert.equal(requests[0].url, 'https://api.akropolys.cloud/v1/chat/stream');
  assert.equal(requests[0].options.headers['x-akropolys-shopper-proof'], 'signed-proof');
  assert.equal(requests[0].options.headers.cookie, undefined);
  assert.equal((await fetch(`${url}/api/akropolys/chat/stream`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${url}/api/akropolys/site-widget?siteId=test-shop`)).status, 200);
});

test('assistant proxy stays on the visitor origin instead of a protected deployment URL', () => {
  const integration = createAkropolys({
    siteId: 'test-shop', apiToken: 'public-token',
    baseUrl: 'https://protected-deployment.vercel.app',
  });
  assert.equal(integration.publicConfig.api_url, '/api/akropolys');
  assert.equal(new URL(integration.publicConfig.api_url, 'https://shop.example').href, 'https://shop.example/api/akropolys');
});


test('checkout verification requires the owning browser or account before contacting Stripe', async t => {
  const { client, sessions } = await fixture(t);
  const guest = client(), other = client();
  await guest('/api/cart/items', 'POST', { product_id: 1, quantity: 1 });
  await guest('/api/checkout', 'POST', {});
  sessions.get('cs_test_1').payment_status = 'paid';
  sessions.get('cs_test_1').status = 'complete';
  assert.equal((await other('/api/checkout/cs_test_1')).status, 404);
  assert.equal((await guest('/api/checkout/cs_test_1')).data.status, 'paid');
  await guest('/api/auth/login', 'POST', { email: 'buyer@example.com', password: 'buyer1234' });
  await guest('/api/cart/items', 'POST', { product_id: 2, quantity: 1 });
  await guest('/api/checkout', 'POST', {});
  assert.equal((await other('/api/checkout/cs_test_2')).status, 404);
  await guest('/api/auth/logout', 'POST');
  assert.equal((await guest('/api/checkout/cs_test_2')).status, 404);
});


test('Vercel production uses its public domain instead of the deployment URL', () => {
  const env = { VERCEL_ENV: 'production', VERCEL_URL: 'protected-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'sample-shop-pi.vercel.app' };
  assert.equal(resolveVercelBaseUrl(env), 'https://sample-shop-pi.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, VERCEL_ENV: 'preview' }), 'https://protected-deployment.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, BASE_URL: 'https://example.com/' }), 'https://example.com');
});


test('a shop alias accepts its own origin and rejects another origin', async (t) => {
  const { client, url } = await fixture(t, { payments: false });
  const request = client();
  const accepted = await request('/api/cart/items', 'POST', { product_id: 1, quantity: 1 }, { origin: url });
  assert.equal(accepted.status, 200);
  const rejected = await request('/api/cart/items', 'POST', { product_id: 1, quantity: 1 }, { origin: 'https://attacker.example' });
  assert.equal(rejected.status, 403);
});
