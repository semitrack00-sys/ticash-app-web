import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Recharge, customAmountProductId, internationalPhone, operatorLogoUrl, searchCountries, secureId, assertTestService } from '../js/recharge.js';
import { checkoutMode } from '../js/checkout-flow.js';
import { mountRecharge } from '../js/recharge-page.js';
import { ApiError } from '../js/api-client.js';
import { fixtureApi, countries, operator, products, quote, transaction, status } from './fixtures.mjs';

async function setup() {
  const api = fixtureApi(); const model = new Recharge(api);
  await model.start(); await model.selectCountry('JM'); model.setPhone('+1 (876) 555-1234');
  await model.selectOperator(77); model.selectProduct(products[0].id);
  return { api, model };
}
async function reviewed(model) { await model.getQuote(); model.review(true); }
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
async function flush(times = 6) { for (let index = 0; index < times; index += 1) await Promise.resolve(); }

function stripePaymentSession(transactionId = transaction.id) {
  return {
    provider: 'STRIPE',
    environment: 'SANDBOX',
    testMode: true,
    transactionId,
    paymentSession: {
      id: 'pi_fixture',
      client_secret: 'pi_fixture_secret_fixture',
    },
    publicKey: 'pk_test_fixture',
    amountMinor: 800,
    currency: 'USD',
    paymentStatus: 'SESSION_CREATED',
  };
}

async function setupStripeCheckout({ profileCountry = 'CA', paymentSessionHandler } = {}) {
  const api = fixtureApi();
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ type: 'CARD', provider: 'STRIPE', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { id: 'user-1', firstName: 'Test', lastName: 'User', countryCode: profileCountry } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', paymentSessionHandler || (() => stripePaymentSession()));
  const model = new Recharge(api);
  model.setAccount({ id: 'user-1' }, false);
  await model.start();
  await model.selectCountry('JM');
  model.setPhone('+1 (876) 555-1234');
  await model.selectOperator(77);
  model.selectProduct(products[0].id);
  return { api, model };
}

test('loads only provider countries and searches name/code without a fixed destination', async () => {
  const { model } = await setup();
  assert.deepEqual(model.state.countries, countries);
  assert.deepEqual(searchCountries(countries, 'cAn'), [countries[1]]);
  assert.deepEqual(searchCountries(countries, 'jm'), [countries[0]]);
  assert.deepEqual(searchCountries(countries, 'absent'), []);
});
test('normalizes international input and rejects local or malformed phone numbers', () => {
  assert.equal(internationalPhone('00 1 (876) 555-1234'), '+18765551234');
  for (const phone of ['8765551234', '+0 123456789', '+1<script>', '+12']) assert.throws(() => internationalPhone(phone));
});
test('test safety gates accept only MOCK and Stripe sandbox payment modes', () => {
  assert.doesNotThrow(() => assertTestService({ ...status, paymentMode: 'MOCK' }));
  assert.doesNotThrow(() => assertTestService({ ...status, paymentMode: checkoutMode }));
  for (const unsafe of ['LIVE', 'CARD', '', null]) {
    assert.throws(() => assertTestService({ ...status, paymentMode: unsafe }));
  }
});
for (const change of ['country', 'phone', 'operator', 'product', 'amount']) {
  test(`${change} change clears quote, review, transaction, and the required downstream selection`, async () => {
    const { model } = await setup(); await reviewed(model); model.state.transaction = transaction;
    if (change === 'country') await model.selectCountry('CA');
    if (change === 'phone') model.setPhone('+16135551234');
    if (change === 'operator') await model.selectOperator('');
    if (change === 'product') model.selectProduct(products[1].id);
    if (change === 'amount') model.setAmount('12');
    assert.equal(model.state.quote, null); assert.equal(model.state.reviewed, false); assert.equal(model.state.transaction, null);
    if (['country', 'phone', 'operator'].includes(change)) { assert.equal(model.state.operator, null); assert.deepEqual(model.state.products, []); assert.equal(model.state.product, null); }
    if (change === 'country') assert.equal(model.state.phone, '+1');
  });
}
test('detects an operator and loads its returned products', async () => {
  const { model } = await setup(); await model.detect();
  assert.equal(model.state.operator.id, 77); assert.deepEqual(model.state.products, products);
});
test('failed detection permits manual operator fallback', async () => {
  const { model, api } = await setup();
  api.overrides.set('GET /mobile-topups/operators/detect', () => { throw new ApiError('NOT_FOUND', 'Choose an operator manually.', 404); });
  await model.detect(); assert.match(model.state.error, /manually/);
  await model.selectOperator(77); assert.equal(model.state.products.length, 2);
});
test('fixed quote sends no client price, fee or total; review uses server totals', async () => {
  const { model, api } = await setup(); await model.getQuote();
  const call = api.calls.find((c) => c.path === '/mobile-topups/quotes');
  assert.deepEqual(call.body, { countryCode: 'JM', phone: '+18765551234', operatorId: 77, productId: products[0].id });
  assert.equal(model.state.quote.totalChargeUsd, 8); assert.equal(model.state.reviewed, false);
});
test('range quote sends a valid amount and rejects out-of-range or fractional-cent input', async () => {
  const { model, api } = await setup(); model.selectProduct(products[1].id);
  for (const amount of ['4.99', '20.01', 'NaN', '8.001', '']) {
    model.setAmount(amount); await model.getQuote(); assert.equal(model.state.quote, null);
  }
  model.setAmount('13.25'); await model.getQuote();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/quotes').at(-1).body.amount, 13.25);
});
test('range-capable operators expose a custom amount option while fixed operators keep their preset catalog', async () => {
  const { model } = await setup();
  model.selectProduct(products[1].id);
  assert.equal(model.state.product.id, products[1].id);
  model.selectProduct(customAmountProductId);
  assert.equal(model.state.product.id, products[1].id);
  assert.equal(model.state.amount, '');

  const fixedOnlyApi = fixtureApi();
  fixedOnlyApi.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator: structuredClone(operator), products: [structuredClone(products[0])] }));
  const fixedOnly = new Recharge(fixedOnlyApi);
  await fixedOnly.start(); await fixedOnly.selectCountry('JM'); fixedOnly.setPhone('+1 (876) 555-1234');
  await fixedOnly.selectOperator(77);
  assert.equal(fixedOnly.state.products.some((product) => product.amountType === 'RANGE'), false);
  fixedOnly.selectProduct(customAmountProductId);
  assert.equal(fixedOnly.state.product, null);
});
test('recharge branding uses FlupFlap and keeps TiCash-App as the parent platform', async () => {
  const api = fixtureApi();
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const root = document.getElementById('root');
  const app = mountRecharge(root, { mobileRechargeLive: false }, { api });
  try {
    const guestButton = document.getElementById('continue-guest');
    guestButton.click();
    await Promise.resolve();
    assert.match(root.textContent, /FlupFlap/);
    assert.match(root.querySelector('.flupflap-hero img').alt, /Mobile Recharge by TiCash-App/);
    assert.match(root.textContent, /TiCash-App/);
    const registerButton = document.getElementById('choose-register');
    registerButton.click();
    assert.match(root.textContent, /Create TiCash account/);
  } finally {
    app.dispose();
    dom.window.close();
    delete globalThis.document;
  }
});
test('cannot confirm without review or after quote expiry', async () => {
  const { model, api } = await setup(); await model.getQuote(); await model.confirm();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 0);
  model.review(true); model.now = () => Date.parse('2100-01-01'); await model.confirm();
  assert.match(model.state.error, /current quote/);
});
test('confirmation sends a secure key, only quoteId, and creates a test receipt', async () => {
  const { model, api } = await setup(); await reviewed(model); await model.confirm();
  const call = api.calls.find((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST');
  assert.deepEqual(call.body, { quoteId: quote.id }); assert.match(call.headers['Idempotency-Key'], /^[\da-f-]{36}$/);
  assert.equal(model.state.transaction.status, 'PROCESSING'); assert.equal(model.state.quote, null);
  await model.confirm(); assert.equal(api.calls.filter((c) => c.path === call.path && c.method === 'POST').length, 1);
});
test('simultaneous confirmations submit once and prevent selection edits', async () => {
  const { model, api } = await setup(); await reviewed(model); const pending = deferred();
  api.overrides.set('POST /mobile-topups/transactions', () => pending.promise);
  const first = model.confirm(); await Promise.resolve(); await model.confirm();
  assert.equal(model.state.submitting, true); assert.throws(() => model.setPhone('+16135551234'));
  pending.resolve({ transaction }); await first;
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 1);
});
test('unknown outcome retries identical payload/key and history can resolve it', async () => {
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => { throw new ApiError('NETWORK_ERROR', 'Connection lost.'); });
  await model.confirm(); await model.confirm();
  const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/mobile-topups/transactions');
  assert.deepEqual(calls[0], calls[1]); assert.throws(() => model.setAmount('9'));
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [transaction] }));
  await model.loadHistory(); assert.equal(model.state.attempt, null); assert.equal(model.state.transaction.id, transaction.id);
});
test('expired backend quote releases rejected attempt so a new quote can be requested', async () => {
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => { throw new ApiError('TOPUP_QUOTE_EXPIRED', 'Expired', 409); });
  await model.confirm(); assert.equal(model.state.attempt, null); assert.equal(model.state.quote, null);
  await reviewed(model); api.overrides.delete('POST /mobile-topups/transactions'); await model.confirm();
  const calls = api.calls.filter((c) => c.method === 'POST' && c.path === '/mobile-topups/transactions');
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});
test('transaction status refresh and repeat use exact contract; repeat requires new review', async () => {
  const { model, api } = await setup(); await reviewed(model); await model.confirm();
  await model.refreshTransaction(); assert.equal(model.state.transaction.status, 'DELIVERED');
  await model.repeat(transaction.id); assert.equal(model.state.quote.totalChargeUsd, 8.75); assert.equal(model.state.reviewed, false);
  assert.equal(api.calls.at(-1).path, `/mobile-topups/transactions/${transaction.id}/repeat`);
});
test('Stripe checkout reserves payment-session with idempotency and never posts browser fulfillment transaction directly', async () => {
  const { model, api } = await setupStripeCheckout();
  await reviewed(model);
  await model.confirm();

  const paymentCalls = api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST');
  assert.equal(paymentCalls.length, 1);
  assert.deepEqual(paymentCalls[0].body, { quoteId: quote.id });
  assert.match(paymentCalls[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/i);
  assert.equal(api.calls.filter((call) => call.path === '/mobile-topups/transactions' && call.method === 'POST').length, 0);
  assert.equal(model.state.attempt?.transactionId, transaction.id);
});
test('Stripe checkout uses billing country from account profile, not recharge destination', async () => {
  const blocked = await setupStripeCheckout({ profileCountry: '' });
  await reviewed(blocked.model);
  await blocked.model.confirm();
  assert.match(blocked.model.state.error, /billing country/i);
  assert.equal(blocked.api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST').length, 0);

  const allowed = await setupStripeCheckout({ profileCountry: 'CA' });
  await reviewed(allowed.model);
  await allowed.model.confirm();
  assert.equal(allowed.api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST').length, 1);
});
test('Stripe checkout accepts CARD payment methods from backend type contract and proceeds without unavailable message', async () => {
  const api = fixtureApi();
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({
    methods: [{
      type: 'CARD',
      enabled: true,
      provider: 'STRIPE',
      testMode: true,
      label: 'Test card - Stripe Sandbox',
    }],
  }));
  api.overrides.set('GET /users/me', () => ({ user: { id: 'user-1', firstName: 'Test', lastName: 'User', countryCode: 'CA' } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', () => stripePaymentSession());

  const model = new Recharge(api);
  model.setAccount({ id: 'user-1' }, false);
  await model.start();
  await model.selectCountry('JM');
  model.setPhone('+1 (876) 555-1234');
  await model.selectOperator(77);
  model.selectProduct(products[0].id);
  await reviewed(model);

  assert.equal(model.checkoutBlocked(), '');
  assert.doesNotMatch(model.state.paymentMethodsError, /Sandbox card payments are unavailable\./);

  await model.confirm();
  assert.equal(api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST').length, 1);
  assert.doesNotMatch(model.state.error, /Sandbox card payments are unavailable\./);
});
test('malformed Stripe payment session keeps checkout attempt locked to same idempotent reservation', async () => {
  const { model, api } = await setupStripeCheckout({ paymentSessionHandler: () => ({ provider: 'STRIPE', environment: 'SANDBOX' }) });
  await reviewed(model);
  await model.confirm();
  assert.match(model.state.error, /Stripe sandbox payment session/);
  assert.ok(model.state.attempt);
  assert.equal(model.state.checkoutSession, null);
  assert.throws(() => model.setAmount('9'));

  const calls = api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST');
  assert.equal(calls.length, 1);
});
test('only terminal server payment states release Stripe checkout lock', async () => {
  const { model, api } = await setupStripeCheckout();
  await reviewed(model);
  await model.confirm();
  assert.ok(model.state.attempt);
  const id = model.state.attempt.transactionId;
  let paymentStatus = 'AUTHORIZED';
  api.overrides.set(`GET /mobile-topups/transactions/${id}`, () => ({ transaction: { ...transaction, id, quoteId: quote.id, paymentStatus, testMode: true } }));

  await model.refreshTransaction(id);
  assert.ok(model.state.attempt);
  assert.equal(model.state.checkoutSession?.transactionId, id);

  paymentStatus = 'CAPTURED';
  await model.refreshTransaction(id);
  assert.equal(model.state.attempt, null);
  assert.equal(model.state.checkoutSession, null);
});
test('payment-session replay/in-progress recovery keeps the same locked idempotency key for Stripe checkout', async () => {
  const { model, api } = await setupStripeCheckout({
    paymentSessionHandler: () => {
      throw new ApiError('PAYMENT_SESSION_IN_PROGRESS', 'still in progress', 409);
    },
  });
  await reviewed(model);
  await model.confirm();

  const calls = api.calls.filter((call) => call.path === '/mobile-topups/payment-sessions' && call.method === 'POST');
  assert.equal(calls.length, 1);
  assert.equal(model.state.attempt.key, calls[0].headers['Idempotency-Key']);
  assert.ok(model.state.attempt);
  assert.match(model.state.error, /unresolved/i);
});
test('page-level Stripe flow mounts once and explicit pay button confirms payment with single in-flight request', async () => {
  const api = fixtureApi();
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ type: 'CARD', provider: 'STRIPE', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { id: 'user-1', firstName: 'Test', lastName: 'User', countryCode: 'CA' } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', () => stripePaymentSession());
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, id: transaction.id, quoteId: quote.id, testMode: true, paymentStatus: 'AUTHORIZED' } }));
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;

  let mountCalls = 0;
  let stripeConfirmCalls = 0;
  const release = deferred();
  const checkoutFactory = async () => ({
    elements() {
      return {
        create() {
          return {
            mount() { mountCalls += 1; },
            unmount() {},
          };
        },
        destroy() {},
      };
    },
    async confirmPayment() {
      stripeConfirmCalls += 1;
      await release.promise;
      return { error: null };
    },
  });

  const root = document.getElementById('root');
  const app = mountRecharge(root, { mobileRechargeLive: false }, { api, checkoutFactory });
  let refreshedTransactionId = null;
  const originalRefreshTransaction = app.model.refreshTransaction.bind(app.model);
  app.model.refreshTransaction = async (id) => {
    refreshedTransactionId = id;
    return originalRefreshTransaction(id);
  };
  try {
    document.getElementById('email').value = 'user@example.test';
    document.getElementById('password').value = 'correct horse battery staple';
    document.getElementById('login-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    await app.model.selectCountry('JM');
    app.model.setPhone('+1 (876) 555-1234');
    await app.model.selectOperator(77);
    app.model.selectProduct(products[0].id);
    await reviewed(app.model);
    await app.model.confirm();
    await flush();

    assert.equal(mountCalls, 1);
    const payButton = document.getElementById('confirm-sandbox-payment');
    for (let attempt = 0; attempt < 20 && (payButton.hidden || payButton.disabled); attempt += 1) {
      await flush(2);
    }
    assert.equal(payButton.hidden, false);
    assert.equal(payButton.disabled, false);
    payButton.click();
    payButton.click();
    await flush(2);
    assert.equal(stripeConfirmCalls, 1);
    assert.equal(payButton.disabled, true);
    release.resolve();
    await flush();
    for (let attempt = 0; attempt < 20 && api.calls.filter((call) => call.path.startsWith(`/mobile-topups/transactions/${transaction.id}`) && call.method === 'GET').length === 0; attempt += 1) {
      await flush(2);
    }
    assert.equal(payButton.disabled, true);
    assert.equal(api.calls.filter((call) => call.path === '/mobile-topups/transactions' && call.method === 'POST').length, 0);
    assert.equal(refreshedTransactionId, transaction.id);
  } finally {
    app.dispose();
    dom.window.close();
    delete globalThis.document;
  }
});
test('Stripe pay action surfaces safe error and still never performs browser fulfillment POST', async () => {
  const api = fixtureApi();
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ type: 'CARD', provider: 'STRIPE', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { id: 'user-1', firstName: 'Test', lastName: 'User', countryCode: 'CA' } }));
  api.overrides.set('POST /mobile-topups/payment-sessions', () => stripePaymentSession());
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const checkoutFactory = async () => ({
    elements() {
      return {
        create() { return { mount() {}, unmount() {} }; },
        destroy() {},
      };
    },
    async confirmPayment() { return { error: { message: 'card_declined' } }; },
  });

  const root = document.getElementById('root');
  const app = mountRecharge(root, { mobileRechargeLive: false }, { api, checkoutFactory });
  try {
    document.getElementById('email').value = 'user@example.test';
    document.getElementById('password').value = 'correct horse battery staple';
    document.getElementById('login-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    await app.model.selectCountry('JM');
    app.model.setPhone('+1 (876) 555-1234');
    await app.model.selectOperator(77);
    app.model.selectProduct(products[0].id);
    await reviewed(app.model);
    await app.model.confirm();
    await flush();

    document.getElementById('confirm-sandbox-payment').click();
    await flush();
    assert.match(document.getElementById('checkout-flow-panel').textContent, /Unable to confirm Stripe sandbox payment/);
    assert.equal(api.calls.filter((call) => call.path === '/mobile-topups/transactions' && call.method === 'POST').length, 0);
  } finally {
    app.dispose();
    dom.window.close();
    delete globalThis.document;
  }
});
test('saved recipients repopulate destination with current provider catalog', async () => {
  const { model } = await setup(); await model.useRecipient('saved');
  assert.equal(model.state.phone, quote.recipientPhone); assert.equal(model.state.operator.id, 77); assert.equal(model.state.quote, null);
});
test('stale detection, product, and quote responses cannot restore invalidated state', async () => {
  for (const [method, path, start, response] of [
    ['GET', '/mobile-topups/operators/detect', (m) => m.detect(), { operator }],
    ['GET', '/mobile-topups/operators/77/products', (m) => m.selectOperator(77), { operator, products }],
    ['POST', '/mobile-topups/quotes', (m) => m.getQuote(), { quote }],
  ]) {
    const { model, api } = await setup(); const pending = deferred(); api.overrides.set(`${method} ${path}`, () => pending.promise);
    const promise = start(model); model.setPhone('+16135551234'); pending.resolve(response); await promise;
    assert.equal(model.state.operator, null); assert.deepEqual(model.state.products, []); assert.equal(model.state.quote, null);
  }
});
test('logout reset ignores late catalog and receipt responses', async () => {
  const { model, api } = await setup(); const pending = deferred();
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => pending.promise);
  const promise = model.refreshTransaction(transaction.id); model.reset(); pending.resolve({ transaction }); await promise;
  assert.equal(model.state.transaction, null); assert.deepEqual(model.state.history, []);
});
test('a previous session confirmation cannot unlock a new session confirmation', async () => {
  const { model, api } = await setup(); await reviewed(model);
  const oldResponse = deferred(); const newResponse = deferred();
  api.overrides.set('POST /mobile-topups/transactions', () => oldResponse.promise);
  const oldConfirmation = model.confirm(); await Promise.resolve();
  model.reset(); await model.start(); await model.selectCountry('JM');
  model.setPhone(quote.recipientPhone); await model.selectOperator(77); model.selectProduct(products[0].id);
  await reviewed(model);
  api.overrides.set('POST /mobile-topups/transactions', () => newResponse.promise);
  const newConfirmation = model.confirm(); await Promise.resolve();
  oldResponse.resolve({ transaction }); await oldConfirmation;
  assert.equal(model.state.submitting, true); assert.equal(model.state.transaction, null);
  newResponse.resolve({ transaction }); await newConfirmation;
  assert.equal(model.state.submitting, false); assert.equal(model.state.transaction.id, transaction.id);
});
test('rejects country/operator/product/quote mismatch', async () => {
  const { model, api } = await setup();
  api.overrides.set('GET /mobile-topups/operators/detect', () => ({ operator: { ...operator, countryCode: 'CA' } }));
  await model.detect(); assert.equal(model.state.operator, null);
  api.overrides.set('GET /mobile-topups/operators/77/products', () => ({ operator, products: [{ ...products[0], operatorId: 88 }] }));
  await model.selectOperator(77); assert.deepEqual(model.state.products, []);
  api.overrides.delete('GET /mobile-topups/operators/77/products'); await model.selectOperator(77); model.selectProduct(products[0].id);
  api.overrides.set('POST /mobile-topups/quotes', () => ({ quote: { ...quote, recipientPhone: '+16135551234' } }));
  await model.getQuote(); assert.equal(model.state.quote, null);
});
test('backend unavailable and empty catalogs remain controlled states', async () => {
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/countries', () => { throw new ApiError('RELOADLY_UNAVAILABLE', 'Unavailable', 502); });
  const model = new Recharge(api); await model.start(); assert.equal(model.state.ready, false); assert.equal(model.state.error, 'Unavailable');
  api.overrides.set('GET /mobile-topups/countries', () => ({ countries: [] })); await model.start(); assert.equal(model.state.ready, true); assert.deepEqual(model.state.countries, []);
});
test('fails closed on all live/unknown safety flags, including immediately before purchase', async () => {
  for (const unsafe of [{ environment: 'PRODUCTION' }, { paymentMode: 'LIVE' }, { testMode: false }, { liveRechargeEnabled: true }, { productionEnabled: true }, { approvedForLiveUse: true }]) assert.throws(() => assertTestService({ ...status, ...unsafe }));
  assert.throws(() => assertTestService({})); assert.throws(() => assertTestService({ ...status, enabled: false }));
  const { model, api } = await setup(); await reviewed(model);
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, productionEnabled: true })); await model.confirm();
  assert.equal(api.calls.filter((c) => c.path === '/mobile-topups/transactions' && c.method === 'POST').length, 0);
});
test('UUID fallback uses secure randomness and fails closed without crypto', () => {
  assert.match(secureId({ getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => secureId({}));
});

test('country calling-code search, prefills and switches preserve ISO identity', async () => {
  const { model } = await setup();
  for (const term of ['509', '+509', 'HT', 'Haiti']) assert.deepEqual(searchCountries(countries, term), [countries[2]]);
  assert.deepEqual(searchCountries(countries, '+1'), countries.slice(0, 2));
  await model.selectCountry('HT'); assert.equal(model.state.phone, '+509');
  model.setPhone('+50937050210'); assert.equal(model.normalizedPhone(), '+50937050210');
  await model.selectCountry('FR'); assert.equal(model.state.phone, '+33'); assert.equal(model.state.operator, null);
  model.setPhone('+33612345678'); assert.equal(model.normalizedPhone(), '+33612345678');
  for (const phone of ['+50937050210', '+33+33612345678', '+33']) { model.setPhone(phone); assert.throws(() => model.normalizedPhone()); }
});

test('detection and quote receive exactly one prefix; malformed prefixes never reach backend', async () => {
  const { model, api } = await setup();
  model.setPhone('+1+18765551234'); await model.detect();
  assert.equal(api.calls.filter((c) => c.path.startsWith('/mobile-topups/operators/detect')).length, 0);
  model.setPhone('00 1 (876) 555-1234'); await model.detect();
  const detection = api.calls.find((c) => c.path.startsWith('/mobile-topups/operators/detect'));
  assert.equal(new URL(detection.path, 'https://test.invalid').searchParams.get('phone'), '+18765551234');
  model.selectProduct(products[0].id); await model.getQuote();
  assert.equal(api.calls.find((c) => c.path === '/mobile-topups/quotes').body.phone, '+18765551234');
});

test('accepts only safe HTTPS operator logo URLs', () => {
  const good = 'https://cdn.example.test/operator.png?size=36';
  assert.equal(operatorLogoUrl(good), good);

  for (const value of [
    undefined,
    null,
    '',
    'http://cdn.example.test/operator.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '//cdn.example.test/operator.png',
    'https:///operator.png',
    'https://user:secret@cdn.example.test/operator.png',
    'https://cdn.example.test/a b.png',
    'https://cdn.example.test/%zz',
  ]) {
    assert.equal(operatorLogoUrl(value), '', String(value));
  }
});
