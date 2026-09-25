# Test recharge implementation and contract

Website scope: `semitrack00-sys/ticash-app-web`, with a companion backend upgrade in `semitrack00-sys/Ticash`. No merges, deployments, real payments, or production provider calls are part of this implementation.

## Audited source

This upgrade starts from website main `6059f4ee12d5c6bfbc59c732fbef0dc562d4ecf2` on `codex/ticash-recharge-accounts-calling-codes`. The previous authenticated recharge implementation is already merged in website PR #4.

The companion backend branch `codex/ticash-recharge-guest-calling-codes` starts from main `d799f8ccf6df467feb482c7cb964b1045e405386`, which includes [TiCash PR #9](https://github.com/semitrack00-sys/Ticash/pull/9). Merge status does not establish deployed behavior. The upgrade adds sandbox guest identities and expiry, calling-code metadata, and the $3.50 development fee example while preserving existing registration and protected purchase routes.

## Configuration and authentication

`window.TICASH_PUBLIC_CONFIG.apiBaseUrl` currently retains main's `https://ticash-api.onrender.com/api`. An empty URL disables authentication with a clear explanation. A configured URL alone does not approve live use: the API must explicitly report sandbox status with MOCK or STRIPE_SANDBOX payment mode. HTTPS is required except when both the page and API use loopback HTTP for local testing. URLs with credentials, query strings, or fragments are rejected. Keep `mobileRechargeLive: false`; changing it causes this checkout to refuse initialization.

Both `/login` and `/recharge` now offer sign-in, Create account, and Continue as guest. Successful authentication on `/login` replaces the address with the fixed local `/recharge` path without navigating away. No user-supplied redirect is followed. There is no authentication bypass or demo account in runtime code.

| Method and API-relative path | Request | Response used |
| --- | --- | --- |
| POST `/auth/login` | JSON `{email,password}` | `{user,accessToken,refreshToken}` |
| POST `/auth/register` | JSON `{firstName,lastName,email,password,countryCode?}` | 201 `{user,accessToken,refreshToken}` |
| POST `/auth/guest` | No body or credentials | 201 `{guest:true,expiresAt,user,accessToken,refreshToken}` |
| POST `/auth/refresh` | JSON `{refreshToken}` | `{accessToken,refreshToken}` |
| POST `/auth/logout` | JSON `{refreshToken}` | 204 |

The backend issues a 15-minute access JWT and rotating refresh token. Tokens stay in a private memory closure, never local/session storage, the DOM, URLs, or analytics. Concurrent 401s share one refresh; the original request is retried once, preserving its body and idempotency key. Failed refresh, a second 401, or account lock clears the session. Stale responses cannot reestablish a signed-out session. Logout clears local data immediately even if server logout fails.

Reloading/leaving the page signs the user out. This deliberately avoids persistent bearer credentials in a static website. After an interrupted confirmation, sign in and inspect history before starting another recharge. The in-memory retry key does not survive a reload.

Registration uses the existing persistent backend account flow and automatically enters checkout. A configured backend database is required for persistence; the API's development memory store is not permanent. Both password fields have keyboard-accessible Show/Hide buttons, default to hidden, and are cleared after authentication attempts and mode changes. Guest entry requires an explicit `guest:true` response with a `CUSTOMER` role and normal tokens. Guest sessions display `Guest · private test session`; history is temporary and does not migrate to a new account. Creating an account from a guest session signs the guest out first. The backend bounds guest identities to one hour and keeps account/funding restrictions in place.

## Recharge requests

All paths below are relative to `/api/mobile-topups`. Every request uses `Authorization: Bearer <accessToken>`. JSON POSTs use `Content-Type: application/json`. Browser fetch uses CORS, omits cookies, disables cache/referrer, rejects redirects, and times out after 20 seconds. Values in query strings and path segments are encoded. Backend funding/account restrictions remain enforced.

| Method and path | Query or JSON body | Response |
| --- | --- | --- |
| GET `/status` | None | Availability object |
| GET `/countries` | None | `{countries:[{code,name,callingCode}]}` |
| GET `/operators` | `country` | `{operators}` |
| GET `/operators/detect` | `country`, full international `phone` | `{operator}` |
| GET `/operators/:id/products` | `country` | `{operator,products}` |
| GET `/recipients` | None | `{recipients}` |
| POST `/quotes` | `{countryCode,phone,operatorId,productId,amount?}` | 201 `{quote}` |
| POST `/transactions` | `{quoteId}`; `Idempotency-Key` header | 201 `{transaction}` |
| GET `/transactions` | None | `{transactions}` |
| GET `/transactions/:id` | `refresh=true` | `{transaction}` |
| POST `/transactions/:id/repeat` | No body | 201 `{quote}` |

The backend also supports saving recipients; this UI reads existing recipients and rechecks current catalogs. It does not submit `recipientId` or create recipients.

Country/operator/product lists come exclusively from authenticated backend responses. Fixed products omit `amount`; range products send the entered numeric amount within the returned bounds, with at most two decimal places. No browser catalog or destination code is hardcoded. The browser never calls Reloadly directly.

Country options display `Name (+callingCode)` and search matches name, ISO identity, and calling code. Selection prefills a full international-number input with the backend prefix; switching countries discards the old number and replaces the prefix. Phone input is structurally checked as E.164 with the selected calling prefix before detection and quoting. Formatting and a leading `00` are normalized; repeated `+` prefixes are rejected. There is no uniform national-number length rule, invented code map, or inference of ISO identity from a shared calling code. Operator detection and backend/provider validation remain authoritative.

The backend's test/development fee example is $3.50: a $5.00 recharge quote returns a $3.50 fee and $8.50 total. The page only formats returned quote values; it has no configured or computed fee. Deploying this website version requires the companion backend's calling-code field and guest endpoint plus its reviewed guest-expiry database migration. Missing calling-code metadata leaves checkout unavailable with a clear error. No deployments or migration application are part of this work.

Quotes use the backend's `id`, `countryCode`, `recipientPhone`, `operatorId`, `operatorName`, `productId`, `productName`, `providerAmount`, `providerCurrency`, `deliveredValue`, `deliveredCurrency`, `feeUsd`, `totalChargeUsd`, and `expiresAt`. USD fee/total fields are the explicit backend contract. The browser formats these values and does not calculate charges. Returned quote selections must match the submitted country, phone, operator, and product. Expired quotes cannot be newly confirmed. Changes to country/phone/operator clear dependent selections and receipts; product/amount changes invalidate quotes. Revision and session guards discard stale asynchronous responses.

Transactions additionally use `quoteId`, `status`, `paymentStatus`, `testMode`, `createdAt`, `updatedAt`, and optional `failureCode`. The UI distinguishes processing/delivered/failed/refunded through the backend status, offers explicit refresh, and shows history. Repeat requests a fresh backend quote and requires review again; it never replays a historic charge.

Errors use `{error,code}` and HTTP status, with safe fallback text for malformed/non-JSON/network errors. Error and provider strings render as text nodes, not HTML. No sensitive logs or checkout analytics are emitted.

## Confirmation and safety

Before loading catalogs and immediately before submitting a transaction, the API must explicitly report `environment: SANDBOX`, `paymentMode: MOCK` or `STRIPE_SANDBOX`, `testMode: true`, `productionEnabled: false`, `approvedForLiveUse: false`, and `liveRechargeEnabled: false`, with `enabled: true`. Missing or conflicting flags fail closed. Backend gates are authoritative and unchanged.

Confirmation requires a reviewed, unexpired backend quote. Keys use `crypto.randomUUID()` or UUID v4 bytes from `crypto.getRandomValues()`; no insecure fallback exists. A pending confirmation locks selections and double submission. Unknown failures retain the exact key/body for retry, including across access-token refresh. Only explicit pre-reservation quote-expired/not-found or disabled/unsafe-environment responses release the attempt. History can resolve a matching quote's test transaction. These rules follow backend purchase replay-before-expiry and reservation behavior.

There are no TiCash-owned card-number, expiry, CVV, provider credential, signing secret, or database fields. Stripe Sandbox uses hosted Flow fields only. Backend environment variables are untouched. All public availability flags remain false.

## CORS and CSP

PR #9 allows `Authorization`, `Content-Type`, and `Idempotency-Key`, includes GET/POST and OPTIONS, and answers permitted preflights with 204. Its production allowlist includes `https://ticash-app.com` and `https://www.ticash-app.com`; development loopback origins are supported. Additional preview origins require explicit backend configuration. Browser code never uses `no-cors` or attempts to bypass an origin denial.

The route CSP blocks inline scripts, plugins, base URL changes, and native form navigation. It allows same-origin modules/styles, the existing brand font hosts, and HTTPS API connections plus loopback development connections. Since the API origin is configurable, `connect-src` is broader than a single host; a future hosting configuration can pin it to the verified backend origin. No such deployment is performed here.

## Validation and limits

Run `npm ci --ignore-scripts`, `npm test`, and `npm run check` on Node.js 24. Tests exercise country/search/reset behavior, detection/manual fallback, fixed/range contracts, quote integrity/expiry/review, secure keys, duplicate/uncertain confirmation, late responses across logout, authentication/refresh failures, network errors, receipts/refresh/repeat, safe text rendering, configuration gates, and TEST MODE visibility. `npm audit` checks development dependencies. No separate lint or build script exists.

Contract checks use source comparison and deterministic test doubles. Test data is confined to `tools/` and never imported by runtime modules. Local browser checks cannot establish deployed API availability, real user authentication, actual cross-origin preflight behavior, or provider delivery. The configured remote backend and real accounts were not exercised; those integration checks remain unexecuted. No real recharge/payment/provider transaction or deployment is authorized by this change.


## Stripe sandbox Flow frontend

The website uses the backend-selected payment mode. MOCK retains its existing `POST /mobile-topups/transactions` confirmation and same-key retry behavior. Stripe Sandbox never falls back to MOCK or posts a transaction to fulfill airtime. All live-use flags must still be explicitly false.

After authentication, `GET /mobile-topups/payment-methods` supplies `{methods:[{method,provider,testMode,enabled,reason?}]}`. Stripe sandbox flow requires an enabled test CARD method with provider STRIPE. Missing, failed or unsafe method responses block card payment setup; MOCK confirmation is independent of card availability. Disabled reasons render as text. Eligibility and sandbox status are rechecked immediately before session creation.

Permanent accounts read `GET /users/me` (a user object, or `{user}`). A missing `countryCode` requires an explicitly entered two-letter account/billing country. When that value changes, the browser PATCHes `/users/me` with the existing backend profile fields required/supported by `profileSchema`, changing only `countryCode` while preserving `firstName`, `lastName`, `phoneNumber`, `addressLine1`, `addressLine2`, `city`, `region`, and `postalCode`. After PATCH, `GET /users/me` is read again so the saved server profile remains authoritative before payment. The destination/recharge country is never copied into billing automatically. Registration supports the same optional field. Guest sessions cannot read/update billing profile state or create a Stripe sandbox session.

Stripe confirmation POSTs only `{quoteId}` to `/mobile-topups/payment-sessions`, with a secure UUID Idempotency-Key. The response must contain STRIPE, SANDBOX, testMode true, a UUID transactionId, a paymentSession object with a `pi_` ID and a nonempty Stripe client secret, a `pk_test_` publicKey, positive safe integer amountMinor, USD, and SESSION_CREATED. Session data remains in memory and is passed unmodified to the hosted component; it is never stored, logged or inserted into the DOM by TiCash.

The integration uses Stripe's hosted browser SDK and embedded checkout flow semantics. Only after validating the sandbox session does the browser load `https://js.stripe.com/v3/` directly. No downloaded, bundled or self-hosted SDK is included. The Stripe factory receives the sandbox public key, initializes embedded checkout with the server-provided client secret, and mounts it in `#checkout-flow-container`. Tests inject a fake factory and do not load the SDK or contact a payment provider.

The three shared recharge/auth pages allow this specific external script origin and Stripe frames in their CSP. Script inline execution/eval remain prohibited. Inline styles are allowed on these pages for hosted component styling; object, base-URI and form-action restrictions are retained. The hosted SDK and actual 3DS/CSP behavior have not been exercised against Stripe by these local tests; that requires a separately authorized sandbox integration test.

The completion callback ignores the browser payment ID and payload. It reads the TiCash transaction identified by the validated backend session using the existing transaction-status endpoint. Only backend/webhook state can confirm payment or fulfill recharge. A status-refresh button is available before a receipt is received, and an interrupted session without a known transaction ID can recover it from history by quoteId.

A created, ambiguous, replay-unavailable or in-progress payment attempt locks destination/operator/product controls and cannot create another session or idempotency key. History showing a reserved, SESSION_CREATED, PENDING, AUTHORIZED, recovery or unknown payment keeps the lock. Only server-reported CAPTURED, FAILED, VOIDED or REFUNDED releases it. Transaction ID, quote ID and test mode must match. A late session response cannot remount Flow after history has confirmed payment. Flow errors are sanitized; logout invalidates callbacks and removes hosted fields. No browser callback, return URL, or SDK error is treated as payment proof.

Authentication and payment-session state remain memory-only. Reloading or signing out requires signing in and checking history; this change does not add persistent tokens or a payment-resume API. Backend settings, recharge routing, quote/pricing calculations and operator/logo mapping are unchanged. No backend files, migrations, deployments or provider transactions are part of this change.
