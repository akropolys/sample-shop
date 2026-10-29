import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ingredients } from './ingredients.js';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

export function openDatabase(filename, options = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      image_url TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id),
      guest_token_hash TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      PRIMARY KEY (cart_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      customer_email TEXT,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
      stripe_session_id TEXT UNIQUE,
      cart_id TEXT REFERENCES carts(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE INDEX IF NOT EXISTS comments_product ON comments(product_id);
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
  `);
  if (!db.prepare('PRAGMA table_info(orders)').all().some((column) => column.name === 'cart_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN cart_id TEXT REFERENCES carts(id)');
  }
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const adminEmail = (options.adminEmail || 'admin@example.com').toLowerCase();
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    insertUser.run('Shop Admin', adminEmail, hashPassword(options.adminPassword || 'admin1234'), 'admin');
  }
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get('buyer@example.com')) {
    insertUser.run('Demo Buyer', 'buyer@example.com', hashPassword('buyer1234'), 'customer');
  }
  if (!db.prepare('SELECT id FROM products LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO products (name, description, price_cents, image_url) VALUES (?, ?, ?, ?)');
    insert.run('Everyday Backpack', 'A simple backpack for your daily essentials.', 3900, '/images/backpack.jpg');
    insert.run('Ceramic Mug', 'A comfortable cup for your morning coffee or tea.', 1200, '/images/mug.jpg');
    insert.run('Wireless Headphones', 'Over-ear headphones for music, work, and quiet moments.', 5900, '/images/headphones.jpg');
    insert.run('Red Sneakers', 'Light everyday sneakers with a little color.', 4900, '/images/sneakers.jpg');
  }
  // One-time, transactional seed also adds groceries to existing shops without overwriting edits.
  db.exec('CREATE TABLE IF NOT EXISTS seed_migrations (name TEXT PRIMARY KEY)');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT name FROM seed_migrations WHERE name = ?').get('grocery-ingredients-v1')) {
      const exists = db.prepare('SELECT id FROM products WHERE name = ? COLLATE NOCASE LIMIT 1');
      const insert = db.prepare('INSERT INTO products (name, description, price_cents, image_url) VALUES (?, ?, ?, ?)');
      for (const item of ingredients) {
        if (!exists.get(item.name)) insert.run(item.name, item.description, item.price_cents, item.image_url);
      }
      db.prepare('INSERT INTO seed_migrations (name) VALUES (?)').run('grocery-ingredients-v1');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return db;
}
