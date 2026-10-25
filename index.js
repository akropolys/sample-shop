import Stripe from 'stripe';
import { resolve } from 'node:path';
import { openDatabase } from './db.js';
import { createAkropolys } from './akropolys.js';
import { createApp } from './server.js';

const baseUrl = (process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');
if (!baseUrl.startsWith('https://')) {
  throw new Error('Set BASE_URL to the public HTTPS Vercel deployment URL.');
}

const db = openDatabase(resolve('/tmp', 'shop.sqlite'), {
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD
});
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 20000 })
  : null;
const akropolys = createAkropolys({
  siteId: process.env.NEXT_PUBLIC_AKROPOLYS_SITE_ID,
  apiToken: process.env.NEXT_PUBLIC_AKROPOLYS_API_TOKEN,
  publicKeyId: process.env.NEXT_PUBLIC_AKROPOLYS_PUBLIC_KEY_ID,
  privateKey: process.env.AKROPOLYS_PRIVATE_KEY,
  voice: process.env.AKROPOLYS_VOICE === 'true',
  baseUrl
});

export default createApp({
  db,
  stripe,
  stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  baseUrl,
  akropolys
});
