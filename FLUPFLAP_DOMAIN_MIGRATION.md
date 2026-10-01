# Dedicated FlupFlap domain — review before cutover

This PR prepares the website only. It does not move a domain, change DNS/TLS,
modify Render, change API/CORS/cookie settings, merge, or deploy. The dedicated
domain is **not yet certified healthy by this work**.

## Existing services (read-only inspection)

- Website repository: `semitrack00-sys/ticash-app-web`.
- TiCash: `ticash-app-web`, `srv-dabobe3tqb8s73d2h59g`; leave both
  `ticash-app.com` and `www.ticash-app.com` here.
- Dedicated FlupFlap: `flupflap-recharge`, `srv-daushs0jo6nc73ee7ok0`;
  temporary URL `https://flupflap-recharge.onrender.com`.
- API: `https://ticash-api.onrender.com/api`, unchanged.
- Both static services currently auto-deploy main. Review deployment controls
  before merging; merging must not be treated as permission for domain cutover.

## Exact dedicated-service settings

Apply the reviewed `render.flupflap.yaml` settings to the **existing** dedicated
service, not the TiCash service. Do not create a duplicate Blueprint service.
The separate YAML is a configuration specification; existing `render.yaml` is
unchanged. No domains are declared in it, so it cannot detach/attach domains.

| Setting | Value |
| --- | --- |
| Runtime | Static site |
| Repository | `https://github.com/semitrack00-sys/ticash-app-web` |
| Branch after approval | `main` |
| Root directory | repository root |
| Build command | `npm ci && npm run build:flupflap` |
| Publish directory | `dist/flupflap` |
| Auto-deploy during preparation | Off; manually release only after approval |
| API/public flags | Existing `public-config.js`, copied byte-for-byte |
| Secrets/environment credentials | None added to browser/build |

Copy all security headers from the dedicated YAML: restrictive production CSP,
no-referrer, DENY framing, nosniff, COOP, HSTS and Permissions-Policy. All dedicated
paths use `Cache-Control: no-store, max-age=0`, including the root and reset/return
pages. API connect-src remains restricted to the existing production API.

Routes, in order:

1. `/support` and `/support/*` redirect to `https://ticash-app.com/support`.
2. `/send` redirects to `https://ticash-app.com/send`.
3. `/legal/*` redirects to `https://ticash-app.com/legal/*`.
4. `/*` rewrites to `/index.html` for direct FlupFlap return/navigation routes.

The build publishes the approved recharge HTML at `/`, the existing login at
`/login`, and reset at `/reset-password`. It retains `/recharge` and
`/recharge/reset-password` as directly served compatibility aliases for already
issued emails/Stripe return URLs. No redirect is involved in these aliases,
so query parameters and fragments survive. CSS may still use `/recharge/checkout.css`;
this is an asset path, not a required customer route.

The build copies only reachable recharge modules, existing styles and brand
assets. It includes `/route.css`, which checkout.css imports and the previous
ad-hoc copy command omitted. It does not publish the TiCash homepage, admin,
tests, previews, node_modules, environment files, or repository metadata.

## Routing/authentication contract

A build-only `data-recharge-path="/"` marker selects the dedicated root. TiCash
source pages have no marker and retain `/recharge`. No hostname/query parameter
can supply an API or external redirect destination. Login, guest and registration
remain the same FlupFlap API calls. Login/reset navigation retains remaining
query/fragment information; sensitive reset/resume tokens are still stripped
before requests and held only in memory.

Checkout return handling still performs only the existing read-only resume
request. It cannot authorize payment or fulfill recharge. The start-again link
now uses `/` on the dedicated build. Stripe configuration and payment flow are
unchanged. Existing success/cancel and reset URLs continue to work through the
legacy aliases; inventory their exact public paths before cutover without
printing any secrets. If existing return/reset URLs point to TiCash, retain that
compatibility until the later approved legacy redirect is healthy.

Browser Back had an existing ReferenceError from assignments to an undeclared
`handlingPopState`; this PR removes only those two unused assignments. The existing
`show(previous, true, true)` prevents new history entries while handling Back.

The unchanged API client uses credentials: include for FlupFlap. Backend source
uses a production Secure, HttpOnly, SameSite=None refresh cookie scoped to
`/api/flupflap/auth`, with origin validation. No credentials move into browser
storage. Initial missing-cookie restore remains silent. Do not relax browser
cookie controls; verify third-party-cookie behavior on the actual approved
domain/device before release. An in-memory session is not transferable between
website origins; normal reauthentication may be needed.

## Read-only production CORS evidence

OPTIONS `/api/flupflap/auth/refresh`, requesting POST/content-type:

| Origin | HTTP | Allow-Origin | Allow-Credentials |
| --- | --- | --- | --- |
| `https://www.flupflap.com` | 204 | exact origin | true |
| `https://flupflap.com` | 204 | exact origin | true |
| `https://flupflap-recharge.onrender.com` | 403 | absent | absent |
| `https://unapproved.invalid` | 403 | absent | absent |

This proves the preflight policy, not real browser authentication after cutover.
The temporary Render URL must remain denied; use it for static/assets/routing
checks only. Do not interpret its expected API CORS rejection as a reason to
weaken CORS. Local functional tests intercept API responses; no production
account, payment, or recharge was created for testing.

## Reviewed cutover sequence — not executed

1. Review PR diff/results and resolve release blockers below. Record current
   service settings, DNS, domain associations and last-good deployment IDs.
2. Configure/build the dedicated service from the reviewed commit only with
   separate deployment approval. Validate the artifact and temporary URL:
   root/login/reset/legacy paths, JS/CSS/image MIME types, security headers,
   query preservation and no missing assets. Keep existing domains attached.
3. Arrange an operator-controlled low-downtime window and rollback plan. A domain
   cannot be attached to both services concurrently. Do not promise zero downtime:
   association propagation and new TLS issuance can take time.
4. Only after review and static validation, remove **only** the FlupFlap domains
   from the old service and add **www.flupflap.com first** to the dedicated
   service. Render automatically adds the apex redirect to www. Leave both
   TiCash domains untouched.
5. Use Render's displayed DNS instructions: www CNAME to
   `flupflap-recharge.onrender.com`; apex ALIAS/ANAME or Render-provided A record
   as supported by the DNS provider. Review conflicting AAAA/CAA records.
   Verify both domains and wait for issued TLS, not merely DNS verification.
6. On the real canonical domain test login, guest, registration and email reset
   with controlled test accounts; refresh cookie/session expiration; catalog and
   quote only; existing return/resume links; Back/Forward and Android Back;
   no false network/session warnings; unsupported-origin rejection; TiCash
   homepage unchanged. Do not create a Stripe charge or provider purchase.
   Confirm apex redirects preserve path, query and fragment using synthetic
   non-secret values. Real-account/email/device smoke tests remain pending.
7. Only after those pass, activate the legacy TiCash redirect in a separately
   reviewed change. Preserve `/recharge?…` → `https://www.flupflap.com/?…` and
   `/recharge/reset-password?…` → `https://www.flupflap.com/reset-password?…`,
   including fragments. Preserve legacy callback paths on the new host.
   **Do not merely add a Render redirect rule:** Render serves existing files
   before redirect rules, and the old HTML files still exist. Replace just those
   legacy HTML entry points with a fixed-destination redirect shell (external
   self-hosted script using location.replace and retaining search/hash), or use
   an approved edge redirect that takes precedence over static files. Keep
   recharge CSS/assets and all unrelated TiCash routes unchanged. This PR does
   not activate that redirect early.
8. If TLS, routing or auth fails, leave the TiCash recharge entry working and
   roll back domain associations/DNS to the recorded old service. Do not bypass
   CORS/cookie/payment protections. Never announce the new host live until TLS
   and all production smoke checks pass.

References: [Render redirects/rewrites](https://render.com/docs/redirects-rewrites)
and [Render custom domains](https://render.com/docs/custom-domains).

## PR #51 validation (historical; see the build repair audit below)

- Current main baseline `77202755a41897e4bd60ff65b7813ca5ad4b06aa` was fetched,
  checked out separately without changes and merged normally into this branch.
  Baseline: 182 tests, **155 passed / 27 failed**. No skips or cancellations.
  Its registration change requires first name, last name and phone; the domain
  registration test now submits those required fields rather than bypassing them.
- New isolated domain tests cover root build/assets, login/guest/registration,
  reset token stripping, resume aliases/read-only recovery, API credentials,
  provider catalog/quote without payment, browser Back and session restoration.
- Branch: 193 tests, **166 passed / the same 27 baseline failures**; all 11
  domain tests pass. Failure names were compared individually: no new failures.
  No existing tests are skipped, removed or weakened. The additional restore
  regression verifies Error and non-Error rejections log nothing, do not
  authenticate, and leave genuine sign-in/guest actions available.
- Dedicated build, all JavaScript syntax checks, diff-check and Render JSON
  Schema validation pass (AJV draft2020, URI format checked manually).
- Chrome local artifact tests at 390/768/1440px pass login rendering, guest,
  catalog, quote, Back and refresh with no page errors or horizontal overflow.
  Requests are intercepted test fixtures outside the published artifact.
  Screenshots: `op/artifacts/flupflap-domain-login-{390,768,1440}.png` and
  `op/artifacts/flupflap-domain-quote-{390,768,1440}.png` in the local workspace;
  screenshots/debug scripts are not committed or published.
- Main's `npm test` / `npm run check` stop at a stale mobileRechargeLive:false
  assertion; its separate security check rejects a session-restoration console.warn.
  Both are repaired in a separate logical commit on this branch: the site check
  now strictly asserts mobileRechargeLive:true, matching the existing security
  check and explicit production activation commit 18d1548. The other three flags
  still must be false. Public configuration and all backend gates are unchanged.
  The browser warning was removed without changing restoration, error handling,
  authentication or loading state. The security checker is unchanged.
  Branch `npm run check` and `node tools/check-security.mjs` now PASS.
  Branch `npm test` reaches the complete suite and exits nonzero for the 27
  inherited failures. A direct full runner on clean main provides the comparison.
- Both checkouts pass JavaScript syntax checks (main 50, branch 53 files).
  Main has no dedicated build/domain suite; branch build and domain tests pass.
  The generated artifact contains 52 explicitly allowed/reachable production
  files. Source maps, tools, fixtures, admin, environment files, credentials and
  temporary files are excluded; a generated-file secret/fixture scan passes.
- The TiCash homepage, approved HTML/CSS, public API configuration, checkout-flow,
  API client and existing Render configuration are byte-for-byte unchanged from
  current main. Production read-only CORS preflights still allow the apex/www
  FlupFlap origins with credentials and reject the temporary Render origin and
  an unauthorized origin. No domain, DNS, environment or deployment was changed.
- Local evidence: `op/artifacts/domain-current-main-tests.log`,
  `domain-current-pr-npm-test.log`, `domain-current-failures.txt`,
  `domain-current-browser.log` and `domain-production-manifest.json`.
  These verification artifacts are not committed or published.
- Resolve/approve the existing failed release gates separately before cutover.
  No successful production login/registration/reset/cookie/quote smoke test on
  the newly attached canonical service is claimed before domain migration.

## Production build repair audit

PR #51 was already merged when this audit began. The repair branch
`fix/flupflap-production-assets` starts from current main
`795ccf9efa4569021f1d7d2cc8f8bbbc28d3d5c6` and requires a new review.
No deployment, domain/DNS changes or legacy redirect activation were performed.

### Reproduced defects and repairs

- Country flags are runtime URLs (`/flags/${code.toLowerCase()}.svg`), not module
  imports. The dedicated build omitted their source directory. Chrome reproduced
  failed/hidden Jamaica, Canada, Haiti and France flag images; the catch-all
  rewrite can mask a missing image with a successful HTML response.
- The build now copies **all 271 existing flag SVGs plus their license**. No flags,
  countries, operators or coverage are invented. Files match source byte-for-byte.
- Literal HTML/CSS checks missed this computed asset family. The new
  `tools/check-flupflap-assets.mjs` traverses emitted HTML, CSS, SVG and JavaScript
  references, module imports, literal runtime assets, local links and computed
  local asset families. It validates real files, not an SPA fallback response.
  The build itself fails when the crawl finds a broken reference.
- The emitted HTML also inherited an invalid `http://[::1]:*` CSP entry and broad
  development connect sources. Chrome reported the invalid source on every page.
  Only generated HTML is tightened to the existing Render policy:
  `connect-src 'self' https://ticash-api.onrender.com`. Source pages, Render
  headers, CORS and API configuration are unchanged. No security policy relaxed.

### Built artifact and test evidence

- Artifact: **324 production files**; crawler checks **319 referenced files** and
  the computed flags family. No test tools/fixtures, admin, environment files,
  source maps, credentials or temporary files are included. Secret/fixture scan
  passes. Existing official logos, SVG/CSS icons, five translation modules,
  styles and application modules are retained; fonts use the existing Google
  Fonts URLs and CSP permissions.
- Clean current main: **193 tests, 166 pass / 27 fail**.
- Repair: **197 tests, 170 pass / the same 27 fail**, no skips/cancellations.
  All failure names match individually; **zero new failures**.
- Domain/build regressions: **15/15 pass**. Negative tests remove flags, icons,
  styles, JS, translations and route HTML, and add a broken CSS reference; the
  asset gate rejects each. Tests assert every generated page's exact API CSP.
- Site/security checks, all 54 JS/MJS syntax checks, dedicated build, Render
  schema validation and diff check pass. No lint/typecheck scripts are configured.
- `npm test` still exits nonzero for the inherited 27 auth/billing/payment/resume,
  translation and branding test failures. They are not removed, skipped or
  weakened by this packaging repair. This is not a fully green release gate.

### Chrome audit and limits

The browser serves only `dist/flupflap`, with the reviewed production CSP header,
MIME types, strict missing-asset 404s and routing rules. API/Stripe requests are
intercepted outside the repository; no real account, payment or recharge action
is sent. Production Google fonts are actually fetched. Controlled API responses
exercise existing production validation rather than modifying application code.

At **390, 430, 768 and 1440px**, the audit passed, covering login, required registration fields,
password visibility, forgot/reset (root and legacy), guest mode, regional country
flags and all 271 SVG decodes, phone entry, manual operator fallback and automatic
detection, fixed airtime/RANGE amounts, backend-backed DATA/BUNDLE selection and
quotes, billing/review, intercepted hosted Stripe handoff, read-only return/resume
and delivered result, history, saved recipients, Back, refresh and five languages.
No unexpected HTTP errors, failed requests, console errors, page exceptions or
horizontal overflow occurred. The expected logged-out refresh 401 is
excluded from unexpected-failure counts. Support/legal/send links retain
their explicit TiCash redirects.

Local evidence (excluded from commit/build):
- `op/artifacts/domain-flags-before.log`
- `op/artifacts/flupflap-built-audit-results.json` and `flupflap-built-audit.log`
- `op/artifacts/flupflap-repair-flags-{390,430,768,1440}.png`
- `op/artifacts/flupflap-repair-review-{390,430,768,1440}.png`
- `op/artifacts/domain-repair-{main,final}-tests.log`
- `op/artifacts/domain-repair-production-manifest.json`

These checks do not validate real provider coverage, paid fulfillment, email
delivery or canonical-domain cookies/TLS. Do not call this production-ready or
perform domain cutover until inherited release failures are reviewed and the
separately approved deployed smoke tests pass. TiCash homepage, approved UI,
authentication, Stripe, providers and backend pricing are unchanged.
