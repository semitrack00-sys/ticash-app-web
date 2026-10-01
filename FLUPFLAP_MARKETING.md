# FlupFlap acquisition and sharing

`/join` is a public marketing page; `/` remains the existing FlupFlap app. It uses the official logo/artwork, localized marketing copy, canonical social metadata and links to the existing login/registration/recharge journey. Product/coverage claims are qualified by real provider availability. No country/operator/price fixture is shipped. The dedicated build includes the new page, modules and CSS, validated by the existing built-output asset crawler. Current main's login, support, legal pages and social preview work are preserved.

## Backend contract

This requires the coordinated Ticash FlupFlap marketing PR and its reviewed database migration. Both marketing flags default off. If unavailable, attribution/share controls give safe feedback and cannot grant an account, credit or discount. Public attribution may fail without blocking registration or recharge.

Opaque `r` and normalized `promo` are the only marketing query fields copied to CTA links. `mode=register` selects the existing registration form on FlupFlap only. The server finalizes immutable attribution after real authentication. Expiring visit capabilities stay in memory, with an optional API HttpOnly cookie for navigation reuse; they grant no auth/payment privilege. No access/refresh token is put in a referral URL. Existing authentication endpoints, session mechanics and checkout recovery remain unchanged.

Registered users have Share FlupFlap in their account menu: WhatsApp, SMS, copy and a real backend-generated QR. Guests cannot obtain customer referral links. Logout clears share data and ignores late requests. Marketing inputs use safe DOM text, strict API routes and existing CORS/CSP.

Optional promo entry appears on `/join` and the existing registration form. Saving a code means eligibility review, not a promised discount. The server quote supplies original fee, benefit, final fee/total and first-recharge conditions; the amount/review screens display those values without calculating authoritative discounts. Receiver values remain provider-backed. No Stripe/provider/fee-table code changed.

English, Haitian Creole, French, Spanish and Portuguese include the new strings. Other existing locales continue using the application's established English fallback for these additions.

## Validation on latest main

Comparison base: `a1bcfe9372533ff7f68ca760fc3149aa2123a932`.

- Clean main: 203 tests, 169 passed, 34 failed.
- Feature: 217 tests, 183 passed, same 34 failed.
- 14 new marketing/build/review regressions passed; zero additional failure names.
- Site/security checks, browser/tool JavaScript syntax, production build, 330-file asset/link crawl and diff check passed.
- Website dependency audit: zero vulnerabilities.
- Chrome against built `dist/flupflap`: 390/430/768/1440px, `/join`, manual promo, query-preserving registration, authenticated attribution/share and QR. No overflow, missing images, console exceptions, unexpected HTTP errors or failed requests. All API/Stripe calls intercepted by local test fixtures; no real account/payment/recharge was created.

Main's failures are not hidden or fixed as part of this feature. They cover stale sandbox/live expectations, token/resume assertions, translation coverage, login-design assertions, pending-history behavior and social-preview expectations. Full suite remains red; this PR is not a production-readiness claim.

## Local review artifacts

Not published or committed: `op/artifacts/marketing-join-{390,430,768,1440}.png`, `marketing-share-{390,430,768,1440}.png`, `marketing-browser-results.json`, `marketing-baseline-comparison.json`, `marketing-web-final.log`, `marketing-web-baseline-latest.log`. Screenshot data is isolated to the external browser harness. Backend admin screenshots are `marketing-admin-390.png` / `marketing-admin-1440.png`.

No deployment, domain/DNS change, secret, live promotional benefit or payout is included. `/join` is added to the existing Render route configuration only; migration/cutover remain separate operational approvals.

## Inherited failing tests

- FLUPFLAP resume endpoint uses only the opaque capability, even with an authenticated client
- FlupFlap auth is separate, lightweight, memory-only and cannot request TiCash services
- FlupFlap pages publish a raster social preview with the official multicolor logo
- Stripe checkout accepts CARD payment methods from backend type contract and proceeds without unavailable message
- Stripe checkout reserves payment-session with idempotency and never posts browser fulfillment transaction directly
- UI completes country search, manual selection, quote, review, confirm and receipt refresh
- a previous session confirmation cannot unlock a new session confirmation
- all local model and API validation/error literals have canonical translations
- approved login uses the official logo, no old artwork, and three informational features
- billing selector keyboard selection and Escape restore focus; confirmation and CARD gates remain
- confirmation sends a secure key, only quoteId, and creates a test receipt
- full return flow uses the real unauthenticated API client and exclusively posts status reads
- guest selects Canada; request sends only CA, with separate HT destination
- guest selects United States; request sends only US, with separate HT destination
- internal transaction fields or malformed/non-sandbox DTOs fail closed
- journey quotes provider amount once, refreshes expired price and requires review before payment
- login: empty fields make no login request and unavailable configuration stays disabled
- login: premium design keeps the real guest action outside the card without extra artwork
- manual operator selection keeps logo through quote and receipt
- only terminal server payment states release Stripe checkout lock
- page-level hosted checkout mounts once and never posts browser fulfillment
- pending history exposes server cancellation and removes the action after cancellation
- pending polls only resume; a later terminal result stops all polling
- permanent customer retains stored billing country and does not use guest selector
- public DTO needs no expiry metadata; server expiry stops pending polling and clears the capability
- receipt and history localize labels and dates while keeping provider values and IDs intact
- recharge branding uses FlupFlap and keeps TiCash-App as the parent platform
- recharge: empty fields make no login request and unavailable configuration stays disabled
- recharge: premium design keeps the real guest action outside the card without extra artwork
- return displays only the recovered recharge without authenticating; URL is scrubbed synchronously
- shared header language selector synchronizes translated UI, ISO labels, search, hints and keyboard focus
- transaction status refresh and repeat use exact contract; repeat requires new review
- unavailable Stripe payment method fails closed
- unknown outcome retries identical payload/key and history can resolve it
