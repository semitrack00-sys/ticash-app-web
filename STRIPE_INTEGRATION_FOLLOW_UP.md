# Separate Stripe integration investigation

This UI redesign deliberately leaves `js/checkout-flow.js`, the API client, recharge state machine, payment configuration, and payment endpoints unchanged.

The existing adapter validates a PaymentIntent-style `pi_..._secret_...` client secret and passes it to `stripe.initEmbeddedCheckout`. Investigate the backend session contract and the expected Stripe Embedded Checkout Session client secret together in a separate payment task. Confirm the actual response contract before choosing any repair. A browser return or callback must never authorize fulfillment.

Contract reference: https://docs.stripe.com/api/checkout/sessions/object (Checkout Session client_secret and ui_mode). This issue has not been repaired or verified through a Stripe payment in this UI task.

## Hero artwork

The user-supplied transparent woman/worldwide-globe PNG is now integrated into the existing decorative desktop slot. The approved mobile gradient remains unchanged. Asset provenance and responsive behavior are documented in `brand/flupflap/HERO_ARTWORK.md`. The separate Stripe investigation above remains unresolved and outside this UI task.
