import { createIngestClient, signed, signUser } from '@akropolys/sdk/server';

const productImages = {
  '/images/backpack.jpg': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=800&q=80',
  '/images/mug.jpg': 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=80',
  '/images/headphones.jpg': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
  '/images/sneakers.jpg': 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80'
};

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

export function createAkropolys({ siteId, apiToken, privateKey, publicKeyId, baseUrl, voice = false }, dependencies = {}) {
  if (!siteId && !apiToken && !privateKey && !publicKeyId) return null;
  if (!siteId || !apiToken) throw new Error('Akropolys needs both a site ID and public API token.');
  if (Boolean(privateKey) !== Boolean(publicKeyId)) throw new Error('Akropolys signing needs both the private key and public key ID.');
  const client = dependencies.client || createIngestClient({ siteId, apiToken, privateKey, kid: publicKeyId, timeoutMs: 60000 });
  const makeProof = dependencies.signUser || signUser;
  let queue = Promise.resolve();
  const status = { site_id: siteId, signed: Boolean(privateKey), last_result: null, last_error: null, pending: 0 };
  return {
    publicConfig: { enabled: true, site_id: siteId, api_token: apiToken, voice, api_url: '/api/akropolys' },
    async identity(user) {
      if (!user) return {};
      const shopperId = String(user.id);
      const identity = { shopperId };
      if (privateKey) identity.userProof = await makeProof(shopperId, privateKey, { siteId, kid: publicKeyId });
      return identity;
    },
    publish(products) {
      const records = productRecords(products, baseUrl);
      status.pending++;
      const operation = queue.then(() => client.ingestBatch(records, privateKey ? signed : undefined, { batchSize: 25 }));
      const complete = operation.then((result) => {
        status.last_result = result;
        status.last_error = null;
        return result;
      }, (error) => {
        status.last_error = { message: error.message, status: error.status || null };
        throw error;
      }).finally(() => { status.pending--; });
      queue = complete.catch(() => {});
      return complete;
    },
    status: () => ({ ...status })
  };
}
