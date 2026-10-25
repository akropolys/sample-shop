export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

export function el(tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (text !== '') element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function button(text, handler, className = '') {
  const element = el('button', text, className);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
}

export function announce(message, error = false) {
  const notice = document.querySelector('#message');
  notice.textContent = message;
  notice.dataset.error = String(error);
  notice.hidden = false;
}

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const date = (value) => new Date(`${value.replace(' ', 'T')}Z`).toLocaleString();
