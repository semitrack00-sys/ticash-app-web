# Stripe integration follow-up

The browser-side Stripe contract mismatch in `js/checkout-flow.js` has been repaired by switching from the incompatible Embedded Checkout adapter to the official Stripe.js Payment Element flow using the validated PaymentIntent `pi_..._secret_...` client secret.

The browser still never authorizes recharge fulfillment. It only confirms theStripe payment form, and the existing backend transaction refresh path remains authoritative after the verified webhook state updates the server. Browser results are not proof of payment and are never treated as authorization.

This UI task does not claim live Stripe sandbox verification unless a sandbox integration test is actually run against the backend and Stripe test environment. The current repair preserves the existing server-authoritative flow, security controls, and idempotent transaction locking.

## Hero artwork

The user-supplied transparent woman/worldwide-globe PNG is integrated into the existing decorative desktop slot. The approved mobile gradient remains unchanged. Asset provenance and responsive behavior are documented in `brand/flupflap/HERO_ARTWORK.md`.
