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
// Stripe.js must be loaded from Stripe's hosted SDK after session validation.
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

  const elements = stripe.elements({
    clientSecret: session.paymentSession.client_secret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#0f172a',
      },
    },
  });

  const paymentElement = elements.create('payment');
  if (!active()) {
    try { paymentElement.unmount?.(); } catch { /* noop */ }
    try { elements.destroy?.(); } catch { /* noop */ }
    return;
  }

  paymentElement.mount(container);

  let confirmationInProgress = null;

  const confirm = async ({ returnUrl, onError } = {}) => {
    if (confirmationInProgress) return confirmationInProgress;

    confirmationInProgress = (async () => {
      try {
        if (!active()) {
          throw new ApiError('INVALID_CHECKOUT_SESSION', 'The Stripe sandbox payment session is no longer active. Refresh transaction status before retrying.');
        }

        const confirmParams = {
          elements,
          redirect: 'if_required',
        };

        if (typeof returnUrl === 'string' && /^\//.test(returnUrl)) {
          const target = new URL(returnUrl, globalThis.location?.origin || 'https://example.invalid');
          if (target.origin === (globalThis.location?.origin || target.origin)) {
            confirmParams.return_url = target.toString();
          }
        }

        const result = await stripe.confirmPayment(confirmParams);
        if (result.error) {
          const message = result.error.message || 'Unable to confirm the Stripe sandbox payment.';
          if (typeof onError === 'function') onError(new ApiError('STRIPE_PAYMENT_CONFIRMATION_FAILED', message));
          throw new ApiError('STRIPE_PAYMENT_CONFIRMATION_FAILED', message);
        }

        // Do not treat browser success as authorization; only refresh the existing server-bound transaction.
        if (typeof onPaymentCompleted === 'function') {
          await onPaymentCompleted(session.transactionId);
        }
        return result;
      } finally {
        confirmationInProgress = null;
      }
    })();

    return confirmationInProgress;
  };

  return {
    elements,
    paymentElement,
    confirm,
    unmount() {
      try { paymentElement.unmount?.(); } catch { /* noop */ }
      try { elements.destroy?.(); } catch { /* noop */ }
    },
  };
}
