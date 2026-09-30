import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { checkoutMode, validateCheckoutSession, loadCheckoutFactory, mountCheckoutFlow } from '../js/checkout-flow.js';
import { ApiError } from '../js/api-client.js';

const session = () => ({
  provider: 'STRIPE',
  environment: 'PRODUCTION',
  testMode: false,
  transactionId: '123e4567-e89b-42d3-a456-426614174000',
  checkoutSession: {
    id: 'cs_live_fixture',
    url: 'https://checkout.stripe.com/c/pay/cs_live_fixture',
  },
  amountMinor: 800,
  currency: 'USD',
  paymentStatus: 'SESSION_CREATED',
});

const invalidSessions = [
  null,
  { ...session(), environment: 'SANDBOX' },
  { ...session(), testMode: true },
  { ...session(), checkoutSession: { ...session().checkoutSession, id: 'pay_bad' } },
  { ...session(), checkoutSession: { ...session().checkoutSession, url: 'https://example.com' } },
  { ...session(), amountMinor: 0 },
  { ...session(), currency: 'HTG' },
  { ...session(), paymentStatus: 'AUTHORIZED' },
];

test('initial and replayed hosted sessions need no resume token; leaked capabilities and credentials fail closed', () => {
  const initial = validateCheckoutSession(session());
  const replay = validateCheckoutSession(structuredClone(initial));
  assert.deepEqual(replay, initial);
  assert.equal(Object.hasOwn(replay, 'checkoutResumeToken'), false);
  for (const key of ['client_secret', 'secretKey', 'webhookSecret', 'accessToken', 'refreshToken', 'checkoutResumeToken']) {
    assert.throws(() => validateCheckoutSession({ ...session(), [key]: 'must-not-expose' }), /Unable to verify/);
  }
  for (const url of ['https://checkout.stripe.com.evil.test/pay', 'https://checkout.stripe.com/pay?accessToken=secret', 'https://checkout.stripe.com/pay?refresh_token=secret', 'https://checkout.stripe.com/pay#accessToken=secret']) {
    assert.throws(() => validateCheckoutSession({ ...session(), checkoutSession: { ...session().checkoutSession, url } }), /Unable to verify/);
  }
});

test('hosted checkout session validation is strict and only allows approved Stripe live sessions', () => {
  for (const value of invalidSessions) {
    assert.throws(() => validateCheckoutSession(value), /Unable to verify the Stripe checkout session/);
  }
  assert.doesNotThrow(() => validateCheckoutSession(session()));
  assert.ok(/^cs_live_/.test(session().checkoutSession.id));
  assert.ok(/^https:\/\/checkout\.stripe\.com\//.test(session().checkoutSession.url));
});

test('hosted checkout helper no longer loads Stripe.js and returns a redirect target', async () => {
  const payload = session();
  const dom = new JSDOM('<!doctype html><html><body><div id="stripe"></div></body></html>');
  const { document } = dom.window;
  const container = document.getElementById('stripe');
  let rendered = '';

  try {
    globalThis.document = document;
    assert.equal(await loadCheckoutFactory(dom.window), null);

    const flow = await mountCheckoutFlow({
      session: payload,
      container,
      factory: null,
      active: () => true,
      onPaymentCompleted: async () => {
        throw new Error('Browser completion should not be used for hosted checkout');
      },
    });

    rendered = container.textContent;
    assert.match(rendered, /Stripe Checkout will open in a secure hosted page/);
    const result = await flow.confirm({ returnUrl: '/recharge?token=abc#state' });
    assert.deepEqual(result, { redirectUrl: payload.checkoutSession.url, transactionId: payload.transactionId });
    flow.unmount();
  } finally {
    delete globalThis.document;
    dom.window.close();
  }

  assert.match(rendered, /Keep this tab open/);
});

test('hosted checkout helper rejects unsafe external return URLs', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="stripe"></div></body></html>', { url: 'https://website.example/recharge' });
  const { document } = dom.window;
  const container = document.getElementById('stripe');

  try {
    globalThis.document = document;
    const flow = await mountCheckoutFlow({
      session: session(),
      container,
      factory: null,
      active: () => true,
      onPaymentCompleted: async () => {},
    });

    await assert.rejects(() => flow.confirm({ returnUrl: 'https://evil.example/steal' }), /return URL is invalid/);
    flow.unmount();
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test('hosted checkout session does not expose secret keys in browser fixtures', () => {
  const payload = session();
  assert.equal(payload.checkoutSession.id.startsWith('cs_live_'), true);
  assert.doesNotMatch(JSON.stringify(payload), /sk_(live|test)_[A-Za-z0-9]+/);
  assert.doesNotMatch(JSON.stringify(payload), /whsec_[A-Za-z0-9]+/);
  assert.doesNotMatch(JSON.stringify(payload), /client_secret/);
});

test('CSP removes Stripe hosted-card SDK allowances when checkout redirects away instead of embedding a browser form', () => {
  for (const path of ['login/index.html', 'recharge/index.html', 'recharge/reset-password/index.html']) {
    const html = readFileSync(path, 'utf8');
    assert.doesNotMatch(html, /js\.stripe\.com/);
    assert.doesNotMatch(html, /hooks\.stripe\.com/);
  }
});
