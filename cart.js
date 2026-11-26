import { productById } from './products.js';

const COOKIE = 'shop_cart';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// The cart lives in the visitor's cookie as { productId: quantity }.
export function load(req) {
  const raw = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  try {
    const items = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1)));
    return Object.fromEntries(Object.entries(items).filter(([id, qty]) => productById(Number(id)) && Number.isInteger(qty) && qty >= 1 && qty <= 99));
  } catch {
    return {};
  }
}

export function view(items) {
  const lines = Object.entries(items).map(([id, quantity]) => {
    const product = productById(Number(id));
    return { product_id: product.id, name: product.name, price_cents: product.price_cents, image_url: product.image_url, quantity, line_total_cents: product.price_cents * quantity };
  });
  return {
    items: lines,
    count: lines.reduce((sum, item) => sum + item.quantity, 0),
    total_cents: lines.reduce((sum, item) => sum + item.line_total_cents, 0),
    currency: 'usd'
  };
}

function check(productId, quantity) {
  if (!productById(productId)) fail(400, 'Use a valid product ID.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail(400, 'Quantity must be between 1 and 99.');
}

export function cartRoutes(app, secure) {
  const send = (res, items) => {
    res.cookie(COOKIE, JSON.stringify(items), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json(view(items));
  };
  // Cart changes come from the visitor's own browser; kiku's actions run there too.
  app.use('/api/cart', (req, res, next) => {
    if (req.get('authorization') || req.get('x-akropolys-action')) fail(401, 'Use the shop browser session for cart actions.');
    next();
  });

  app.get('/api/cart', (req, res) => res.json(view(load(req))));
  app.delete('/api/cart', (req, res) => send(res, {}));
  app.post('/api/cart/items', (req, res) => {
    const { product_id: productId, quantity = 1 } = req.body;
    check(productId, quantity);
    const items = load(req);
    const total = (items[productId] || 0) + quantity;
    if (total > 99) fail(400, 'Maximum quantity is 99 per product.');
    send(res, { ...items, [productId]: total });
  });
  app.patch('/api/cart/items/:productId', (req, res) => {
    const productId = Number(req.params.productId);
    check(productId, req.body.quantity);
    const items = load(req);
    if (!items[productId]) fail(404, 'Product is not in your cart.');
    send(res, { ...items, [productId]: req.body.quantity });
  });
  app.delete('/api/cart/items/:productId', (req, res) => {
    const { [req.params.productId]: _removed, ...items } = load(req);
    send(res, items);
  });
}
