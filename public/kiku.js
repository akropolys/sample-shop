import { api } from './shared.js';

let ready;
let identities = Promise.resolve();

function status(message) {
  const element = document.querySelector('#assistant-status');
  element.textContent = message;
  element.hidden = false;
}

export function reportKikuError(error) {
  console.error('Shop assistant:', error);
  status('The shop assistant is unavailable. Please try again later.');
}

function keepPanelInViewport() {
  const observer = new MutationObserver(apply);
  function apply() {
    const root = document.getElementById('akropolys-kiku-root')?.shadowRoot;
    if (!root) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.hsk-cb-overlay { overflow: clip !important; }');
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    observer.disconnect();
  }
  observer.observe(document.body, { childList: true });
  apply();
}

export function initKiku(config) {
  if (!config?.enabled || ready) return;
  status('The shop assistant is connecting…');
  ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'kiku-loader';
    script.src = 'https://cdn.akropolys.cloud/kiku/2.2.41/kiku.js';
    script.dataset.siteId = config.site_id;
    script.dataset.apiToken = config.api_token;
    script.dataset.apiUrl = new URL(config.api_url, window.location.origin).href;
    script.dataset.label = 'Ask about products';
    script.dataset.voice = 'true';
    script.addEventListener('load', () => {
      if (!window.Kiku?.ready) { reject(new Error('Kiku loaded without its setup promise.')); return; }
      window.Kiku.ready.then(() => { keepPanelInViewport(); return window.Kiku; }).then(resolve, reject);
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Kiku could not load from the CDN.')), { once: true });
    document.body.append(script);
  });
  ready.then(() => status('Ask the shop assistant about our products.'), reportKikuError);
}

export function syncKikuIdentity() {
  if (!ready) return Promise.resolve();
  identities = identities.catch(() => {}).then(async () => {
    const widget = await ready;
    const identity = await api('/api/kiku/identity');
    await widget.updateIdentity(identity);
  });
  return identities;
}
