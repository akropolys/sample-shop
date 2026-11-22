// Sends the product list to kiku. Run after changing products:
//   node --env-file=.env send-products.js
import { createIngestClient, signed } from '@akropolys/sdk/server';
import { products } from './products.js';

const site = (process.env.BASE_URL || '').replace(/\/$/, '');
if (!site.startsWith('https://')) throw new Error('Set BASE_URL to the shop’s public https address.');

const kiku = createIngestClient({
  apiToken: process.env.KIKU_PUBLIC_KEY,
  privateKey: process.env.KIKU_PRIVATE_KEY,
  // Only needed until the SDK on npm works these out from the keys.
  siteId: process.env.KIKU_SITE_ID,
  kid: process.env.KIKU_PUBLIC_KEY_ID,
  timeoutMs: 60000
});

const result = await kiku.ingestBatch(products.map((product) => ({
  id: product.id,
  title: product.name,
  image: new URL(product.image_url, site).href,
  content: product.description,
  fields: { product_id: product.id, price: product.price_cents / 100, currency: 'USD', url: `${site}/#product-${product.id}` }
})), signed);

console.log(`Sent ${products.length} products to kiku: ${result.indexed} new, ${result.updated} updated, ${result.skipped} unchanged.`);
