import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRecharge } from '../js/recharge-page.js';
import { billingCountries } from '../js/billing-countries.js';
import { billingFixture, billingQuote } from './billing-fixture.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function page(run, guest = true) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const api = billingFixture();
  const app = mountRecharge(document.getElementById('root'), { mobileRechargeLive: true }, {
    api, checkoutFactory: () => ({ elements: () => ({ create: () => ({ mount() {}, unmount() {} }), destroy() {} }) }),
  });
  const query = selector => document.querySelector(selector);
  const input = (selector, value) => { const element = query(selector); element.value = value; element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    if (guest) query('#continue-guest').click();
    else {
      input('#email', 'test@example.test'); input('#password', 'test-password');
      query('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    }
    await tick();
    await app.model.selectCountry('HT'); app.model.setPhone(billingQuote.recipientPhone);
    await app.model.selectOperator(77); app.model.selectProduct(billingQuote.productId); await app.model.getQuote();
    await run({ app, api, query, input, dom });
  } finally { app.dispose(); dom.window.close(); delete globalThis.document; }
}

test('billing catalogue contains unique ISO countries independent of recharge coverage', () => {
  assert.equal(billingCountries.length, 249); assert.equal(new Set(billingCountries.map(c => c.code)).size, 249);
  for (const country of billingCountries) { assert.match(country.code, /^[A-Z]{2}$/); assert.ok(country.name.length > 2); }
  for (const [code, name] of [['US','United States'],['CA','Canada'],['HT','Haiti'],['FR','France'],['DO','Dominican Republic'],['MX','Mexico'],['BR','Brazil'],['GB','United Kingdom']]) {
    assert.equal(billingCountries.find(c => c.code === code).name, name);
  }
});

for (const [code, search, name] of [['US', 'United', 'United States'], ['CA', 'Can', 'Canada']]) {
  test(`guest selects ${name}; request sends only ${code}, with separate HT destination`, async () => page(async ({ app, api, query, input }) => {
    assert.equal(query('#guest-billing-country').hidden, false);
    assert.equal(query('#billing-country').disabled, true);
    assert.equal(query('#billing-country-picker').textContent, 'Select billing country');
    query('#reviewed').click(); assert.equal(query('#confirm-recharge').disabled, true);
    query('#billing-country-picker').click(); input('#billing-country-search', search);
    assert.equal(app.model.state.billingCountry, '');
    assert.ok(query(`[data-billing-code=${code}]`).textContent.includes(name));
    query(`[data-billing-code=${code}]`).click(); await tick();
    assert.equal(app.model.state.billingCountry, code); assert.equal(app.model.state.country, 'HT');
    assert.equal(query('#billing-country-picker').textContent, name);
    assert.equal(query('#confirm-recharge').disabled, false);
    assert.match(query('#confirm-recharge').textContent, /54\.49/);
    await app.model.confirm();
    const requests = api.calls.filter(c => c.path === '/mobile-topups/payment-sessions');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body, { quoteId: billingQuote.id, billingCountry: code });
    assert.match(requests[0].body.billingCountry, /^[A-Z]{2}$/);
    assert.equal(api.calls.some(c => c.method === 'PATCH'), false);
    assert.equal(app.model.state.userProfile.countryCode, 'CA');
  }));
}

test('search typing, periodic renders, and autofill-like input never erase a selected billing country', async () => page(async ({ app, query, input }) => {
  query('#billing-country-picker').click(); query('[data-billing-code=US]').click();
  query('#billing-country-picker').click(); input('#billing-country-search', 'United');
  assert.equal(query('[data-billing-code=CA]'), null);
  assert.ok(query('[data-billing-code=GB]'));
  app.model.emit();
  assert.equal(query('#billing-country-search').value, 'United');
  assert.equal(query('#billing-country-menu').hidden, false);
  input('#billing-country-search', 'an autofilled street address');
  assert.equal(app.model.state.billingCountry, 'US');
  assert.equal(query('#billing-country-options').children.length, 0);
  assert.equal(query('#billing-country-search').getAttribute('autocomplete'), 'off');
  await app.model.selectCountry('HT'); assert.equal(app.model.state.billingCountry, 'US');
  query('#sign-out').click(); await tick(); assert.equal(app.model.state.billingCountry, '');
}));

test('billing selector keyboard selection and Escape restore focus; confirmation and CARD gates remain', async () => page(async ({ app, query, input, dom }) => {
  const key = value => query('#billing-country-search').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  query('#billing-country-picker').click(); input('#billing-country-search', 'United States');
  key('ArrowDown'); assert.equal(query('#billing-country-search').getAttribute('aria-activedescendant'), 'billing-option-US');
  key('Enter'); assert.equal(app.model.state.billingCountry, 'US');
  assert.equal(dom.window.document.activeElement.id, 'billing-country-picker');
  assert.equal(query('#confirm-recharge').disabled, true);
  query('#reviewed').click(); assert.equal(query('#confirm-recharge').disabled, false);
  app.model.state.paymentMethods[0].enabled = false; app.model.emit(); assert.equal(query('#confirm-recharge').disabled, true);
  query('#billing-country-picker').click(); key('Escape');
  assert.equal(query('#billing-country-menu').hidden, true); assert.equal(dom.window.document.activeElement.id, 'billing-country-picker');
}));

test('permanent customer retains stored billing country and does not use guest selector', async () => page(async ({ app, query, api }) => {
  assert.equal(query('#guest-billing-country').hidden, true);
  assert.equal(app.model.state.accountCountry, 'CA'); assert.equal(app.model.state.billingCountry, '');
  query('#reviewed').click(); assert.equal(query('#confirm-recharge').disabled, false);
  await app.model.confirm();
  assert.deepEqual(api.calls.find(c => c.path === '/mobile-topups/payment-sessions').body, { quoteId: billingQuote.id, billingCountry: 'CA' });
  assert.equal(api.calls.some(c => c.method === 'PATCH'), false);
}, false));
