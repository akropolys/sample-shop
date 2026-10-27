import { api } from './shared.js';
const id = new URLSearchParams(location.search).get('demo_id');
const message = document.querySelector('#message');
const choices = document.querySelector('#choices');
function render(data) {
  message.textContent = data.status === 'pending' ? 'Choose an outcome to test the return check.' : `Demo ${data.status}. Nothing was charged.`;
  choices.hidden = data.status !== 'pending';
  document.querySelector('#return-note').hidden = data.status === 'pending';
}
async function finish(outcome) {
  for (const button of choices.querySelectorAll('button')) button.disabled = true;
  try { render(await api(`/api/demo/sessions/${encodeURIComponent(id)}/finish`, { method: 'POST', body: { outcome } })); }
  catch (error) { message.textContent = error.message; }
  finally { for (const button of choices.querySelectorAll('button')) button.disabled = false; }
}
document.querySelector('#complete').addEventListener('click', () => finish('completed'));
document.querySelector('#cancel').addEventListener('click', () => finish('cancelled'));
try { render(await api(`/api/demo/sessions/${encodeURIComponent(id)}`)); }
catch (error) { message.textContent = error.message; }
