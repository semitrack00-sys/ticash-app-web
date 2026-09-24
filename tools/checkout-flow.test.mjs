import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Recharge, assertTestService } from '../js/recharge.js';
import { checkoutMode, validateCheckoutSession, loadCheckoutFactory, mountCheckoutFlow } from '../js/checkout-flow.js';
import { mountRecharge } from '../js/recharge-page.js';
import { ApiError } from '../js/api-client.js';
import { fixtureApi, status, quote, transaction, products } from './fixtures.mjs';

const session = () => ({
  provider: 'STRIPE',
  environment: 'SANDBOX',
  testMode: true,
  transactionId: transaction.id,
  paymentSession: { id: 'pi_fixture', client_secret: 'pi_fixture_secret_fixture' },
  publicKey: 'pk_test_fixture',
  amountMinor: 800,
  currency: 'USD',
  paymentStatus: 'SESSION_CREATED',
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const pending = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function stripeApi({ country = 'US' } = {}) {
  const api = fixtureApi();
  const profile = {
    id: 'test-user',
    firstName: 'Test',
    lastName: 'Customer',
    phoneNumber: '+12025550123',
    countryCode: country,
    addressLine1: '123 Test Street',
    addressLine2: 'Unit 4',
    city: 'Miami',
    region: 'FL',
    postalCode: '33101',
  };

  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ method: 'CARD', provider: 'STRIPE', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { ...profile } }));
  api.overrides.set('PATCH /users/me', (_path, { body }) => {
    Object.assign(profile, body);
    return { user: { ...profile } };
  });
  api.overrides.set('POST /mobile-topups/payment-sessions', () => session());
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, paymentStatus: 'SESSION_CREATED' } }));
  api.profile = profile;
  return api;
}

async function review(model) {
  await model.selectCountry('JM');
  model.setPhone(quote.recipientPhone);
  await model.selectOperator(77);
  model.selectProduct(products[0].id);
  await model.getQuote();
  model.review(true);
}

async function setup(api = stripeApi(), guest = false) {
  let keys = 0;
  const model = new Recharge(api, { crypto: { randomUUID() { keys++; return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; } } });
  model.setAccount({ id: 'test-user' }, guest);
  await model.start();
  await review(model);
  return { model, api, keys: () => keys };
}

const posts = (api) => api.calls.filter((call) => call.method === 'POST');
const sessions = (api) => posts(api).filter((call) => call.path.endsWith('/payment-sessions'));

test('test safety gates accept only MOCK or STRIPE sandbox mode', () => {
  for (const paymentMode of ['MOCK', checkoutMode]) {
    assert.doesNotThrow(() => assertTestService({ ...status, paymentMode }));
  }
  for (const patch of [
    { paymentMode: 'LIVE' },
    { paymentMode: null },
    { environment: 'PRODUCTION' },
    { testMode: false },
    { productionEnabled: true },
    { approvedForLiveUse: true },
    { liveRechargeEnabled: true },
  ]) {
    assert.throws(() => assertTestService({ ...status, paymentMode: checkoutMode, ...patch }));
  }
});

test('MOCK confirmation still uses transactions endpoint only', async () => {
  const { model, api } = await setup(fixtureApi());
  await model.confirm();
  assert.equal(sessions(api).length, 0);
  assert.equal(posts(api).at(-1).path, '/mobile-topups/transactions');
  assert.deepEqual(posts(api).at(-1).body, { quoteId: quote.id });
});

test('Stripe session request is idempotent and never posts direct transactions', async () => {
  const { model, api, keys } = await setup();
  await model.confirm();
  const attempt = model.state.attempt;
  assert.equal(sessions(api).length, 1);
  assert.deepEqual(sessions(api)[0].body, { quoteId: quote.id });
  assert.equal(sessions(api)[0].headers['Idempotency-Key'], attempt.key);
  await model.confirm();
  await model.confirm();
  assert.equal(sessions(api).length, 1);
  assert.equal(keys(), 1);
  assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
});

test('billing country must be server profile data, not inferred from destination', async () => {
  const { model, api } = await setup(stripeApi({ country: null }));
  await model.confirm();
  assert.equal(sessions(api).length, 0);
  await model.saveAccountCountry('ca');
  assert.equal(model.state.accountCountry, 'CA');
  await model.confirm();
  assert.equal(sessions(api).length, 1);
});

test('malformed Stripe payment session cannot unlock reserved attempt', async () => {
  const { model, api } = await setup();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => ({ ...session(), paymentSession: { id: 'pay_bad', client_secret: 'bad' } }));
  await model.confirm();
  assert.equal(model.state.checkoutSession, null);
  assert.ok(model.state.attempt);
  assert.match(model.state.error, /verify/i);
});

test('only terminal server payment states release Stripe lock', async () => {
  const { model, api } = await setup();
  await model.confirm();
  const locked = model.state.attempt;

  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus: 'SESSION_CREATED' }] }));
  await model.loadHistory();
  assert.equal(model.state.attempt, locked);

  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, paymentStatus: 'CAPTURED' } }));
  await model.refreshTransaction();
  assert.equal(model.state.attempt, null);
  assert.equal(model.state.checkoutSession, null);
  assert.equal(model.state.transaction.paymentStatus, 'CAPTURED');
});

test('session replay/in-progress errors keep same key and allow recovery polling', async () => {
  const { model, api, keys } = await setup();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => { throw new ApiError('PAYMENT_SESSION_IN_PROGRESS', 'Unresolved'); });
  await model.confirm();
  const attempt = model.state.attempt;
  await model.confirm();
  assert.equal(keys(), 1);
  assert.equal(sessions(api).length, 1);

  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus: 'SESSION_CREATED' }] }));
  await model.loadHistory();
  assert.equal(model.state.attempt, attempt);
});

async function page(callback, { api = stripeApi(), checkoutFactory } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const root = document.querySelector('#root');
  const app = mountRecharge(root, { mobileRechargeLive: false }, {
    api,
    checkoutFactory: checkoutFactory || (() => { throw new Error('Unexpected Flow mount'); }),
  });
  const query = (selector) => root.querySelector(selector);
  const submit = (selector) => query(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const login = async () => {
    query('#email').value = 'test@example.test';
    query('#password').value = 'password-fixture';
    submit('#login-form');
    await tick();
  };
  try { await callback({ app, api, root, query, dom, login }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; }
}

test('hosted Stripe flow mounts once and callback only refreshes bound transaction', async () => {
  const payload = session();
  const api = stripeApi();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => payload);

  let sdkPublicKey;
  let embedded;
  let mounts = 0;

  await page(async ({ app, query, login }) => {
    await login();
    await review(app.model);
    query('#confirm-recharge').click();
    await tick();

    assert.equal(sdkPublicKey, payload.publicKey);
    assert.equal(embedded.clientSecret, payload.paymentSession.client_secret);
    assert.equal(mounts, 1);

    const before = posts(api).length;
    await embedded.onComplete();
    assert.equal(posts(api).length, before);
    assert.equal(api.calls.at(-1).path, `/mobile-topups/transactions/${transaction.id}?refresh=true`);
  }, {
    api,
    checkoutFactory: async (publicKey) => {
      sdkPublicKey = publicKey;
      return {
        async initEmbeddedCheckout(options) {
          embedded = options;
          return { mount() { mounts++; }, unmount() {} };
        },
      };
    },
  });
});

test('official loader uses one Stripe script and validates session before mount', async () => {
  const dom = new JSDOM('', { url: 'https://website.example' });
  try {
    const first = loadCheckoutFactory(dom.window);
    assert.equal(loadCheckoutFactory(dom.window), first);
    const script = dom.window.document.querySelector('script');
    assert.equal(script.src, 'https://js.stripe.com/v3/');
    dom.window.Stripe = () => ({ initEmbeddedCheckout: async () => ({ mount() {} }) });
    script.dispatchEvent(new dom.window.Event('load'));
    await first;
    await assert.rejects(mountCheckoutFlow({ session: { ...session(), environment: 'PRODUCTION' }, factory: () => assert.fail('unsafe factory call') }));
    assert.throws(() => validateCheckoutSession(null));
  } finally {
    dom.window.close();
  }
});

test('CSP allows Stripe script/frames and still blocks inline/eval scripts', () => {
  for (const path of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /script-src 'self' https:\/\/js\.stripe\.com;/);
    assert.match(html, /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com;/);
    assert.doesNotMatch(html, /script-src[^;]*(unsafe-inline|unsafe-eval)/);
  }
});
