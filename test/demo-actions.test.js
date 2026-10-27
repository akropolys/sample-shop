import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../db.js';
import { createApp } from '../server.js';

async function fixture(t) {
  const db = openDatabase(':memory:');
  let stripeCalls = 0;
  const stripe = { checkout: { sessions: { create() { stripeCalls++; throw new Error('Demo must never call Stripe'); } } } };
  const server = createApp({ db, stripe, baseUrl: 'http://localhost:3000' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  function client() {
    const cookies = new Map();
    return async (path, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'Content-Type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); cookies.set(key, value); }
      const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
      return { status: response.status, data };
    };
  }
  return { db, client, stripeCalls: () => stripeCalls };
}

test('all three hook endpoints exercise a free checkout without changing cart, orders or Stripe', async t => {
  const { db, client, stripeCalls } = await fixture(t);
  const request = client();
  await request('/api/cart/items', 'POST', { product_id: 1, quantity: 2 });
  const cart = (await request('/api/cart')).data;
  assert.equal((await request('/api/demo/before')).data.ready, true);
  const created = await request('/api/demo/checkout', 'POST', {});
  assert.equal(created.status, 201);
  assert.equal(created.data.created, true);
  const id = created.data.demo_id;
  assert.equal(new URL(created.data.checkout_url).pathname, '/demo-checkout.html');
  assert.equal((await request(`/api/demo/on-return?demo_id=${id}`)).data.status, 'pending');
  assert.equal((await request('/api/demo/after', 'POST', { demo_id: id })).data.recorded, true);
  await request('/api/demo/after', 'POST', { demo_id: id });
  assert.equal((await request(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'completed' })).data.completed, true);
  const returned = (await request(`/api/demo/on-return?demo_id=${id}`)).data;
  assert.equal(returned.status, 'completed');
  assert.equal(returned.charged, false);
  assert.equal(returned.amount_charged_cents, 0);
  assert.deepEqual((await request('/api/cart')).data, cart);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
  assert.equal(stripeCalls(), 0);
  const events = (await request('/api/demo/events')).data.events;
  assert.deepEqual(events.map(x => x.phase), ['before', 'checkout', 'on_return', 'after', 'visitor', 'on_return']);
  assert.equal(events.filter(x => x.phase === 'after').length, 1);
});

test('cancel, invalid input, other browsers, and repeated completion are handled explicitly', async t => {
  const { client } = await fixture(t);
  const request = client(), other = client();
  const id = (await request('/api/demo/checkout', 'POST', {})).data.demo_id;
  assert.equal((await other(`/api/demo/on-return?demo_id=${id}`)).status, 404);
  assert.equal((await other(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'completed' })).status, 404);
  assert.equal((await other('/api/demo/after', 'POST', { demo_id: id })).status, 404);
  assert.deepEqual((await other('/api/demo/events')).data.events, []);
  assert.equal((await request('/api/demo/on-return')).status, 400);
  assert.equal((await request('/api/demo/after', 'POST', {})).status, 400);
  assert.equal((await request(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'paid' })).status, 400);
  await request(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'cancelled' });
  assert.equal((await request(`/api/demo/on-return?demo_id=${id}`)).data.status, 'cancelled');
  assert.equal((await request(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'cancelled' })).status, 200);
  assert.equal((await request(`/api/demo/sessions/${id}/finish`, 'POST', { outcome: 'completed' })).status, 409);
});

test('definitions include all three hooks and both demo pages are served', async t => {
  const { client } = await fixture(t);
  const request = client();
  const actions = (await request('/api/demo/actions')).data.actions;
  assert.deepEqual(actions.demo_checkout.hooks, { before: 'demo_before', after: 'demo_after', onReturn: 'demo_on_return' });
  for (const name of Object.values(actions.demo_checkout.hooks)) assert.ok(actions[name]);
  const all = (await request('/api/actions')).data.actions;
  assert.ok(all.checkout.url.endsWith('/api/checkout'));
  assert.ok(all.demo_checkout.url.endsWith('/api/demo/checkout'));
  for (const page of ['/action-demo.html', '/demo-checkout.html', '/action-demo.js', '/demo-checkout.js']) assert.equal((await request(page)).status, 200);
});


test('demo writes have per-browser, global storage and request limits', async t => {
  const { client, db } = await fixture(t);
  const request = client();
  for (let n = 0; n < 20; n++) assert.equal((await request('/api/demo/checkout', 'POST', {})).status, 201);
  assert.equal((await request('/api/demo/checkout', 'POST', {})).status, 429);
  assert.equal(db.prepare('SELECT count(*) AS n FROM action_demo_runs').get().n, 20);
  let limited;
  for (let n = 0; n < 45; n++) limited = await request('/api/demo/before');
  assert.equal(limited.status, 429);
  assert.ok(db.prepare('SELECT count(*) AS n FROM action_demo_events').get().n <= 60);
});
