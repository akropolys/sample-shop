import { api, el, button, announce, money, date } from './shared.js';
import { initKiku, syncKikuIdentity, reportKikuError } from './kiku.js';

let products = [];
let user = null;
let stripeReady = false;
let register = false;
let checkingOut = false;
let cart = { items: [], count: 0, total_cents: 0 };
let cartBusy = false;
let cartVersion = 0;

function updateCart() {
  const list = document.querySelector('#cart-items');
  list.replaceChildren();
  if (!cart.items.length) list.append(el('p', 'Your cart is empty.', 'muted'));
  for (const item of cart.items) {
    const row = el('div', '', 'cart-item');
    row.append(el('strong', item.name), el('span', `${money(item.price_cents)} each · ${money(item.line_total_cents)}`, 'muted small'));
    const controls = el('div', '', 'actions');
    const quantity = el('input');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = '99';
    quantity.value = item.quantity;
    quantity.disabled = cartBusy;
    quantity.setAttribute('aria-label', `Quantity for ${item.name}`);
    quantity.addEventListener('change', async () => {
      const value = Number(quantity.value);
      if (!Number.isInteger(value) || value < 1 || value > 99) { updateCart(); return; }
      try { await changeCart(`/api/cart/items/${item.product_id}`, 'PATCH', { quantity: value }); }
      catch (error) { announce(error.message, true); }
    });
    const remove = button('Remove', async () => {
      try { await changeCart(`/api/cart/items/${item.product_id}`, 'DELETE'); }
      catch (error) { announce(error.message, true); }
    }, 'small');
    remove.disabled = cartBusy;
    controls.append(quantity, remove);
    row.append(controls);
    list.append(row);
  }
  document.querySelector('#cart-total').textContent = money(cart.total_cents);
  document.querySelector('#cart-count').textContent = `(${cart.count})`;
  document.querySelector('#checkout').disabled = !cart.items.length || !stripeReady || checkingOut || cartBusy;
  document.querySelector('#checkout-identity').textContent = user ? `Checking out as ${user.name} · user #${user.id}` : 'Checking out as guest';
  for (const add of document.querySelectorAll('.add-to-cart')) add.disabled = cartBusy;
}

async function refreshCart() {
  if (cartBusy || document.activeElement?.closest('#cart-items input')) return;
  const version = cartVersion;
  const latest = await api('/api/cart');
  if (version !== cartVersion) return;
  if (JSON.stringify(latest) === JSON.stringify(cart)) return;
  cart = latest;
  updateCart();
}

async function changeCart(path, method, body) {
  cartBusy = true;
  cartVersion++;
  updateCart();
  try { cart = await api(path, { method, body }); }
  finally { cartBusy = false; updateCart(); }
}

function renderProducts() {
  const list = document.querySelector('#products');
  list.replaceChildren();
  if (!products.length) list.append(el('p', 'No products yet. Add one in the CMS.', 'muted'));
  for (const product of products) {
    const card = el('article', '', 'product');
    card.id = `product-${product.id}`;
    const image = el('img');
    image.src = product.image_url;
    image.alt = product.name;
    image.loading = 'lazy';
    image.width = 480;
    image.height = 320;
    const content = el('div', '', 'product-content');
    content.append(el('h3', product.name), el('p', product.description, 'muted'));
    const actions = el('div', '', 'product-buy');
    const add = button('Add to cart', async () => {
      if (cartBusy) return;
      try {
        await changeCart('/api/cart/items', 'POST', { product_id: product.id, quantity: 1 });
        announce(`${product.name} added to your cart.`);
      } catch (error) { announce(error.message, true); }
    }, 'add-to-cart');
    actions.append(el('strong', money(product.price_cents)), add);
    content.append(actions);
    const details = el('details');
    details.append(el('summary', 'Product comments'));
    const comments = el('div');
    details.append(comments);
    details.addEventListener('toggle', () => { if (details.open) loadComments(product.id, comments); });
    content.append(details);
    card.append(image, content);
    list.append(card);
  }
}

async function loadComments(productId, container) {
  container.replaceChildren(el('p', 'Loading…', 'muted small'));
  try {
    const comments = await api(`/api/products/${productId}/comments`);
    container.replaceChildren();
    if (!comments.length) container.append(el('p', 'No comments yet.', 'muted small'));
    for (const comment of comments) {
      const row = el('div', '', 'comment');
      row.append(el('strong', `${comment.name} · user #${comment.user_id}`, 'small'), el('p', comment.body), el('span', date(comment.created_at), 'muted small'));
      if (user && (comment.user_id === user.id || user.role === 'admin')) {
        row.append(button('Delete', async () => {
          try { await api(`/api/comments/${comment.id}`, { method: 'DELETE' }); await loadComments(productId, container); }
          catch (error) { announce(error.message, true); }
        }, 'small'));
      }
      container.append(row);
    }
    if (!user) { container.append(el('p', 'Sign in below to leave a comment.', 'muted small')); return; }
    const form = el('form', '', 'form');
    const label = el('label', 'Your comment');
    const input = el('textarea');
    input.required = true;
    input.maxLength = 1000;
    input.rows = 2;
    label.append(input);
    const submit = el('button', 'Post comment');
    submit.type = 'submit';
    form.append(label, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try { await api(`/api/products/${productId}/comments`, { method: 'POST', body: { body: input.value } }); await loadComments(productId, container); }
      catch (error) { announce(error.message, true); submit.disabled = false; }
    });
    container.append(form);
  } catch (error) { container.replaceChildren(el('p', error.message, 'small')); }
}

async function renderAccount() {
  document.querySelector('#identity').textContent = user ? `${user.name} · user #${user.id} · ${user.email}` : 'You are browsing as a guest.';
  document.querySelector('#auth-area').hidden = Boolean(user);
  document.querySelector('#logout').hidden = !user;
  document.querySelector('#my-orders').hidden = !user;
  renderProducts();
  await refreshCart();
  void syncKikuIdentity().catch(reportKikuError);
  if (!user) return;
  const list = document.querySelector('#order-list');
  list.replaceChildren(el('p', 'Loading…', 'muted'));
  try {
    const orders = await api('/api/orders');
    list.replaceChildren();
    if (!orders.length) list.append(el('p', 'No orders yet.', 'muted'));
    for (const order of orders) {
      const row = el('div', '', 'order');
      row.append(el('strong', `${money(order.total_cents)} · ${order.status}`), el('p', order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')), el('span', `${order.id} · ${date(order.created_at)}`, 'muted small'));
      list.append(row);
    }
  } catch (error) { list.replaceChildren(el('p', error.message)); }
}

function setAuthMode(value) {
  register = value;
  document.querySelector('#name-field').hidden = !value;
  document.querySelector('[name="name"]').required = value;
  const password = document.querySelector('[name="password"]');
  password.minLength = value ? 8 : 1;
  password.autocomplete = value ? 'new-password' : 'current-password';
  document.querySelector('#auth-submit').textContent = value ? 'Create account' : 'Sign in';
  document.querySelector('#show-login').setAttribute('aria-pressed', String(!value));
  document.querySelector('#show-register').setAttribute('aria-pressed', String(value));
}

document.querySelector('#show-login').addEventListener('click', () => setAuthMode(false));
document.querySelector('#show-register').addEventListener('click', () => setAuthMode(true));
document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.querySelector('#auth-submit');
  submit.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(event.target));
    ({ user } = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body }));
    event.target.reset();
    await renderAccount();
    announce(`Signed in as ${user.name} · user #${user.id}.`);
  } catch (error) { announce(error.message, true); }
  finally { submit.disabled = false; }
});

document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    user = null;
    await renderAccount();
    announce('Signed out. You are now browsing as a guest.');
  } catch (error) { announce(error.message, true); }
});

document.querySelector('#checkout').addEventListener('click', async () => {
  checkingOut = true;
  updateCart();
  try {
    const result = await api('/api/checkout', { method: 'POST' });
    window.location.assign(result.url);
  } catch (error) { announce(error.message, true); checkingOut = false; updateCart(); }
});

async function checkPayment() {
  const params = new URLSearchParams(location.search);
  if (params.get('checkout') === 'cancelled') announce('Checkout cancelled. Your cart is still here.');
  const sessionId = params.get('session_id');
  if (!sessionId) return;
  announce('Checking your payment with Stripe…');
  try {
    const result = await api(`/api/checkout/${encodeURIComponent(sessionId)}`);
    if (result.status === 'paid') {
      await refreshCart();
      await renderAccount();
      announce(`Payment received. Thank you! Order ${result.order_id}.`);
      history.replaceState({}, '', '/');
    } else announce('Payment is not confirmed yet. Refresh this page to check again.');
  } catch (error) { announce(error.message, true); }
}

try {
  const [productData, account, config] = await Promise.all([api('/api/products'), api('/api/me'), api('/api/config')]);
  products = productData;
  user = account.user;
  stripeReady = config.stripe_configured;
  initKiku(config.akropolys);
  document.querySelector('#stripe-note').textContent = stripeReady
    ? config.stripe_mode === 'live' ? 'Payments are live. You’ll finish payment on Stripe.' : 'Test payments. You’ll finish payment on Stripe.'
    : 'Checkout is waiting for a Stripe key. You can still try the cart and accounts.';
  await renderAccount();
  await checkPayment();
  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshCart().catch((error) => console.error('Cart refresh:', error.message));
  }, 3000);
  window.addEventListener('focus', () => { void refreshCart().catch((error) => console.error('Cart refresh:', error.message)); });
} catch (error) { announce(error.message, true); document.querySelector('#products').textContent = 'Could not load products. Refresh to try again.'; }
