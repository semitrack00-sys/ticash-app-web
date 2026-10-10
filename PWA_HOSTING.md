# FlupFlap PWA hosting

The existing website stays at `/`. The shared Flutter customer app installs from `/app/`. This integration composes both into the existing `dist/flupflap` output; it does not replace the TiCash site, create another Render service or move a domain.

`tools/pwa-source.json` pins the tested Ticash commit and official Flutter 3.47.1 SDK commit. The build fetches only these fixed repositories/revisions, compiles the same FlupFlap target as the APK/AAB, and stages the public output beneath `/app/`. No API secret, credentials, provider fixtures or Android signing files are included.

Build: `npm ci && npm run build:flupflap:pwa`. Publish path stays `dist/flupflap`. The existing `render.flupflap.yaml` is review-only: applying it to the live service remains a separate release step. Auto-deploy stays off; no domain declarations are added.

Routes for `/app` and `/app/` precede the current catch-all. Flutter uses fragment routing, so internal screens do not need another catch-all. Existing recharge, join, reset-password, support and legal pages remain in the existing build. Their CSP retains its original restrictions. The `/app/*` CSP allows only same-origin workers, same-origin base URLs and WebAssembly compilation; JavaScript eval remains blocked. API access remains restricted to the production API.

Release order:

1. Merge and deploy the companion Ticash PR's API support for `FLUPFLAP_PWA` payment returns.
2. Merge this hosting PR and update only the existing FlupFlap static service's build command/routes/headers to the reviewed configuration.
3. Verify HTTPS `/app/`, MIME types, installation and cookie session behavior on actual iPhone/Safari and Android/Chrome. Test approved sandbox card Checkout, cancel/return and duplicate-payment protection before inviting customers to transact.
4. Share `https://www.flupflap.com/app/`. iPhone users use Safari Share → Add to Home Screen. Android users can use the browser install prompt.

Local validation: 264 existing website tests and 3 new staging/security tests passed. The actual compiled PWA was staged into the existing website output. Companion app validation includes release compilation, Flutter regression tests, backend checks and fixture-only Chromium offline/checkout-return checks. No production website or API was changed.
