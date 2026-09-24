import { ApiError } from './api-client.js';

export const checkoutMode = 'CHECKOUT_COM_SANDBOX';
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function validateCheckoutSession(data) {
  if (!record(data) || data.provider !== 'CHECKOUT_COM' || data.environment !== 'SANDBOX' || data.testMode !== true ||
      !isUuid(data.transactionId) || !record(data.paymentSession) ||
      typeof data.paymentSession.id !== 'string' || !/^ps_\S+$/.test(data.paymentSession.id) ||
      typeof data.paymentSession.payment_session_token !== 'string' || !data.paymentSession.payment_session_token.trim() ||
      typeof data.publicKey !== 'string' || !/^pk_sbox_\S+$/.test(data.publicKey) ||
      !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 || data.currency !== 'USD' || data.paymentStatus !== 'SESSION_CREATED') {
    throw new ApiError('INVALID_CHECKOUT_SESSION', 'Unable to verify the sandbox payment session. Keep this page open and refresh transaction status.');
  }
  return data;
}

const libraries = new WeakMap();
// Official Flow contract: https://www.checkout.com/docs/get-started
// Load directly from Checkout.com, only after a validated sandbox session exists.
export function loadCheckoutFactory(pageWindow) {
  if (!libraries.has(pageWindow)) {
    const library = new Promise((resolve, reject) => {
      const script = pageWindow.document.createElement('script');
      script.src = 'https://checkout-web-components.checkout.com/index.js';
      script.async = true;
      const fail = () => reject(new Error('Sandbox payment form unavailable. Refresh transaction status before starting another recharge.'));
      const timer = pageWindow.setTimeout(fail, 20000);
      script.onload = () => {
        pageWindow.clearTimeout(timer);
        if (typeof pageWindow.CheckoutWebComponents === 'function') resolve(pageWindow.CheckoutWebComponents);
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
  const checkout = await factory({
    paymentSession: session.paymentSession, publicKey: session.publicKey, environment: 'sandbox',
    // Never use the browser's payment ID or payload as proof of payment.
    onPaymentCompleted: () => { if (active()) return onPaymentCompleted(session.transactionId); },
  });
  if (!active()) return;
  const flow = checkout.create('flow');
  await flow.mount(container);
  return flow;
}
