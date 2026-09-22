# Test recharge implementation and contract

Scope: `semitrack00-sys/ticash-app-web` only. No backend changes, merges, deployments, real payments, or production provider calls are part of this implementation.

## Audited source

Website main at audit: `bef59760912758244736a8afa2141bcbdbe9788f`. The previous `copilot/copilotticash-web-recharge-final` remote branch had an empty diff against main and still contained the placeholder page. Work starts from main on `codex/ticash-web-recharge-final`.

Backend reference: [TiCash PR #9](https://github.com/semitrack00-sys/Ticash/pull/9), head `bcc9166fdf416c0000652fcad4061a362412ec76`. Backend main inspected at `a3e91d9d1c393faf29c0aaa338b34cfa0237ac60`. The topup router and service are identical between these revisions. PR #9 is open and unmerged at this audit; its browser CORS changes must not be assumed deployed.

Read-only source review covered `apps/api/src/app.ts`, `topup/router.ts`, `topup/service.ts`, `topup/types.ts`, `topup/validation.ts`, `topup/config.ts`, `topup/repository.ts`, and backend topup tests. Router blob: `caad121676bd1a60a369cc7dc5918afe77596969`; service blob: `6edc4f079058d49217bdf3ed814d013cbfcc0807`.

## Configuration and authentication

Set `window.TICASH_PUBLIC_CONFIG.apiBaseUrl` to a confirmed TiCash **test** backend URL ending in `/api`. It is empty by default; login is disabled with a clear explanation until configured. HTTPS is required except when both the page and API use loopback HTTP for local testing. URLs with credentials, query strings, or fragments are rejected. Keep `mobileRechargeLive: false`; changing it causes this checkout to refuse initialization.

The previous `/login` was a placeholder. Both `/login` and `/recharge` now use the real backend login contract. Successful login on `/login` replaces the address with the fixed local `/recharge` path without navigating away. No user-supplied redirect is followed. No signup, authentication bypass, or demo account exists in runtime code.

| Method and API-relative path | Request | Response used |
| --- | --- | --- |
| POST `/auth/login` | JSON `{email,password}` | `{user,accessToken,refreshToken}` |
| POST `/auth/refresh` | JSON `{refreshToken}` | `{accessToken,refreshToken}` |
| POST `/auth/logout` | JSON `{refreshToken}` | 204 |

The backend issues a 15-minute access JWT and rotating refresh token. Tokens stay in a private memory closure, never local/session storage, the DOM, URLs, or analytics. Concurrent 401s share one refresh; the original request is retried once, preserving its body and idempotency key. Failed refresh, a second 401, or account lock clears the session. Stale responses cannot reestablish a signed-out session. Logout clears local data immediately even if server logout fails.

Reloading/leaving the page signs the user out. This deliberately avoids persistent bearer credentials in a static website. After an interrupted confirmation, sign in and inspect history before starting another recharge. The in-memory retry key does not survive a reload.

## Recharge requests

All paths below are relative to `/api/mobile-topups`. Every request uses `Authorization: Bearer <accessToken>`. JSON POSTs use `Content-Type: application/json`. Browser fetch uses CORS, omits cookies, disables cache/referrer, rejects redirects, and times out after 20 seconds. Values in query strings and path segments are encoded. Backend funding/account restrictions remain enforced.

| Method and path | Query or JSON body | Response |
| --- | --- | --- |
| GET `/status` | None | Availability object |
| GET `/countries` | None | `{countries:[{code,name}]}` |
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

Quotes use the backend's `id`, `countryCode`, `recipientPhone`, `operatorId`, `operatorName`, `productId`, `productName`, `providerAmount`, `providerCurrency`, `deliveredValue`, `deliveredCurrency`, `feeUsd`, `totalChargeUsd`, and `expiresAt`. USD fee/total fields are the explicit backend contract. The browser formats these values and does not calculate charges. Returned quote selections must match the submitted country, phone, operator, and product. Expired quotes cannot be newly confirmed. Changes to country/phone/operator clear dependent selections and receipts; product/amount changes invalidate quotes. Revision and session guards discard stale asynchronous responses.

Transactions additionally use `quoteId`, `status`, `paymentStatus`, `testMode`, `createdAt`, `updatedAt`, and optional `failureCode`. The UI distinguishes processing/delivered/failed/refunded through the backend status, offers explicit refresh, and shows history. Repeat requests a fresh backend quote and requires review again; it never replays a historic charge.

Errors use `{error,code}` and HTTP status, with safe fallback text for malformed/non-JSON/network errors. Error and provider strings render as text nodes, not HTML. No sensitive logs or checkout analytics are emitted.

## Confirmation and safety

Before loading catalogs and immediately before submitting a transaction, the API must explicitly report `environment: SANDBOX`, `paymentMode: MOCK`, `testMode: true`, `productionEnabled: false`, `approvedForLiveUse: false`, and `liveRechargeEnabled: false`, with `enabled: true`. Missing or conflicting flags fail closed. Backend gates are authoritative and unchanged.

Confirmation requires a reviewed, unexpired backend quote. Keys use `crypto.randomUUID()` or UUID v4 bytes from `crypto.getRandomValues()`; no insecure fallback exists. A pending confirmation locks selections and double submission. Unknown failures retain the exact key/body for retry, including across access-token refresh. Only explicit pre-reservation quote-expired/not-found or disabled/unsafe-environment responses release the attempt. History can resolve a matching quote's test transaction. These rules follow backend purchase replay-before-expiry and reservation behavior.

There are no card, CVV, payment processor, provider credential, signing secret, or database fields. Backend environment variables are untouched. All public availability flags remain false.

## CORS and CSP

PR #9 allows `Authorization`, `Content-Type`, and `Idempotency-Key`, includes GET/POST and OPTIONS, and answers permitted preflights with 204. Its production allowlist includes `https://ticash-app.com` and `https://www.ticash-app.com`; development loopback origins are supported. Additional preview origins require explicit backend configuration. Browser code never uses `no-cors` or attempts to bypass an origin denial.

The route CSP blocks inline scripts, plugins, base URL changes, and native form navigation. It allows same-origin modules/styles, the existing brand font hosts, and HTTPS API connections plus loopback development connections. Since the API origin is configurable, `connect-src` is broader than a single host; a future hosting configuration can pin it to the verified backend origin. No such deployment is performed here.

## Validation and limits

Run `npm ci --ignore-scripts`, `npm test`, and `npm run check` on Node.js 24. Tests exercise country/search/reset behavior, detection/manual fallback, fixed/range contracts, quote integrity/expiry/review, secure keys, duplicate/uncertain confirmation, late responses across logout, authentication/refresh failures, network errors, receipts/refresh/repeat, safe text rendering, configuration gates, and TEST MODE visibility. `npm audit` checks development dependencies. No separate lint or build script exists.

Contract checks are source comparison and deterministic test doubles. Test data is confined to `tools/` and never imported by runtime modules. Browser smoke testing uses a loopback-only fixture server and generated test account. It cannot establish deployed API availability, real user authentication, actual cross-origin preflight behavior, or provider delivery. No deployed backend URL or real account was supplied; those integration checks remain unexecuted. No real recharge/payment/provider transaction or deployment is authorized by this change.
