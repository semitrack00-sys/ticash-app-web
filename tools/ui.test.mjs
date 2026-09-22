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
  assert.equal(root.querySelectorAll('input[type=password]').length, 2);
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
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [{ code: 'JM', name: attack, callingCode: '+1' }] }));
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

test('sign-in and registration have accessible keyboard buttons that show/hide passwords', async () => page(async ({ query, input }) => {
  for (const [field, toggle, label] of [['#password', '#password-visibility', 'password'], ['#register-password', '#register-password-visibility', 'account password']]) {
    if (field.includes('register')) query('#choose-register').click();
    input(field, 'test-password'); assert.equal(query(field).type, 'password');
    assert.equal(query(toggle).type, 'button'); assert.equal(query(toggle).tabIndex, 0);
    assert.equal(query(toggle).getAttribute('aria-label'), `Show ${label}`);
    query(toggle).click(); assert.equal(query(field).type, 'text'); assert.equal(query(field).value, 'test-password');
    assert.equal(query(toggle).getAttribute('aria-pressed'), 'true');
    query(toggle).click(); assert.equal(query(field).type, 'password');
  }
  query('#choose-login').click(); assert.equal(query('#register-password').value, '');
}));

test('registration creates an account, automatically enters checkout and clears passwords', async () => {
  const api = fixtureApi(); let sent;
  api.register = async (data) => { sent = data; return { id: 'new-customer' }; };
  await page(async ({ dom, query, input, root }) => {
    query('#choose-register').click(); assert.equal(query('#register-form').hidden, false);
    input('#first-name', 'Ti'); input('#last-name', 'Cash'); input('#register-email', 'new@example.com'); input('#register-password', 'test-password');
    query('#register-password-visibility').click();
    query('#register-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(sent, { firstName: 'Ti', lastName: 'Cash', email: 'new@example.com', password: 'test-password' });
    assert.equal(query('#checkout').hidden, false); assert.equal(query('#register-password').value, ''); assert.equal(query('#register-password').type, 'password');
    assert.match(root.textContent, /Your TiCash account was created\./); assert.match(root.textContent, /Signed in · private test session/);
  }, { api });
});

test('guest enters protected checkout, sees temporary history notice and can choose a permanent account', async () => {
  const api = fixtureApi(); let guests = 0; let logouts = 0;
  api.guest = async () => { guests++; return { role: 'CUSTOMER' }; }; api.logout = async () => { logouts++; };
  await page(async ({ query, root }) => {
    query('#continue-guest').click(); query('#continue-guest').click(); await tick();
    assert.equal(guests, 1); assert.equal(query('#checkout').hidden, false);
    assert.match(root.textContent, /Guest · private test session/); assert.equal(query('#guest-note').hidden, false);
    assert.match(query('#guest-note').textContent, /Guest history is temporary/);
    assert.ok(api.calls.some((c) => c.path === '/mobile-topups/countries'));
    query('#guest-create-account').click(); await tick();
    assert.equal(logouts, 1); assert.equal(query('#checkout').hidden, true); assert.equal(query('#register-form').hidden, false);
  }, { api });
});

test('destination labels, search and phone hints show backend calling codes and replace previous prefixes', async () => page(async ({ login, query, input }) => {
  await login(); assert.ok([...query('#country').options].some((o) => o.textContent === 'Haiti (+509)'));
  input('#country-search', '509'); assert.equal(query('#country').options.length, 2); assert.equal(query('#country').options[1].value, 'HT');
  input('#country', 'HT', 'change'); await tick(); assert.equal(query('#phone').value, '+509'); assert.match(query('#phone-hint').textContent, /calling code: \+509/);
  input('#phone', '+50937050210'); input('#country-search', ''); input('#country', 'FR', 'change'); await tick();
  assert.equal(query('#phone').value, '+33'); assert.match(query('#phone-hint').textContent, /calling code: \+33/);
}));

test('quote displays a backend 3.50 fee and 8.50 total without deriving charges', async () => {
  const api = fixtureApi(); api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...quote, providerAmount: 5, feeUsd: 3.5, totalChargeUsd: 8.5 } }));
  await page(async ({ app, query, login }) => {
    await login(); await app.model.selectCountry('JM'); app.model.setPhone(quote.recipientPhone); await app.model.selectOperator(77);
    app.model.selectProduct(products[0].id); await app.model.getQuote();
    assert.match(query('#quote-details').textContent, /TiCash fee\$3\.50/); assert.match(query('#quote-details').textContent, /Quoted total\$8\.50/);
  }, { api });
});
