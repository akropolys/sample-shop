import { api } from './shared.js';

let loaded = Promise.resolve();

// The site ID and public token come from the server's config, so the script
// tag is added here; <kiku-button> in index.html places kiku.
export function initKiku(config) {
  if (!config?.enabled || document.getElementById('kiku-loader')) return;
  const script = Object.assign(document.createElement('script'), { id: 'kiku-loader', src: 'https://cdn.akropolys.cloud/kiku/2.2.46/kiku.js' });
  Object.assign(script.dataset, {
    siteId: config.site_id, apiToken: config.api_token, apiUrl: new URL(config.api_url, location.origin).href,
    voice: 'true', vision: 'true'
  });
  loaded = new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('kiku could not load from the CDN.'));
  });
  loaded.catch(reportKikuError);
  document.body.append(script);
}

// Tells kiku who is signed in, so it can act on their cart and account.
export async function syncKikuIdentity() {
  const [identity] = await Promise.all([api('/api/kiku/identity'), loaded]);
  await window.Kiku?.updateIdentity(identity);
}

export function reportKikuError(error) {
  console.error('Shop assistant:', error);
}
