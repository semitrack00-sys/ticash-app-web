import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { Recharge, assertTestService } from '../js/recharge.js';
import { checkoutMode, validateCheckoutSession, loadCheckoutFactory, mountCheckoutFlow } from '../js/checkout-flow.js';
import { mountRecharge } from '../js/recharge-page.js';
import { ApiError, createApiClient } from '../js/api-client.js';
import { fixtureApi, status, quote, transaction, products } from './fixtures.mjs';

const session = () => ({ provider: 'CHECKOUT_COM', environment: 'SANDBOX', testMode: true,
  transactionId: transaction.id, paymentSession: { id: 'ps_fixture', payment_session_token: 'fixture-session-token', extra: { preserved: true } },
  publicKey: 'pk_sbox_fixture', amountMinor: 800, currency: 'USD', paymentStatus: 'SESSION_CREATED' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (count = 6) => { for (let i = 0; i < count; i++) await tick(); };
const pending = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const fullProfile = (country = 'US') => ({
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
});
const profilePatch = (country = 'US') => {
  const { id: _id, ...profile } = fullProfile(country);
  return profile;
};
function checkoutApi({ country = 'US' } = {}) {
  const api = fixtureApi();
  const profile = fullProfile(country);
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ method: 'CARD', provider: 'CHECKOUT_COM', testMode: true, enabled: true }] }));
  api.overrides.set('GET /users/me', () => ({ user: { ...profile } }));
  api.overrides.set('PATCH /users/me', (_path, { body }) => {
    assert.deepEqual(body, { ...profilePatch(profile.countryCode), countryCode: body.countryCode });
    Object.assign(profile, body); return { user: { ...profile } };
  });
  api.overrides.set('POST /mobile-topups/payment-sessions', () => session());
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, paymentStatus: 'SESSION_CREATED' } }));
  api.profile = profile;
  return api;
}
async function review(model) {
  await model.selectCountry('JM'); model.setPhone(quote.recipientPhone);
  await model.selectOperator(77); model.selectProduct(products[0].id); await model.getQuote(); model.review(true);
}
async function setup(api = checkoutApi(), guest = false) {
  let keys = 0;
  const model = new Recharge(api, { crypto: { randomUUID() { keys++; return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; } } });
  model.setAccount({ id: 'test-user' }, guest); await model.start(); await review(model);
  return { model, api, keys: () => keys };
}
const posts = (api) => api.calls.filter((call) => call.method === 'POST');
const sessions = (api) => posts(api).filter((call) => call.path.endsWith('/payment-sessions'));

test('sandbox modes are accepted and every live/unknown gate stays fail-closed', () => {
  for (const paymentMode of ['MOCK', checkoutMode]) assert.doesNotThrow(() => assertTestService({ ...status, paymentMode }));
  for (const patch of [{ paymentMode: 'LIVE' }, { paymentMode: 'production' }, { paymentMode: 'OTHER' }, { paymentMode: null },
    { environment: 'PRODUCTION' }, { testMode: false }, { productionEnabled: true }, { approvedForLiveUse: true }, { liveRechargeEnabled: true }]) {
    assert.throws(() => assertTestService({ ...status, paymentMode: checkoutMode, ...patch }));
  }
});
test('MOCK still confirms through transactions with quoteId only', async () => {
  const { model, api } = await setup(fixtureApi()); await model.confirm();
  assert.equal(sessions(api).length, 0);
  assert.deepEqual(posts(api).at(-1).body, { quoteId: quote.id });
  assert.equal(posts(api).at(-1).path, '/mobile-topups/transactions');
});
test('Checkout sends exactly quoteId with the original secure attempt key and never posts transactions', async () => {
  const { model, api, keys } = await setup(); await model.confirm();
  const attempt = model.state.attempt;
  assert.deepEqual(sessions(api), [{ path: '/mobile-topups/payment-sessions', method: 'POST', body: { quoteId: quote.id }, headers: { 'Idempotency-Key': attempt.key } }]);
  await model.confirm(); await model.confirm();
  assert.equal(sessions(api).length, 1); assert.equal(keys(), 1);
  assert.ok(model.state.checkoutSession); assert.equal(model.state.transaction, null);
  assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
  assert.throws(() => model.setPhone('+16135551234'), /Resolve/);
});
test('concurrent Checkout confirmation holds one attempt and one request', async () => {
  const { model, api, keys } = await setup(); const wait = pending();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => wait.promise);
  const first = model.confirm(); await tick(); await model.confirm();
  assert.equal(sessions(api).length, 1); assert.equal(keys(), 1);
  wait.resolve(session()); await first; assert.ok(model.state.attempt);
});
test('missing billing country is not inferred from destination and PATCH preserves other profile fields', async () => {
  const { model, api } = await setup(checkoutApi({ country: null }));
  await model.confirm(); assert.equal(sessions(api).length, 0); assert.equal(model.state.accountCountry, '');
  await model.saveAccountCountry('ca');
  assert.deepEqual(api.calls.find((call) => call.method === 'PATCH').body, { ...profilePatch(null), countryCode: 'CA' });
  assert.equal(api.profile.firstName, 'Test'); assert.equal(api.profile.lastName, 'Customer');
  assert.equal(api.profile.phoneNumber, '+12025550123'); assert.equal(api.profile.addressLine1, '123 Test Street');
  assert.equal(api.profile.addressLine2, 'Unit 4'); assert.equal(api.profile.city, 'Miami');
  assert.equal(api.profile.region, 'FL'); assert.equal(api.profile.postalCode, '33101');
  assert.equal(model.state.accountCountry, 'CA');
  assert.equal(model.state.country, 'JM');
  await model.confirm(); assert.equal(sessions(api).length, 1);
});
test('a successful PATCH alone cannot establish billing country without reading the server profile', async () => {
  const { model, api } = await setup(checkoutApi({ country: null }));
  api.overrides.set('PATCH /users/me', () => ({ countryCode: 'US' }));
  await model.saveAccountCountry('US'); await model.confirm();
  assert.equal(model.state.accountCountry, ''); assert.equal(sessions(api).length, 0);
});
test('guest cannot read or PATCH billing profile or create Checkout payments', async () => {
  const { model, api } = await setup(checkoutApi(), true);
  await model.saveAccountCountry('US'); await model.confirm();
  assert.equal(sessions(api).length, 0); assert.equal(api.calls.filter((call) => call.path === '/users/me').length, 0);
  assert.match(model.state.error, /permanent account/);
});
test('disabled, wrong-provider or non-test CARD cannot create a session; disabled reason is preserved', async () => {
  for (const patch of [{ enabled: false, reason: 'Card temporarily unavailable' }, { provider: 'MOCK' }, { testMode: false }]) {
    const api = checkoutApi();
    api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [{ method: 'CARD', provider: 'CHECKOUT_COM', testMode: true, enabled: true, ...patch }] }));
    const { model } = await setup(api); await model.confirm();
    assert.equal(sessions(api).length, 0);
    if (patch.reason) assert.equal(model.state.error, patch.reason);
  }
});
test('failed payment-method or profile reads fail closed while MOCK remains usable', async () => {
  for (const route of ['/users/me', '/mobile-topups/payment-methods']) {
    const api = checkoutApi(); api.overrides.set(`GET ${route}`, () => { throw new ApiError('OFFLINE', 'Unavailable'); });
    const { model } = await setup(api); await model.confirm(); assert.equal(sessions(api).length, 0);
  }
  const api = fixtureApi(); api.overrides.set('GET /mobile-topups/payment-methods', () => { throw new Error('Unavailable'); });
  const { model } = await setup(api); await model.confirm(); assert.ok(model.state.transaction);
});
test('Checkout rechecks account, CARD eligibility, quote expiry and sandbox mode before submission', async () => {
  for (const change of [
    (api) => api.overrides.set('GET /mobile-topups/status', () => ({ ...status })),
    (api) => api.overrides.set('GET /mobile-topups/payment-methods', () => ({ methods: [] })),
    (api) => { api.profile.countryCode = null; },
    (_api, model) => { model.now = () => Date.parse('2100-01-01'); },
  ]) {
    const { model, api } = await setup(); change(api, model); await model.confirm();
    assert.equal(sessions(api).length, 0); assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
  }
});

const malformed = {
  provider: { provider: 'MOCK' }, environment: { environment: 'PRODUCTION' }, testMode: { testMode: false },
  transactionId: { transactionId: 'bad-id' }, missingSession: { paymentSession: null }, arraySession: { paymentSession: [] },
  missingToken: { paymentSession: { id: 'ps_fixture' } }, emptyToken: { paymentSession: { id: 'ps_fixture', payment_session_token: '  ' } },
  invalidSessionId: { paymentSession: { id: 'pay_fixture', payment_session_token: 'fixture' } },
  livePublicKey: { publicKey: 'pk_live_fixture' }, missingPublicKey: { publicKey: null },
  zeroAmount: { amountMinor: 0 }, fractionalAmount: { amountMinor: 1.5 }, unsafeAmount: { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
  currency: { currency: 'EUR' }, paymentStatus: { paymentStatus: 'CAPTURED' },
};
for (const [name, patch] of Object.entries(malformed)) test(`malformed Checkout response (${name}) cannot mount Flow or unlock a reserved attempt`, async () => {
  const { model, api } = await setup(); api.overrides.set('POST /mobile-topups/payment-sessions', () => ({ ...session(), ...patch }));
  await model.confirm(); assert.equal(model.state.checkoutSession, null); assert.ok(model.state.attempt);
  assert.match(model.state.error, /Unable to verify/); await model.confirm(); assert.equal(sessions(api).length, 1);
});
for (const paymentStatus of ['SESSION_CREATED', 'PENDING', 'AUTHORIZED', 'REFUND_REQUIRED', 'UNKNOWN']) test(`history cannot release a Checkout ${paymentStatus} payment`, async () => {
  const { model, api } = await setup(); await model.confirm(); const attempt = model.state.attempt;
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus }] }));
  await model.loadHistory(); assert.equal(model.state.attempt, attempt); assert.ok(model.state.checkoutSession);
  await model.confirm(); assert.equal(sessions(api).length, 1);
});
for (const paymentStatus of ['CAPTURED', 'FAILED', 'VOIDED', 'REFUNDED']) test(`only server-confirmed ${paymentStatus} releases the Checkout lock`, async () => {
  const { model, api } = await setup(); await model.confirm();
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, paymentStatus } }));
  await model.refreshTransaction(); assert.equal(model.state.attempt, null); assert.equal(model.state.checkoutSession, null);
  assert.equal(model.state.transaction.paymentStatus, paymentStatus);
});
test('a mismatched history transaction or quote cannot unlock Checkout', async () => {
  const { model, api } = await setup(); await model.confirm(); const attempt = model.state.attempt;
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, id: quote.id, paymentStatus: 'CAPTURED' }] }));
  await model.loadHistory(); assert.equal(model.state.transaction, null); assert.equal(model.state.attempt, attempt);
  api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, quoteId: 'other', paymentStatus: 'CAPTURED' } }));
  await model.refreshTransaction(); assert.equal(model.state.attempt, attempt); assert.match(model.state.error, /verify/);
});
for (const code of ['PAYMENT_SESSION_REPLAY_UNAVAILABLE', 'PAYMENT_SESSION_IN_PROGRESS', 'NETWORK_ERROR']) test(`${code} holds the key and permits status recovery without another purchase`, async () => {
  const { model, api, keys } = await setup();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => { throw new ApiError(code, 'Unresolved'); });
  await model.confirm(); const attempt = model.state.attempt;
  await model.confirm(); assert.equal(keys(), 1); assert.equal(sessions(api).length, 1);
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus: 'SESSION_CREATED' }] }));
  await model.loadHistory(); assert.equal(model.state.attempt, attempt); assert.equal(attempt.transactionId, transaction.id);
  await model.refreshTransaction(); assert.equal(model.state.attempt, attempt);
});
test('logout during preflight cannot submit a session and late session responses cannot repopulate state', async () => {
  for (const route of ['GET /mobile-topups/status', 'POST /mobile-topups/payment-sessions']) {
    const { model, api } = await setup(); const wait = pending(); api.overrides.set(route, () => wait.promise);
    const confirmation = model.confirm(); await tick(); model.reset();
    wait.resolve(route.startsWith('GET') ? { ...status, paymentMode: checkoutMode } : session()); await confirmation;
    assert.equal(model.state.checkoutSession, null); assert.equal(model.state.attempt, null);
    if (route.startsWith('GET')) assert.equal(sessions(api).length, 0);
  }
});
test('late session response cannot resurrect Flow after history confirms captured payment', async () => {
  const { model, api } = await setup(); const wait = pending();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => wait.promise);
  const confirmation = model.confirm(); await tick();
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus: 'CAPTURED' }] }));
  await model.loadHistory(); assert.equal(model.state.attempt, null);
  wait.resolve(session()); await confirmation;
  assert.equal(model.state.checkoutSession, null); assert.equal(model.state.transaction.paymentStatus, 'CAPTURED');
});
test('session response must agree with the transaction already found in history', async () => {
  const { model, api } = await setup(); const wait = pending();
  api.overrides.set('POST /mobile-topups/payment-sessions', () => wait.promise);
  const confirmation = model.confirm(); await tick();
  api.overrides.set('GET /mobile-topups/transactions', () => ({ transactions: [{ ...transaction, paymentStatus: 'SESSION_CREATED' }] }));
  await model.loadHistory(); wait.resolve({ ...session(), transactionId: quote.id }); await confirmation;
  assert.equal(model.state.checkoutSession, null); assert.equal(model.state.attempt.transactionId, transaction.id);
  assert.match(model.state.error, /Unable to verify/);
});
test('MOCK confirmation never silently switches to Checkout if backend mode changes', async () => {
  const { model, api } = await setup(fixtureApi());
  api.overrides.set('GET /mobile-topups/status', () => ({ ...status, paymentMode: checkoutMode }));
  await model.confirm(); assert.deepEqual(posts(api).map((call) => call.path), ['/mobile-topups/quotes']);
  assert.match(model.state.error, /Payment mode changed/);
});

async function page(callback, { api = checkoutApi(), checkoutFactory } = {}) {
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://website.example/recharge' });
  globalThis.document = dom.window.document;
  const root = document.querySelector('#root');
  const app = mountRecharge(root, { mobileRechargeLive: false }, { api, checkoutFactory: checkoutFactory || (() => { throw new Error('Unexpected Flow mount'); }) });
  const query = (selector) => root.querySelector(selector);
  const submit = (selector) => query(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const login = async () => { query('#email').value = 'test@example.test'; query('#password').value = 'password-fixture'; submit('#login-form'); await tick(); };
  try { await callback({ app, api, root, query, dom, submit, login }); }
  finally { app.dispose(); dom.window.close(); delete globalThis.document; }
}
test('Flow mounts once, receives the unmodified session and sandbox key; callbacks only read the bound TiCash transaction', async () => {
  const payload = session(); const api = checkoutApi(); api.overrides.set('POST /mobile-topups/payment-sessions', () => payload);
  let options; let mounted; let creates = 0; let unmounts = 0;
  await page(async ({ app, root, query, login }) => {
    await login(); await review(app.model); query('#confirm-recharge').click(); await tick();
    assert.equal(options.paymentSession, payload.paymentSession); assert.equal(options.environment, 'sandbox');
    assert.equal(options.publicKey, payload.publicKey); assert.equal(mounted, query('#checkout-flow-container'));
    assert.equal(creates, 1); assert.equal(query('#confirm-recharge').disabled, true);
    assert.equal(query('#selection-fields fieldset').disabled, true);
    assert.equal(root.querySelectorAll('input[autocomplete^="cc-"]').length, 0);
    assert.doesNotMatch(root.textContent, /CVV|card number|fixture-session-token|pk_sbox_fixture/i);
    const before = posts(api).length;
    await options.onPaymentCompleted(null, { id: 'attacker-payment-id', status: 'CAPTURED' });
    assert.equal(posts(api).length, before); assert.equal(api.calls.at(-1).path, `/mobile-topups/transactions/${transaction.id}?refresh=true`);
    assert.match(query('#receipt').textContent, /SESSION_CREATED/); assert.ok(app.model.state.attempt);
    await app.model.loadHistory(); app.model.emit(); assert.equal(creates, 1);
    api.overrides.set(`GET /mobile-topups/transactions/${transaction.id}`, () => ({ transaction: { ...transaction, paymentStatus: 'CAPTURED' } }));
    query('#checkout-refresh-status').click(); await tick(); assert.equal(app.model.state.attempt, null);
    assert.equal(unmounts, 1); assert.match(query('#receipt').textContent, /CAPTURED/);
  }, { api, checkoutFactory: async (config) => { options = config; return { create(type) { assert.equal(type, 'flow'); creates++; return { mount(node) { mounted = node; }, unmount() { unmounts++; } }; } }; } });
});
test('billing country UI is explicit, blank despite destination, and saved before payment', async () => {
  await page(async ({ app, query, login }) => {
    await login(); await review(app.model);
    assert.equal(query('#billing-country-step').hidden, false); assert.equal(query('#billing-country').value, '');
    assert.equal(query('#confirm-recharge').disabled, true);
    query('#billing-country').value = 'ca'; query('#save-account-country').click(); await tick();
    assert.equal(app.model.state.accountCountry, 'CA'); assert.equal(query('#confirm-recharge').disabled, false);
  }, { api: checkoutApi({ country: null }) });
});
test('guest UI disables Checkout and hides billing profile without loading hosted script', async () => {
  await page(async ({ app, query, dom }) => {
    query('#continue-guest').click(); await tick(); await review(app.model);
    assert.equal(query('#billing-country-step').hidden, true); assert.equal(query('#confirm-recharge').disabled, true);
    assert.match(query('#payment-availability').textContent, /permanent account/);
    assert.equal(dom.window.document.querySelectorAll('script').length, 0);
  });
});
test('Flow failure is sanitized and does not unlock the session or offer MOCK fallback', async () => {
  await page(async ({ app, query, root, login, api }) => {
    await login(); await review(app.model); await app.model.confirm(); await tick();
    assert.match(root.textContent, /payment form unavailable/); assert.doesNotMatch(root.textContent, /private-sdk-detail/);
    assert.ok(app.model.state.attempt); query('#confirm-recharge').click(); assert.equal(sessions(api).length, 1);
    assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
  }, { checkoutFactory: () => { throw new Error('private-sdk-detail'); } });
});
test('failed SDK load can retry same session without another payment-session request or key', async () => {
  const payload = session(); const api = checkoutApi();
  let loads = 0; const paymentSessions = [];
  await page(async ({ app, query, login }) => {
    await login(); await review(app.model);
    const attempt = { mode: checkoutMode, body: { quoteId: quote.id }, key: 'test-idempotency-key', transactionId: payload.transactionId };
    app.model.state.attempt = attempt; app.model.state.checkoutSession = payload; app.model.emit(); await settle();
    assert.equal(loads, 1); assert.equal(query('#retry-payment-form').hidden, false);
    const checkoutSession = app.model.state.checkoutSession;
    query('#retry-payment-form').click(); await settle();
    assert.equal(loads, 2); assert.equal(app.model.state.attempt, attempt); assert.equal(app.model.state.checkoutSession, checkoutSession);
    assert.equal(app.model.state.attempt.key, 'test-idempotency-key');
    assert.equal(paymentSessions[0], checkoutSession.paymentSession);
    assert.equal(paymentSessions[1], checkoutSession.paymentSession);
    assert.equal(sessions(api).length, 0); assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
  }, { checkoutFactory: (config) => { paymentSessions.push(config.paymentSession); loads++; throw new Error('sdk-blocked'); } });
});
test('failed Flow mount can retry same session and reuse the exact paymentSession object', async () => {
  const payload = session(); const api = checkoutApi();
  let mounts = 0; const paymentSessions = [];
  await page(async ({ app, query, login }) => {
    await login(); await review(app.model);
    const attempt = { mode: checkoutMode, body: { quoteId: quote.id }, key: 'test-idempotency-key', transactionId: payload.transactionId };
    app.model.state.attempt = attempt; app.model.state.checkoutSession = payload; app.model.emit(); await settle();
    assert.equal(mounts, 1); assert.equal(query('#retry-payment-form').hidden, false);
    const checkoutSession = app.model.state.checkoutSession;
    query('#retry-payment-form').click(); await settle();
    assert.equal(mounts, 2); assert.equal(app.model.state.attempt, attempt); assert.equal(app.model.state.checkoutSession, checkoutSession);
    assert.equal(app.model.state.attempt.key, 'test-idempotency-key');
    assert.equal(paymentSessions[0], checkoutSession.paymentSession);
    assert.equal(paymentSessions[1], checkoutSession.paymentSession);
    assert.equal(sessions(api).length, 0); assert.equal(posts(api).filter((call) => call.path.endsWith('/transactions')).length, 0);
  }, { checkoutFactory: async (config) => {
    paymentSessions.push(config.paymentSession);
    return { create(type) { assert.equal(type, 'flow'); return { mount() { mounts++; throw new Error('mount failed'); } }; } };
  } });
});
test('late Flow initialization and callbacks cannot survive signout', async () => {
  const wait = pending(); let options; let creates = 0;
  await page(async ({ app, query, login, api }) => {
    await login(); await review(app.model); await app.model.confirm(); await tick();
    query('#sign-out').click(); await tick(); const calls = api.calls.length;
    wait.resolve({ create() { creates++; } }); await tick();
    await options.onPaymentCompleted(null, { id: 'untrusted' });
    assert.equal(creates, 0); assert.equal(api.calls.length, calls); assert.equal(app.model.state.checkoutSession, null);
  }, { checkoutFactory: (config) => { options = config; return wait.promise; } });
});
test('official Flow loader uses one directly hosted script; unsafe sessions are rejected before factory calls', async () => {
  const dom = new JSDOM('', { url: 'https://website.example' });
  try {
    const first = loadCheckoutFactory(dom.window); assert.equal(loadCheckoutFactory(dom.window), first);
    const script = dom.window.document.querySelector('script'); assert.equal(script.src, 'https://checkout-web-components.checkout.com/index.js');
    assert.equal(dom.window.document.querySelectorAll('script').length, 1);
    const factory = () => {}; dom.window.CheckoutWebComponents = factory; script.dispatchEvent(new dom.window.Event('load'));
    assert.equal(await first, factory);
    await assert.rejects(mountCheckoutFlow({ session: { ...session(), environment: 'PRODUCTION' }, factory: () => assert.fail('Unsafe factory call') }));
    assert.throws(() => validateCheckoutSession(null));
  } finally { dom.window.close(); }
});
test('optional registration country is sent to account registration, never added to payment payload', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://api.example.test/api', fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ user: { id: 'test' }, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }));
  } });
  const registration = { firstName: 'Test', lastName: 'Customer', email: 'test@example.test', password: 'fixture-password' };
  await api.register(registration); await api.register({ ...registration, countryCode: 'CA' });
  assert.deepEqual(calls, [registration, { ...registration, countryCode: 'CA' }]);
});
test('registration UI accepts an explicit optional account country and does not guess from recharge', async () => {
  const api = checkoutApi({ country: null }); let account;
  api.register = async (body) => { account = body; api.profile.countryCode = body.countryCode; return { id: api.profile.id }; };
  await page(async ({ query, submit, app }) => {
    query('#choose-register').click(); assert.equal(query('#register-country').value, '');
    for (const [id, value] of [['first-name', 'Test'], ['last-name', 'Customer'], ['register-email', 'test@example.test'], ['register-password', 'test-password'], ['register-country', 'ca']]) query(`#${id}`).value = value;
    submit('#register-form'); await tick();
    assert.equal(account.countryCode, 'CA'); assert.equal(app.model.state.accountCountry, 'CA');
    assert.equal(app.model.state.country, '');
  }, { api });
});
test('SDK unmount failure cannot prevent local signout and clearing hosted fields', async () => {
  let options;
  await page(async ({ app, query, login, api }) => {
    await login(); await review(app.model); await app.model.confirm(); await tick();
    query('#sign-out').click(); await tick(); const count = api.calls.length;
    await options.onPaymentCompleted();
    assert.equal(api.calls.length, count); assert.equal(query('#checkout-flow-container').childElementCount, 0);
    assert.equal(query('#checkout').hidden, true); assert.equal(app.model.state.checkoutSession, null);
  }, { checkoutFactory: async (config) => { options = config; return { create: () => ({
    mount(container) { container.append(document.createElement('iframe')); }, unmount() { throw new Error('SDK cleanup failure'); },
  }) }; } });
});
test('blocked hosted script fails safely and is never replaced by another script URL', async () => {
  const dom = new JSDOM('', { url: 'https://website.example' });
  try {
    const loaded = loadCheckoutFactory(dom.window);
    dom.window.document.querySelector('script').dispatchEvent(new dom.window.Event('error'));
    await assert.rejects(loaded, /form unavailable/);
    const retried = loadCheckoutFactory(dom.window);
    assert.notEqual(retried, loaded);
    assert.equal(dom.window.document.querySelectorAll('script').length, 2);
    for (const script of dom.window.document.querySelectorAll('script')) assert.equal(script.src, 'https://checkout-web-components.checkout.com/index.js');
  } finally { dom.window.close(); }
});
test('Flow CSP permits its hosted script and frames without permitting inline script or changing public safety gates', () => {
  for (const path of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /script-src 'self' https:\/\/checkout-web-components\.checkout\.com;/);
    assert.match(html, /frame-src https:\/\/\*\.checkout\.com;/);
    assert.doesNotMatch(html, /script-src[^;]*(unsafe-inline|unsafe-eval)/);
  }
  assert.match(readFileSync('public-config.js', 'utf8'), /mobileRechargeLive: false/);
});
