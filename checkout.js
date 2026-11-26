import { load, view } from './cart.js';

// Test checkout through Polar. Every cart is charged $1, and with
// POLAR_AUTO_REFUND=true the $1 is refunded as soon as payment is confirmed.
const TEST_PRICE_CENTS = 100;
const DEFAULT_PRODUCT = '2cd9687d-2afe-4886-b5b1-beca7ce1bbc3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function polarConfig(env = process.env) {
  return {
    token: env.POLAR_ACCESS_TOKEN || '',
    productId: env.POLAR_PRODUCT_ID || DEFAULT_PRODUCT,
    api: env.POLAR_SERVER === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh',
    autoRefund: env.POLAR_AUTO_REFUND === 'true'
  };
}

async function polar(config, fetchImpl, path, method = 'GET', body) {
  if (!config.token) fail(503, 'Checkout is not set up on this shop yet.');
  const response = await fetchImpl(config.api + path, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`Polar ${method} ${path}: ${response.status} ${JSON.stringify(data)?.slice(0, 300)}`);
    fail(response.status === 404 ? 404 : 502, response.status === 404 ? 'Checkout not found.' : 'The payment service did not answer. Please try again.');
  }
  return data;
}

// Refunds the order behind a paid checkout once. Returns true when it is refunded.
async function refund(config, fetchImpl, checkoutId) {
  const orders = await polar(config, fetchImpl, `/v1/orders/?checkout_id=${checkoutId}&limit=1`);
  const order = orders?.items?.[0];
  if (!order) return false;
  if (order.status === 'refunded') return true;
  if (order.status !== 'paid') return false;
  const amount = order.refundable_amount ?? order.net_amount ?? order.total_amount;
  if (!(amount > 0)) return false;
  await polar(config, fetchImpl, '/v1/refunds/', 'POST', { order_id: order.id, reason: 'customer_request', amount, comment: 'Simple Shop test checkout, refunded automatically.' });
  return true;
}

export function checkoutRoutes(app, { baseUrl, secure, config = polarConfig(), fetchImpl = fetch }) {
  // Like the cart, checkout runs in the visitor's own browser session.
  app.use('/api/checkout', (req, res, next) => {
    if (req.get('authorization') || req.get('x-akropolys-action')) fail(401, 'Use the shop browser session for checkout.');
    next();
  });

  app.post('/api/checkout', async (req, res) => {
    const cart = view(load(req));
    if (!cart.count) fail(400, 'The cart is empty. Add something first.');
    const checkout = await polar(config, fetchImpl, '/v1/checkouts/', 'POST', {
      products: [config.productId],
      success_url: `${baseUrl}/?checkout_id={CHECKOUT_ID}`,
      metadata: { cart: cart.items.map((item) => `${item.product_id}x${item.quantity}`).join(',').slice(0, 500) }
    });
    res.json({
      checkout_id: checkout.id,
      checkout_url: checkout.url,
      title: 'Simple Shop',
      total_cents: checkout.total_amount ?? TEST_PRICE_CENTS,
      currency: checkout.currency || 'usd',
      items: cart.items.map(({ product_id, name, quantity }) => ({ product_id, name, quantity })),
      note: 'Test checkout: the whole cart costs $1.' + (config.autoRefund ? ' The $1 is refunded automatically after payment.' : '')
    });
  });

  app.get('/api/checkout/:checkoutId', async (req, res) => {
    const id = req.params.checkoutId;
    if (!UUID.test(id)) fail(400, 'Use the checkout_id from the checkout.');
    const checkout = await polar(config, fetchImpl, `/v1/checkouts/${id}`);
    const paid = checkout.status === 'succeeded';
    let refunded = false;
    if (paid && config.autoRefund) refunded = await refund(config, fetchImpl, id);
    // A paid order empties the cart.
    if (paid) res.cookie('shop_cart', '{}', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({
      checkout_id: id,
      status: checkout.status,
      paid,
      refunded,
      total_cents: checkout.total_amount,
      currency: checkout.currency,
      meaning: {
        open: 'The visitor has not paid yet.',
        confirmed: 'Payment is being processed; it is not confirmed yet.',
        succeeded: refunded ? 'Paid, and the test payment was refunded.' : 'Paid.',
        expired: 'The checkout expired without payment.',
        failed: 'The payment failed.'
      }[checkout.status] || 'Unknown status.'
    });
  });
}
