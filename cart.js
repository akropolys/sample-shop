import { createHash, randomBytes, randomUUID } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const cookie = (req, name) => (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

export function createCartStore(db, cookieOptions) {
  function userCart(userId) {
    let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
    if (!cart) {
      const id = randomUUID();
      db.prepare('INSERT INTO carts (id, user_id) VALUES (?, ?)').run(id, userId);
      cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(id);
    }
    return cart;
  }

  function guestCart(req) {
    const token = cookie(req, 'shop_guest');
    return token ? db.prepare('SELECT * FROM carts WHERE guest_token_hash = ? AND user_id IS NULL').get(hash(token)) : null;
  }

  function context(req, res) {
    const authorization = req.get('authorization');
    if (req.get('x-akropolys-action') && !authorization) fail(401, 'This action needs the visitor cart token from the identity endpoint.');
    if (authorization) {
      const token = /^Bearer ([a-f\d]{64})$/i.exec(authorization)?.[1];
      if (!token) fail(401, 'Invalid cart authorization.');
      const entry = db.prepare(`SELECT t.*, c.user_id FROM action_tokens t JOIN carts c ON c.id = t.cart_id
        WHERE t.token_hash = ? AND t.expires_at > ?`).get(hash(token), Date.now());
      if (!entry) fail(401, 'Cart authorization has expired. Reopen the shop and try again.');
      let user = null;
      if (entry.user_id) {
        user = db.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
          WHERE s.token_hash = ? AND s.expires_at > ? AND u.id = ?`).get(entry.session_token_hash, Date.now(), entry.user_id);
        if (!user) fail(401, 'Sign in again to use this cart.');
      }
      return { id: entry.cart_id, user };
    }
    if (req.user) return { id: userCart(req.user.id).id, user: req.user };
    let cart = guestCart(req);
    if (!cart) {
      const id = randomUUID();
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO carts (id, guest_token_hash) VALUES (?, ?)').run(id, hash(token));
      res.cookie('shop_guest', token, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
      cart = { id };
    }
    return { id: cart.id, user: null };
  }

  function read(owner) {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id IN (SELECT id FROM products WHERE active = 0)').run(owner.id);
    const items = db.prepare(`SELECT p.id AS product_id, p.name, p.price_cents, p.image_url, c.quantity,
      p.price_cents * c.quantity AS line_total_cents FROM cart_items c JOIN products p ON p.id = c.product_id
      WHERE c.cart_id = ? ORDER BY p.id`).all(owner.id);
    return {
      cart_id: owner.id,
      user_id: owner.user?.id || null,
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      total_cents: items.reduce((sum, item) => sum + item.line_total_cents, 0),
      currency: 'usd'
    };
  }

  function validate(productId, quantity) {
    if (!Number.isInteger(productId) || productId < 1) fail(400, 'Use a valid product ID.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail(400, 'Quantity must be between 1 and 99.');
    if (!db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').get(productId)) fail(400, 'Product is not available.');
  }

  return {
    context,
    read,
    add(owner, productId, quantity = 1) {
      validate(productId, quantity);
      const existing = db.prepare('SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?').get(owner.id, productId);
      const total = (existing?.quantity || 0) + quantity;
      if (total > 99) fail(400, 'Maximum quantity is 99 per product.');
      if (!existing && db.prepare('SELECT COUNT(*) AS count FROM cart_items WHERE cart_id = ?').get(owner.id).count >= 50) fail(400, 'Maximum 50 different products per cart.');
      db.prepare(`INSERT INTO cart_items VALUES (?, ?, ?)
        ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity`).run(owner.id, productId, total);
      return read(owner);
    },
    update(owner, productId, quantity) {
      validate(productId, quantity);
      const result = db.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').run(quantity, owner.id, productId);
      if (!result.changes) fail(404, 'Product is not in your cart.');
      return read(owner);
    },
    remove(owner, productId) {
      if (!Number.isInteger(productId) || productId < 1) fail(400, 'Use a valid product ID.');
      db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(owner.id, productId);
      return read(owner);
    },
    clear(owner) {
      db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(owner.id);
      return read(owner);
    },
    mergeGuest(req, res, user) {
      const guest = guestCart(req);
      if (!guest) return;
      const target = userCart(user.id);
      db.exec('BEGIN');
      try {
        const items = db.prepare('SELECT product_id, quantity FROM cart_items WHERE cart_id = ?').all(guest.id);
        for (const item of items) {
          db.prepare(`INSERT INTO cart_items VALUES (?, ?, ?) ON CONFLICT(cart_id, product_id)
            DO UPDATE SET quantity = MIN(99, cart_items.quantity + excluded.quantity)`).run(target.id, item.product_id, item.quantity);
        }
        db.prepare('UPDATE orders SET cart_id = ? WHERE cart_id = ?').run(target.id, guest.id);
        db.prepare('DELETE FROM carts WHERE id = ?').run(guest.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      res.clearCookie('shop_guest', cookieOptions);
    },
    identity(req, res) {
      if (req.get('authorization')) fail(400, 'Open this identity endpoint from the shop.');
      const owner = context(req, res);
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM action_tokens WHERE expires_at < ?').run(Date.now());
      db.prepare('INSERT INTO action_tokens VALUES (?, ?, ?, ?)').run(hash(token), owner.id, req.user ? hash(req.sessionToken) : null, Date.now() + 15 * 60 * 1000);
      return { authorization: `Bearer ${token}`, user_id: owner.user?.id || null };
    }
  };
}
