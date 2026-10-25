import { api, el, button, announce, money, date } from './shared.js';

let user;
const form = document.querySelector('#product-form');

function resetProductForm() {
  form.reset();
  form.elements.id.value = '';
  document.querySelector('#product-form-heading').textContent = 'Add product';
  document.querySelector('#cancel-edit').hidden = true;
}

function table(headers, rows) {
  const wrapper = el('div', '', 'table-scroll');
  const table = el('table');
  const head = el('thead');
  const titleRow = el('tr');
  for (const heading of headers) { const cell = el('th', heading); cell.scope = 'col'; titleRow.append(cell); }
  head.append(titleRow);
  const body = el('tbody');
  for (const values of rows) {
    const row = el('tr');
    for (const value of values) { const cell = el('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value))); row.append(cell); }
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

async function loadCms() {
  const [products, orders, comments, users, akropolys] = await Promise.all([
    api('/api/admin/products'), api('/api/admin/orders'), api('/api/admin/comments'), api('/api/admin/users'), api('/api/admin/akropolys')
  ]);
  const result = akropolys.last_result;
  document.querySelector('#akropolys-status').textContent = akropolys.site_id
    ? `${akropolys.site_id} · ${akropolys.signed ? 'Signed ingestion' : 'Unsigned ingestion'} · ${akropolys.last_error ? akropolys.last_error.message : result ? `${result.indexed || 0} indexed, ${result.updated || 0} updated, ${result.skipped || 0} unchanged, ${result.queued || 0} queued` : 'Open the shop to publish its catalogue.'}`
    : 'Not configured.';
  const productRows = products.map((product) => {
    const image = el('img', '', 'thumbnail');
    image.src = product.image_url;
    image.alt = product.name;
    const actions = el('div', '', 'actions');
    actions.append(button('Edit', () => {
      form.elements.id.value = product.id;
      form.elements.name.value = product.name;
      form.elements.price.value = (product.price_cents / 100).toFixed(2);
      form.elements.description.value = product.description;
      form.elements.image_url.value = product.image_url;
      form.elements.active.checked = Boolean(product.active);
      document.querySelector('#product-form-heading').textContent = `Edit ${product.name}`;
      document.querySelector('#cancel-edit').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.name.focus({ preventScroll: true });
    }));
    if (product.active) actions.append(button('Hide', async () => {
      try { await api(`/api/admin/products/${product.id}`, { method: 'DELETE' }); await loadCms(); announce('Product hidden from the shop.'); }
      catch (error) { announce(error.message, true); }
    }));
    return [image, product.name, money(product.price_cents), product.active ? 'Visible' : 'Hidden', actions];
  });
  document.querySelector('#admin-products').replaceChildren(productRows.length ? table(['Picture', 'Product', 'Price', 'Status', 'Actions'], productRows) : el('p', 'No products yet.'));

  const orderRows = orders.map((order) => [
    order.id,
    order.user_id ? `User #${order.user_id}` : 'Guest',
    order.customer_email || '—',
    order.items.map((item) => `${item.quantity} × ${item.name}`).join(', '),
    money(order.total_cents),
    order.status,
    date(order.created_at)
  ]);
  document.querySelector('#admin-orders').replaceChildren(orderRows.length ? table(['Order', 'User', 'Email', 'Items', 'Total', 'Status', 'Created'], orderRows) : el('p', 'No orders yet.', 'muted'));

  const commentRows = comments.map((comment) => [comment.product_name, `${comment.name} (#${comment.user_id})`, comment.body,
    button('Delete', async () => {
      try { await api(`/api/comments/${comment.id}`, { method: 'DELETE' }); await loadCms(); announce('Comment deleted.'); }
      catch (error) { announce(error.message, true); }
    })
  ]);
  document.querySelector('#admin-comments').replaceChildren(commentRows.length ? table(['Product', 'User', 'Comment', 'Action'], commentRows) : el('p', 'No user comments yet.', 'muted'));
  document.querySelector('#admin-users').replaceChildren(table(['User ID', 'Name', 'Email', 'Role'], users.map((account) => [account.id, account.name, account.email, account.role])));
}

async function showAccount(account) {
  user = account;
  const admin = user?.role === 'admin';
  document.querySelector('#admin-login').hidden = admin;
  document.querySelector('#cms').hidden = !admin;
  if (!admin) {
    if (user) announce('This account is a customer. Sign in with the admin account to manage the shop.', true);
    return;
  }
  document.querySelector('#admin-identity').textContent = `${user.name} · user #${user.id}`;
  await loadCms();
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.target.querySelector('button');
  submit.disabled = true;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
    event.target.reset();
    await showAccount(result.user);
    if (result.user.role === 'admin') announce(`Signed in as ${result.user.name} · user #${result.user.id}.`);
  } catch (error) { announce(error.message, true); }
  finally { submit.disabled = false; }
});

document.querySelector('#admin-logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); await showAccount(null); announce('Signed out.'); }
  catch (error) { announce(error.message, true); }
});

document.querySelector('#cancel-edit').addEventListener('click', resetProductForm);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = form.elements.id.value;
  const body = {
    name: form.elements.name.value,
    description: form.elements.description.value,
    price_cents: Math.round(Number(form.elements.price.value) * 100),
    image_url: form.elements.image_url.value,
    active: form.elements.active.checked
  };
  const submit = document.querySelector('#save-product');
  submit.disabled = true;
  try {
    await api(`/api/admin/products${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body });
    resetProductForm();
    await loadCms();
    announce('Product saved.');
  } catch (error) { announce(error.message, true); }
  finally { submit.disabled = false; }
});

try { await showAccount((await api('/api/me')).user); }
catch (error) { announce(error.message, true); }
