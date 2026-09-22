import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { fixtureApi, operator, products, quote, transaction } from './fixtures.mjs';
const tick = () => new Promise((r) => setTimeout(r, 0));

async function page(callback, { api = fixtureApi(), config = { mobileRechargeLive: false } } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const root = document.getElementById('root'); const app = mountRecharge(root, config, { api });
  const query = (selector) => root.querySelector(selector);
  const input = (selector, value, type = 'input') => { const node = query(selector); node.value = value; node.dispatchEvent(new dom.window.Event(type, { bubbles: true })); };
  const login = async () => {
    input('#email', 'tester@example.com'); input('#password', 'test-password');
    query('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); await tick();
  };
  try { await callback({ dom, app, api, root, query, input, login }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; }
}

test('UI renders TEST MODE, legitimate sign-in and no card inputs', async () => page(async ({ query, root, login }) => {
  assert.match(root.textContent, /TEST MODE/); assert.equal(query('#checkout').hidden, true);
  assert.equal(root.querySelectorAll('input[type=password]').length, 1);
  assert.doesNotMatch(root.textContent, /CVV|card number/i);
  await login(); assert.equal(query('#checkout').hidden, false); assert.equal(query('#password').value, '');
}));
test('UI completes country search, manual selection, quote, review, confirm and receipt refresh', async () => page(async ({ query, input, login, root }) => {
  await login(); input('#country-search', 'jam'); assert.equal(query('#country').options.length, 2);
  input('#country', 'JM', 'change'); await tick(); input('#phone', '+18765551234');
  input('#operator', String(operator.id), 'change'); await tick(); input('#product', products[0].id, 'change');
  query('#get-quote').click(); await tick();
  assert.match(query('#quote-details').textContent, /8\.00/); assert.equal(query('#confirm-recharge').disabled, true);
  query('#reviewed').click(); assert.equal(query('#confirm-recharge').disabled, false);
  query('#confirm-recharge').click(); await tick();
  assert.equal(query('#receipt').hidden, false); assert.match(query('#receipt').textContent, /PROCESSING/);
  query('#refresh-status').click(); await tick(); assert.match(query('#receipt').textContent, /DELIVERED/);
  assert.equal(root.querySelectorAll('.history-item').length, 1);
}));
test('UI clears quote immediately when phone changes and displays range input', async () => page(async ({ app, query, input, login }) => {
  await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone);
  await app.model.selectOperator(77); app.model.selectProduct(products[1].id);
  assert.equal(query('#amount').parentElement.hidden, false);
  input('#amount', '12.5'); await app.model.getQuote(); assert.ok(app.model.state.quote);
  input('#phone', '+16135551234'); assert.equal(app.model.state.quote, null); assert.match(query('#quote-details').textContent, /will appear/);
}));
test('untrusted provider strings, errors and history never become HTML', async () => {
  const attack = '<img src=x onerror=alert(1)>';
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [{ code: 'JM', name: attack }] }));
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, productName: attack }] }));
  await page(async ({ login, app, root }) => {
    await login(); app.model.state.error = attack; app.model.emit();
    assert.equal(root.querySelectorAll('[onerror], img[src=x]').length, 0); assert.match(root.textContent, /<img src=x/);
  }, { api });
});
test('signout wipes quote, phone, receipt and history', async () => page(async ({ login, app, query }) => {
  await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone);
  app.model.state.transaction = transaction; app.model.emit(); query('#sign-out').click(); await tick();
  assert.equal(query('#checkout').hidden, true); assert.equal(app.model.state.phone, ''); assert.deepEqual(app.model.state.history, []);
  assert.equal(query('#receipt').textContent, '');
}));
test('blank API config and live config disable login without any network', async () => {
  for (const config of [{ mobileRechargeLive: false, apiBaseUrl: '' }, { mobileRechargeLive: true, apiBaseUrl: 'https://test.example/api' }]) {
    const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' }); globalThis.document = dom.window.document;
    const app = mountRecharge(document.getElementById('root'), config);
    try { assert.equal(document.querySelector('button[type=submit]').disabled, true); assert.equal(document.querySelector('#checkout').hidden, true); }
    finally { app.dispose(); dom.window.close(); delete globalThis.document; }
  }
});
