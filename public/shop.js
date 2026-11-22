import { api, el, button, announce, money } from './shared.js';

let cart = { items: [], count: 0, total_cents: 0 };
let busy = false;

function renderCart() {
  const list = document.querySelector('#cart-items');
  list.replaceChildren();
  if (!cart.items.length) list.append(el('p', 'Your cart is empty.', 'muted'));
  for (const item of cart.items) {
    const row = el('div', '', 'cart-item');
    row.append(el('strong', item.name), el('span', `${money(item.price_cents)} each · ${money(item.line_total_cents)}`, 'muted small'));
    const quantity = el('input');
    Object.assign(quantity, { type: 'number', min: '1', max: '99', value: item.quantity, disabled: busy });
    quantity.setAttribute('aria-label', `Quantity for ${item.name}`);
    quantity.addEventListener('change', () => change(`/api/cart/items/${item.product_id}`, 'PATCH', { quantity: Number(quantity.value) }));
    const remove = button('Remove', () => change(`/api/cart/items/${item.product_id}`, 'DELETE'), 'small');
    remove.disabled = busy;
    const controls = el('div', '', 'actions');
    controls.append(quantity, remove);
    row.append(controls);
    list.append(row);
  }
  document.querySelector('#cart-total').textContent = money(cart.total_cents);
  document.querySelector('#cart-count').textContent = `(${cart.count})`;
}

async function change(path, method, body) {
  busy = true;
  renderCart();
  try { cart = await api(path, { method, body }); }
  catch (error) { announce(error.message, true); }
  finally { busy = false; renderCart(); }
}

// kiku changes the cart too, so check for its changes every few seconds.
async function refresh() {
  if (busy || document.visibilityState !== 'visible' || document.activeElement?.closest('#cart-items input')) return;
  const latest = await api('/api/cart');
  if (JSON.stringify(latest) !== JSON.stringify(cart)) { cart = latest; renderCart(); }
}

function renderProducts(products) {
  const list = document.querySelector('#products');
  list.replaceChildren();
  for (const product of products) {
    const card = el('article', '', 'product');
    card.id = `product-${product.id}`;
    const image = el('img');
    Object.assign(image, { src: product.image_url, alt: product.name, loading: 'lazy', width: 480, height: 320 });
    const content = el('div', '', 'product-content');
    const buy = el('div', '', 'product-buy');
    buy.append(el('strong', money(product.price_cents)), button('Add to cart', async () => {
      await change('/api/cart/items', 'POST', { product_id: product.id, quantity: 1 });
      announce(`${product.name} added to your cart.`);
    }, 'add-to-cart'));
    content.append(el('h3', product.name), el('p', product.description, 'muted'), buy);
    card.append(image, content);
    list.append(card);
  }
}

try {
  renderProducts(await api('/api/products'));
  cart = await api('/api/cart');
  renderCart();
  setInterval(() => void refresh().catch(() => {}), 3000);
  window.addEventListener('focus', () => void refresh().catch(() => {}));
} catch (error) {
  announce(error.message, true);
}
