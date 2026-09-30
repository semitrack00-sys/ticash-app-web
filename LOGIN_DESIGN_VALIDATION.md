# Final FlupFlap login design verification

## Scope

The shared logged-out `/login` and `/recharge` presentation implements the approved final reference. The official PNG logo is reused with its old embedded caption clipped in CSS. The new caption is localized: **Powered by TiCash-App**. The compact phone/checkmark/three-icon illustration uses CSS crops of the existing production `flupflap-login-phone-globe-mobile.png`; no screenshot is embedded as the page and no raster asset was modified.

The same existing form elements and authentication callbacks handle sign-in, registration, recovery, password visibility and guest entry. The guest button still calls `authenticate('guest')`, then the existing FlupFlap guest endpoint through the unchanged API client. Support remains `/support`. All 27 language catalogs include the new text. Authenticated recharge CSS, API endpoints, configuration, tokens, payment, provider and database behavior are unchanged. Only the redundant signed-out “Secure recharge / Sign in to continue” banner is hidden; authenticated test-mode indicators remain unchanged.

## Visual/browser verification

- Actual headless Edge rendering at 360, 390, 412, 430, 768 and 1440 CSS pixels: no horizontal overflow; local logo assets load.
- Screenshots captured at 390 and 430 and compared beside the supplied reference.
- All 27 languages checked at 390px: fields and Guest/Create Account buttons remain within the viewport, including RTL.
- Browser interaction checks: sign-in with Enter, Show/Hide, forgot-password submission, existing guest endpoint, registration submission, Support navigation and language switching pass.
- All API responses in browser interaction tests were intercepted locally; no production credentials, authentication, payment or provider request was sent.
- Differences from the raster reference: reused repository artwork has its existing phone perspective/glow; interactive fields/buttons retain usable touch sizes. No device frame or bottom feature section is added.

Screenshots and local capture scripts are kept outside the repository, under the workspace `artifacts` directory, and are not production dependencies.

## Validation and inherited main failures

Baseline: `origin/main` at `e6e55f5` (PR #35 merge), tested independently in an untouched detached worktree.

| Check | Result |
| --- | --- |
| Dependency install / audit | PASS, 0 vulnerabilities |
| Authentication + login tests | 30 passed, 0 failed |
| Login tests specifically | 13 passed, 0 failed (4 new cases) |
| Full direct Node suite on branch | 168 total: 145 passed, 23 failed |
| Full direct Node suite on untouched main | 164 total: 141 passed, same 23 failed |
| `npm test` / `npm run check` | BLOCKED by unchanged main site assertion described below |
| Security check | PASS |
| JavaScript syntax checks | PASS |
| `git diff --check` | PASS |

`tools/check-site.mjs` requires `mobileRechargeLive: false` while main's `public-config.js` sets it to `true`. Both files are unchanged. The identical 23 direct-suite failure names were compared between this branch and untouched main; no new failure is introduced. Existing failures concern Stripe/receipt/billing expectations, sandbox-vs-live fixtures, one missing canonical error translation, and the old assertion of five languages after main added 27.

These failures are not skipped, suppressed, or repaired by changing production/payment behavior in this visual-only PR. The repository-wide checks are **not green** and need a separate investigation before merge approval. No build/lint script is configured in package.json; this is a static site and the configured checks plus syntax validation were run.

No merge or deployment was performed.
