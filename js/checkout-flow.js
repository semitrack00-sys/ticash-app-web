import { ApiError } from './api-client.js';

export const checkoutMode = 'STRIPE_SANDBOX';
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function validateCheckoutSession(data) {
  if (!record(data) || data.provider !== 'STRIPE' || data.environment !== 'SANDBOX' || data.testMode !== true ||
      !isUuid(data.transactionId) || !record(data.paymentSession) ||
      typeof data.paymentSession.id !== 'string' || !/^pi_\S+$/.test(data.paymentSession.id) ||
      typeof data.paymentSession.client_secret !== 'string' || !/^pi_\S+_secret_\S+$/.test(data.paymentSession.client_secret) ||
      typeof data.publicKey !== 'string' || !/^pk_test_\S+$/.test(data.publicKey) ||
      !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 || data.currency !== 'USD' || data.paymentStatus !== 'SESSION_CREATED') {
    throw new ApiError('INVALID_CHECKOUT_SESSION', 'Unable to verify the Stripe sandbox payment session. Keep this page open and refresh transaction status.');
  }
  return data;
}

const libraries = new WeakMap();
// Stripe Elements must be loaded from Stripe's hosted SDK after session validation.
export function loadCheckoutFactory(pageWindow) {
  if (!libraries.has(pageWindow)) {
    const library = new Promise((resolve, reject) => {
      const script = pageWindow.document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      const fail = () => reject(new Error('Stripe sandbox payment form unavailable. Refresh transaction status before starting another recharge.'));
      const timer = pageWindow.setTimeout(fail, 20000);
      script.onload = () => {
        pageWindow.clearTimeout(timer);
        if (typeof pageWindow.Stripe === 'function') resolve(pageWindow.Stripe);
        else fail();
      };
      script.onerror = () => { pageWindow.clearTimeout(timer); fail(); };
      pageWindow.document.head.append(script);
    });
    libraries.set(pageWindow, library);
    library.catch(() => {
      if (libraries.get(pageWindow) === library) libraries.delete(pageWindow);
    });
  }
  return libraries.get(pageWindow);
}

export async function mountCheckoutFlow({ session, container, factory, active, onPaymentCompleted }) {
  validateCheckoutSession(session);
  const stripe = await factory(session.publicKey);
  if (!active()) return;
  const checkout = await stripe.initEmbeddedCheckout({
    clientSecret: session.paymentSession.client_secret,
    // Never use browser callback payloads as proof of payment.
    onComplete: () => { if (active()) return onPaymentCompleted(session.transactionId); },
  });
  if (!active()) {
    try { checkout?.unmount?.(); } catch { /* noop */ }
    return;
  }
  await checkout.mount(container);
  return { unmount() { checkout.unmount?.(); } };
}
