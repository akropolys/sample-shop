import { load, view } from './cart.js';

// Test checkout: hands kiku the Polar checkout link as JSON. The whole cart costs $1.
const CHECKOUT_LINK = 'https://buy.polar.sh/polar_cl_KUKNoINuvfzyrCuuAxJUTr7ly3M32rQOyhrl0409XgB';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function checkoutRoutes(app, { link = process.env.POLAR_CHECKOUT_LINK || CHECKOUT_LINK } = {}) {
  app.post('/api/checkout', (req, res) => {
    const cart = view(load(req));
    if (!cart.count) fail(400, 'The cart is empty. Add something first.');
    res.json({
      checkout_url: link,
      title: 'Simple Shop',
      total_cents: 100,
      currency: 'usd',
      items: cart.items.map(({ product_id, name, quantity }) => ({ product_id, name, quantity })),
      note: 'Test checkout: the whole cart costs $1.'
    });
  });
}
