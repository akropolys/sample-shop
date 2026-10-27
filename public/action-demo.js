import { api, el } from './shared.js';
const message = document.querySelector('#message');
const start = document.querySelector('#start');
const check = document.querySelector('#check');
const link = document.querySelector('#checkout-link');
let demoId = null, armed = false, checking = false;
async function refresh() {
  const { events } = await api('/api/demo/events');
  const body = document.querySelector('#events');
  body.replaceChildren(...events.map(event => {
    const row = el('tr');
    for (const value of [new Date(event.created_at).toLocaleTimeString(), event.phase, event.result, event.demo_id?.slice(0, 8) || '—']) row.append(el('td', value));
    return row;
  }));
}
async function returnCheck() {
  if (!demoId || checking) return;
  checking = true; check.disabled = true;
  try {
    const result = await api(`/api/demo/on-return?demo_id=${encodeURIComponent(demoId)}`);
    message.textContent = `Return check: ${result.status}. Charged: $0.`;
    await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { checking = false; check.disabled = false; }
}
start.addEventListener('click', async () => {
  start.disabled = true; link.hidden = true; check.hidden = true; armed = false; demoId = null;
  try {
    const before = await api('/api/demo/before');
    if (!before.ready) throw new Error('Demo is not ready.');
    const created = await api('/api/demo/checkout', { method: 'POST', body: {} });
    demoId = created.demo_id;
    link.href = created.checkout_url; link.hidden = false; check.hidden = false;
    await api('/api/demo/after', { method: 'POST', body: { demo_id: demoId } });
    message.textContent = 'Before passed. Demo created. After-success recorded. Open the free checkout to continue.';
    await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { start.disabled = false; }
});
link.addEventListener('click', () => { armed = true; });
window.addEventListener('focus', () => { if (armed) { armed = false; void returnCheck(); } });
check.addEventListener('click', () => { armed = false; void returnCheck(); });
document.querySelector('#refresh').addEventListener('click', () => refresh().catch(error => { message.textContent = error.message; }));
try {
  document.querySelector('#definitions').textContent = JSON.stringify(await api('/api/demo/actions'), null, 2);
  await refresh();
} catch (error) { message.textContent = error.message; }
