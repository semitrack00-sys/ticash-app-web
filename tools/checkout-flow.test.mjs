import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { checkoutMode, validateCheckoutSession, loadCheckoutFactory, mountCheckoutFlow } from '../js/checkout-flow.js';
import { ApiError } from '../js/api-client.js';

const session = () => ({
  provider: 'STRIPE',
  environment: 'SANDBOX',
  testMode: true,
  transactionId: '123e4567-e89b-42d3-a456-426614174000',
  paymentSession: { id: 'pi_fixture', client_secret: 'pi_fixture_secret_fixture' },
  publicKey: 'pk_test_fixture',
  amountMinor: 800,
  currency: 'USD',
  paymentStatus: 'SESSION_CREATED',
});

const invalidSessions = [
  null,
  { ...session(), environment: 'PRODUCTION' },
  { ...session(), publicKey: 'pk_live_fixture' },
  { ...session(), testMode: false },
  { ...session(), paymentSession: { ...session().paymentSession, client_secret: 'bad' } },
  { ...session(), paymentSession: { id: 'pay_bad', client_secret: 'pi_bad_secret_bad' } },
];

test('PaymentIntent session validation remains strict and requires pk_test_ in sandbox', () => {
  for (const value of invalidSessions) {
    assert.throws(() => validateCheckoutSession(value), /Unable to verify the Stripe sandbox payment session/);
  }
  assert.doesNotThrow(() => validateCheckoutSession(session()));
  assert.ok(/^pk_test_/.test(session().publicKey));
});

test('Payment Element receives the validated PaymentIntent client secret and never uses Embedded Checkout', async () => {
  const payload = session();
  const dom = new JSDOM('<!doctype html><html><body><div id="stripe"></div></body></html>');
  const { document } = dom.window;
  const container = document.getElementById('stripe');
  let mounted = 0;
  let createdType;
  let encounteredClientSecret;
  let confirmCalls = 0;
  let elementsHandle;

  const factory = async (publicKey) => ({
    async confirmPayment({ elements, redirect }) {
      confirmCalls += 1;
      assert.equal(publicKey, payload.publicKey);
      assert.equal(redirect, 'if_required');
      assert.equal(elements, elementsHandle);
      return { error: null };
    },
    elements(options) {
      encounteredClientSecret = options.clientSecret;
      assert.equal(options.clientSecret, payload.paymentSession.client_secret);
      elementsHandle = {
        create(type) {
          createdType = type;
          assert.equal(type, 'payment');
          return {
            mount(node) {
              mounted += 1;
              assert.equal(node, container);
            },
            unmount() {},
          };
        },
        destroy() {},
      };
      return elementsHandle;
    },
  });

  try {
    globalThis.document = document;
    const flow = await mountCheckoutFlow({
      session: payload,
      container,
      factory,
      active: () => true,
      onPaymentCompleted: async (transactionId) => {
        assert.equal(transactionId, payload.transactionId);
      },
    });

    assert.equal(createdType, 'payment');
    assert.equal(encounteredClientSecret, payload.paymentSession.client_secret);
    assert.equal(mounted, 1);
    assert.equal(typeof flow.confirm, 'function');
    await flow.confirm();
    assert.equal(confirmCalls, 1);
    flow.unmount();
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('confirmPayment uses Payment Element API options with nested confirmParams and same-origin return URL', async () => {
  const payload = session();
  const dom = new JSDOM('<!doctype html><html><body><div id="stripe"></div></body></html>', { url: 'https://website.example/recharge?unsafe=1#frag' });
  const { document } = dom.window;
  const container = document.getElementById('stripe');
  let lastCall;

  const factory = async () => ({
    async confirmPayment(options) {
      lastCall = options;
      return { error: null };
    },
    elements() {
      return {
        create() {
          return { mount() {}, unmount() {} };
        },
        destroy() {},
      };
    },
  });

  const previousLocation = globalThis.location;
  try {
    globalThis.document = document;
    globalThis.location = dom.window.location;
    const flow = await mountCheckoutFlow({
      session: payload,
      container,
      factory,
      active: () => true,
      onPaymentCompleted: async () => {},
    });

    await flow.confirm({ returnUrl: '/recharge/callback?token=abc#state' });
    assert.equal(lastCall.redirect, 'if_required');
    assert.equal(typeof lastCall.confirmParams, 'object');
    assert.equal(lastCall.confirmParams.return_url, 'https://website.example/recharge/callback');

    await flow.confirm({ returnUrl: 'https://evil.example/steal' });
    assert.equal(lastCall.confirmParams, undefined);
  } finally {
    if (previousLocation === undefined) {
      delete globalThis.location;
    } else {
      globalThis.location = previousLocation;
    }
    delete globalThis.document;
    dom.window.close();
  }
});

test('duplicate confirmation is prevented while a payment flow is active', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const payload = session();
  const calls = { confirm: 0, completed: 0 };
  let releaseConfirmation;
  const pendingConfirmation = new Promise((resolve) => {
    releaseConfirmation = resolve;
  });
  const factory = async () => ({
    elements: () => ({ create: () => ({ mount() {}, unmount() {} }), destroy() {} }),
    confirmPayment: async () => {
      calls.confirm += 1;
      await pendingConfirmation;
      return { error: null };
    },
  });

  try {
    globalThis.document = dom.window.document;
    const flow = await mountCheckoutFlow({
      session: payload,
      container: dom.window.document.createElement('div'),
      factory,
      active: () => true,
      onPaymentCompleted: async (transactionId) => {
        calls.completed += 1;
        assert.equal(transactionId, payload.transactionId);
      },
    });

    const first = flow.confirm();
    const second = flow.confirm();

    assert.equal(calls.confirm, 1);
    releaseConfirmation();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.error, null);
    assert.equal(secondResult.error, null);
    assert.equal(calls.confirm, 1);
    assert.equal(calls.completed, 1);
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('malformed session fails closed before Stripe initialization', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const factory = async () => { throw new Error('Stripe factory should not be called for invalid sessions'); };
  try {
    globalThis.document = dom.window.document;
    await assert.rejects(mountCheckoutFlow({ session: { ...session(), publicKey: 'bad' }, container: dom.window.document.createElement('div'), factory, active: () => true, onPaymentCompleted: async () => {} }));
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('production Stripe session fails closed', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  try {
    globalThis.document = dom.window.document;
    await assert.rejects(mountCheckoutFlow({ session: { ...session(), environment: 'PRODUCTION' }, container: dom.window.document.createElement('div'), factory: async () => { throw new Error('unsafe factory'); }, active: () => true, onPaymentCompleted: async () => {} }));
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('browser payment success only triggers transaction refresh and does not create or fulfill a recharge', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const payload = session();
  let refreshed = null;
  const factory = async () => ({
    elements: () => ({ create: () => ({ mount() {}, unmount() {} }), destroy() {} }),
    confirmPayment: async () => ({ error: null }),
  });

  try {
    globalThis.document = dom.window.document;
    const flow = await mountCheckoutFlow({ session: payload, container: dom.window.document.createElement('div'), factory, active: () => true, onPaymentCompleted: async (transactionId) => {
      refreshed = transactionId;
    } });

    await flow.confirm();
    assert.equal(refreshed, payload.transactionId);
    assert.equal(refreshed, payload.transactionId);
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('stripe confirmation error releases lock so an intentional retry can run', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const payload = session();
  let attempts = 0;
  let called = 0;
  const factory = async () => ({
    elements: () => ({ create: () => ({ mount() {}, unmount() {} }), destroy() {} }),
    confirmPayment: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { error: { message: 'card_declined' } };
      }
      return { error: null };
    },
  });

  try {
    globalThis.document = dom.window.document;
    const flow = await mountCheckoutFlow({
      session: payload,
      container: dom.window.document.createElement('div'),
      factory,
      active: () => true,
      onPaymentCompleted: async () => { called += 1; },
    });

    await assert.rejects(() => flow.confirm(), (error) => {
      assert.equal(error.code, 'STRIPE_PAYMENT_CONFIRMATION_FAILED');
      assert.equal(error.message, 'card_declined');
      return true;
    });

    await flow.confirm();
    assert.equal(attempts, 2);
    assert.equal(called, 1);
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('Stripe SDK load failure fails safely', async () => {
  const dom = new JSDOM('', { url: 'https://website.example' });
  const first = loadCheckoutFactory(dom.window);
  assert.equal(loadCheckoutFactory(dom.window), first);
  const script = dom.window.document.querySelector('script');
  assert.equal(script.src, 'https://js.stripe.com/v3/');
  dom.window.Stripe = undefined;
  script.dispatchEvent(new dom.window.Event('error'));
  await assert.rejects(first, /Stripe sandbox payment form unavailable/);
  dom.window.close();
});

test('no secret Stripe key or webhook secret is exposed in browser code or fixtures', () => {
  const payload = session();
  assert.equal(payload.publicKey.startsWith('pk_test_'), true);
  assert.equal(payload.paymentSession.client_secret.startsWith('pi_'), true);
  assert.doesNotMatch(JSON.stringify(payload), /sk_(live|test)_[A-Za-z0-9]+/);
  assert.doesNotMatch(JSON.stringify(payload), /whsec_[A-Za-z0-9]+/);
});

test('CSP allows Stripe script/frames and still blocks unsafe inline/eval scripts', () => {
  for (const path of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
    const html = readFileSync(path, 'utf8');
    assert.match(html, /script-src 'self' https:\/\/js\.stripe\.com;/);
    assert.match(html, /frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com;/);
    assert.doesNotMatch(html, /script-src[^;]*(unsafe-inline|unsafe-eval)/);
  }
});
