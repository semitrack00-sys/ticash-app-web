# TiCash Website — Final Premium Build

This package is ONLY for the TiCash website.

IMPORTANT:
Do NOT upload/deploy these files to the Semi-Trax repository or the Render service connected to www.semitrax.com.

Correct GitHub repository:
semitrack00-sys/ticash-app-web

Recommended Render service:
ticash-app-web

Render settings:
- Type: Static Site
- Branch: main
- Root Directory: blank
- Build Command: blank
- Publish Directory: ./

The TiCash logo is embedded directly into the HTML for reliable display. Physical logo files are also included at:
- /ticash-logo.png
- /assets/ticash-logo.png

Before launch, connect TiCash to its own domain and keep www.semitrax.com connected only to Semi-Trax.

Final polish includes semantic/accessibility cleanup, focus states, reduced-motion support, and cleaner wallet/store labels.

Final clean pass:
- Brand logos are decorative where the TiCash wordmark is already visible.
- Duplicate TiCash/TiCash extraction is removed.
- Generic image labels are removed from HTML accessibility text.
- Brand links retain a clear TiCash home accessible label.

Added dedicated public pages:
- about.html
- security.html
- privacy.html (expanded)
- terms.html (expanded)

These are development-stage documents and should receive qualified legal/compliance review before regulated money-transfer launch.

## Website and mobile-app links

The public site provides safe fallback pages for:

- `/send`
- `/recharge`
- `/login`
- `/support`
- `/get-ticash`
- `/legal/privacy`
- `/legal/terms`

Android and iOS association files are present but intentionally contain no app association while release identity information is unavailable. This is fail-closed behavior.

Before enabling Android App Links, replace `/.well-known/assetlinks.json` with an entry containing the real Android package name (`com.ticash.app`) and the SHA-256 fingerprint of the production Play/App Signing certificate. Never use a debug certificate for production association.

Before enabling iOS Universal Links, replace the empty `details` list in both Apple association files with the real Apple Team ID and final iOS bundle identifier, then connect `Runner.entitlements` to the restored Xcode project. Do not guess these values.

Both association files must be served directly over HTTPS from `ticash-app.com` and `www.ticash-app.com`, without redirects, with `Content-Type: application/json`. Verify the production responses before publishing the apps.

`public-config.js` contains public availability booleans only. Send Money, Mobile Recharge, Android, and iOS remain Coming Soon by default. Never put provider, database, KYC, payment, or signing secrets in this file or elsewhere in the static website.

Website action analytics use `data-analytics` and the `ticash_web_action` event. Events include only an action name and the public page path; do not add amounts, phone numbers, names, account IDs, KYC status, transaction references, or other sensitive data.

Run the zero-dependency website checks with:

```powershell
npm test
```

The legacy tracked path `ticash-logo.png?v=3` has been removed from the proposed
Git tree. All website references use the cross-platform `/ticash-logo.png` path.
See `PRODUCTION_ACTIVATION_CHECKLIST.md` before enabling verified app links or
publishing either mobile application.
