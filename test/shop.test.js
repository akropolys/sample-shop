import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, resolveVercelBaseUrl } from '../server.js';

async function shop(t) {
  const server = createApp({ baseUrl: 'http://localhost:3000' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  // A browser: keeps the cart cookie between requests.
  const browser = () => {
    let cookie = '';
    return async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(url + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      });
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
    };
  };
  return { url, browser };
}

test('products keep their IDs, prices and pictures', async (t) => {
  const { browser } = await shop(t);
  const products = (await browser()('/api/products')).data;
  assert.equal(products.length, 63);
  assert.deepEqual([products[0].id, products[0].name], [1, 'Everyday Backpack']);
  assert.equal(products.find((p) => p.name === 'Chicken Breast').id, 5);
  assert.equal(products.find((p) => p.name === 'Blue Check Shirt').id, 43);
  for (const product of products) {
    assert.ok(product.price_cents > 0, product.name);
    assert.match(product.image_url, /^(https:\/\/|\/images\/)/, product.name);
  }
});

test('the cart lives in the visitor’s cookie', async (t) => {
  const { browser } = await shop(t);
  const visitor = browser();
  assert.deepEqual((await visitor('/api/cart')).data.items, []);
  await visitor('/api/cart/items', 'POST', { product_id: 2, quantity: 1 });
  let cart = (await visitor('/api/cart/items', 'POST', { product_id: 2, quantity: 2 })).data;
  assert.equal(cart.items[0].quantity, 3);
  assert.equal(cart.total_cents, 3 * 1200);
  cart = (await visitor('/api/cart/items/2', 'PATCH', { quantity: 5 })).data;
  assert.equal(cart.count, 5);
  await visitor('/api/cart/items', 'POST', { product_id: 5, quantity: 1 });
  cart = (await visitor('/api/cart/items/2', 'DELETE')).data;
  assert.deepEqual(cart.items.map((item) => item.product_id), [5]);
  assert.equal((await visitor('/api/cart', 'DELETE')).data.count, 0);
  assert.equal((await browser()('/api/cart')).data.count, 0, 'another visitor has their own cart');
});

test('groceries, fashion and wall art can be added, and wall art is served', async (t) => {
  const { url, browser } = await shop(t);
  const visitor = browser();
  const products = (await visitor('/api/products')).data;
  for (const name of ['Chicken Breast', 'Blue Check Shirt', 'Upholstered Sofa', 'Botanical Wall Print']) {
    const product = products.find((p) => p.name === name);
    assert.ok(product, name);
    assert.equal((await visitor('/api/cart/items', 'POST', { product_id: product.id, quantity: 1 })).status, 200, name);
  }
  assert.equal((await visitor('/api/cart')).data.items.length, 4);
  const image = await fetch(`${url}/images/wall-botanical.svg`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\/svg\+xml/);
});

test('bad cart requests are refused clearly', async (t) => {
  const { browser } = await shop(t);
  const visitor = browser();
  assert.equal((await visitor('/api/cart/items', 'POST', { product_id: 999, quantity: 1 })).status, 400);
  assert.equal((await visitor('/api/cart/items', 'POST', { product_id: 1, quantity: 100 })).status, 400);
  assert.equal((await visitor('/api/cart/items/1', 'PATCH', { quantity: 2 })).status, 404);
  assert.equal((await visitor('/api/cart/items', 'POST', '{bad json')).status, 400);
  // The cart is reached from the shopper's browser only.
  assert.equal((await visitor('/api/cart', 'GET', undefined, { 'X-Akropolys-Action': 'get_cart' })).status, 401);
});

test('the action list has the cart and checkout actions', async (t) => {
  const { browser } = await shop(t);
  const { actions } = (await browser()('/api/actions')).data;
  assert.deepEqual(Object.keys(actions).sort(), ['add_cart_item', 'clear_cart', 'get_cart', 'get_checkout_status', 'remove_cart_item', 'start_checkout', 'update_cart_item']);
  assert.equal(actions.get_cart.url, 'http://localhost:3000/api/cart');
});

test('Vercel production uses its public domain instead of the deployment URL', () => {
  const env = { VERCEL_ENV: 'production', VERCEL_URL: 'protected-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'sample-shop-pi.vercel.app' };
  assert.equal(resolveVercelBaseUrl(env), 'https://sample-shop-pi.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, VERCEL_ENV: 'preview' }), 'https://protected-deployment.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, BASE_URL: 'https://example.com/' }), 'https://example.com');
});

test('checkout charges $1 through Polar and refunds once paid', async (t) => {
  const calls = [];
  let status = 'open';
  const fakePolar = async (url, init) => {
    const path = url.replace('https://api.polar.sh', '');
    calls.push(`${init.method} ${path}`);
    const reply = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/v1/checkouts/') return reply({ id: '11111111-2222-4333-8444-555555555555', url: 'https://buy.polar.sh/test', total_amount: 100, currency: 'usd' });
    if (path.startsWith('/v1/checkouts/')) return reply({ status, total_amount: 100, currency: 'usd' });
    if (path.startsWith('/v1/orders/')) return reply({ items: [{ id: 'order-1', status: 'paid', refundable_amount: 100 }] });
    if (path === '/v1/refunds/') return reply({ id: 'refund-1', status: 'pending' });
    throw new Error('unexpected ' + path);
  };
  const server = createApp({ baseUrl: 'http://localhost:3000', polar: { token: 't', productId: 'p', api: 'https://api.polar.sh', autoRefund: true }, fetchImpl: fakePolar }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(url + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call('/api/checkout', 'POST')).status, 400, 'empty cart');
  await call('/api/cart/items', 'POST', { product_id: 1, quantity: 2 });
  const started = (await call('/api/checkout', 'POST')).data;
  assert.equal(started.checkout_url, 'https://buy.polar.sh/test');
  assert.equal(started.total_cents, 100);
  assert.equal((await call(`/api/checkout/${started.checkout_id}`)).data.paid, false);
  assert.ok(!calls.includes('POST /v1/refunds/'));
  status = 'succeeded';
  const done = (await call(`/api/checkout/${started.checkout_id}`)).data;
  assert.deepEqual([done.paid, done.refunded], [true, true]);
  assert.equal((await call('/api/cart')).data.count, 0, 'paid cart is emptied');
  assert.equal((await call('/api/checkout/not-a-uuid')).status, 400);
});
