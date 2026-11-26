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
  assert.deepEqual(Object.keys(actions).sort(), ['add_cart_item', 'clear_cart', 'get_cart', 'remove_cart_item', 'start_checkout', 'update_cart_item']);
  assert.equal(actions.get_cart.url, 'http://localhost:3000/api/cart');
});

test('Vercel production uses its public domain instead of the deployment URL', () => {
  const env = { VERCEL_ENV: 'production', VERCEL_URL: 'protected-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'sample-shop-pi.vercel.app' };
  assert.equal(resolveVercelBaseUrl(env), 'https://sample-shop-pi.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, VERCEL_ENV: 'preview' }), 'https://protected-deployment.vercel.app');
  assert.equal(resolveVercelBaseUrl({ ...env, BASE_URL: 'https://example.com/' }), 'https://example.com');
});

test('checkout hands kiku the payment link as JSON', async (t) => {
  const { browser } = await shop(t);
  const visitor = browser();
  assert.equal((await visitor('/api/checkout', 'POST')).status, 400, 'empty cart');
  await visitor('/api/cart/items', 'POST', { product_id: 1, quantity: 2 });
  const { status, data } = await visitor('/api/checkout', 'POST');
  assert.equal(status, 200);
  assert.match(data.checkout_url, /^https:\/\/buy\.polar\.sh\/polar_cl_/);
  assert.deepEqual([data.total_cents, data.currency], [100, 'usd']);
  assert.deepEqual(data.items, [{ product_id: 1, name: 'Everyday Backpack', quantity: 2 }]);
});
