import { createIngestClient, signed, signUser } from '@akropolys/sdk/server';

const productImages = {
  '/images/backpack.jpg': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80',
  '/images/mug.jpg': 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=80',
  '/images/headphones.jpg': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
  '/images/sneakers.jpg': 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80'
};

// What kiku knows about each product: the shop chooses these fields.
export function productRecords(products, baseUrl) {
  return products.map((product) => ({
    id: product.id,
    title: product.name,
    image: productImages[product.image_url] || new URL(product.image_url, baseUrl).href,
    fields: {
      product_id: product.id,
      description: product.description,
      price: product.price_cents / 100,
      currency: 'USD',
      available: Boolean(product.active),
      url: `${baseUrl}/#product-${product.id}`
    },
    content: `${product.description}\n${product.active ? 'Available to buy.' : 'Unavailable. This product is hidden and cannot be purchased.'}`
  }));
}

// kiku for this shop: the config the page loads it with, the catalogue the
// shop publishes (signed when a key is set), and the signed-in shopper.
export function createAkropolys({ siteId, apiToken, privateKey, publicKeyId, baseUrl }, { client } = {}) {
  if (!siteId || !apiToken) return null;
  const ingest = client || createIngestClient({ siteId, apiToken, privateKey, kid: publicKeyId, timeoutMs: 60000 });
  return {
    publicConfig: { enabled: true, site_id: siteId, api_token: apiToken, api_url: 'https://api.akropolys.cloud/v1' },
    publish: (products) => ingest.ingestBatch(productRecords(products, baseUrl), privateKey ? signed : undefined),
    async identity(user) {
      if (!user) return {};
      const shopperId = String(user.id);
      return privateKey ? { shopperId, userProof: await signUser(shopperId, privateKey, { siteId, kid: publicKeyId }) } : { shopperId };
    }
  };
}
