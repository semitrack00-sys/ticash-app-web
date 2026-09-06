# TiCash website-to-app production activation checklist

Nothing in this checklist is an authorization to publish an app, activate a
financial provider, or enable real-money movement. Complete and independently
review every applicable item before changing the fail-closed configuration.

## Public website and domain

- [ ] Confirm `ticash-app.com` and `www.ticash-app.com` are controlled by TiCash.
- [ ] Install and verify a valid HTTPS certificate for both hosts.
- [ ] Deploy `/send`, `/recharge`, `/login`, and `/support` as ordinary public
      fallback pages that work when the app is not installed.
- [ ] Serve `/.well-known/assetlinks.json` and
      `/.well-known/apple-app-site-association` directly over HTTPS, without an
      authentication challenge or redirect, and with `Content-Type:
      application/json`.
- [ ] Serve `/apple-app-site-association` under the same requirements if the
      production host keeps the root compatibility copy.
- [ ] Confirm all public availability flags in `public-config.js` remain false
      until the corresponding service or store listing is actually available.

## Android App Links

- [ ] Confirm the final Android application ID. The current development value
      is `com.ticash.app`; do not assume it is final without release review.
- [ ] Enroll/configure the app in Google Play and identify whether Play App
      Signing is used.
- [ ] Obtain the SHA-256 fingerprint from the real production app-signing
      certificate. Do not use a debug certificate and do not fabricate a value.
- [ ] Replace the empty array in `/.well-known/assetlinks.json` with a valid
      `delegate_permission/common.handle_all_urls` statement containing the
      reviewed application ID and production SHA-256 fingerprint.
- [ ] Keep the Android manifest limited to HTTPS, the two official hosts, and
      the reviewed public paths.
- [ ] On a release-signed physical-device build, verify link status with
      `adb shell pm get-app-links <application-id>`.
- [ ] Test both installed and not-installed behavior for
      `https://www.ticash-app.com/send` and
      `https://www.ticash-app.com/recharge`.

## iOS Universal Links

- [ ] Restore/confirm the complete iOS Xcode project and Runner target.
- [ ] Confirm the final iOS bundle identifier; do not invent it.
- [ ] Obtain the Apple Team ID from the enrolled Apple Developer account.
- [ ] Attach `Runner/Runner.entitlements` to the Runner target using the
      `CODE_SIGN_ENTITLEMENTS` build setting.
- [ ] Replace the empty `applinks.details` list in both Apple association files
      with the reviewed `<TEAM_ID>.<BUNDLE_ID>` application identifier and only
      the intended `/send`, `/send/`, `/recharge`, `/recharge/`, `/login`,
      `/login/`, `/support`, and `/support/` components.
- [ ] Validate the deployed association response on a physical iOS device using
      a release-signed build.

## Store destinations

- [ ] Add the Google Play URL only after the listing is published and verified.
- [ ] Add the App Store URL only after the listing is published and verified.
- [ ] Until then, keep Get TiCash, Send Money, and Mobile Recharge in their
      existing Coming Soon state; do not invent store URLs.

## Authentication and safety

- [ ] Verify a signed-out deep link preserves only the allowlisted local path,
      completes sign-in, then opens the intended screen for an authorized user.
- [ ] Verify arbitrary URLs, protocol-relative URLs, query-injected redirects,
      and authenticated transaction URLs are rejected.
- [ ] Verify backend KYC, entitlement, corridor, and authorization checks remain
      authoritative after every deep link.
- [ ] Keep Reloadly in Sandbox, payments in mock mode, and
      `APPROVED_FOR_LIVE_USE=false` until separate production approvals are
      complete.
- [ ] Run website tests, Flutter analyzer/tests, release configuration review,
      and a repository secret scan immediately before release.
