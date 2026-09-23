# Country flags and languages

The shared header and the complete recharge/account interface support English (`en`), Haitian Creole (`ht`), French (`fr`), Spanish (`es`) and Portuguese (`pt`). Marketing and legal page body copy remains in its original language; their shared navigation and language controls use the selected language.

## Translation architecture

`js/i18n.js` owns language selection, plain-text translation, country display names and locale selection. The five dictionaries in `js/translations/` share stable keys; English is canonical and is the fallback for missing translations. Existing English website error messages also resolve to those keys, so the API client and recharge model do not need translated state or changed error handling. Unknown server messages and raw error codes pass through as text.

Add a dictionary and a language entry in `i18n.js` to introduce another language. Keep the English keys and named interpolation parameters identical. Tests reject missing/empty keys, mismatched parameters and HTML tags. Use `t(key, params)` for dynamic text and `data-i18n`, `data-i18n-aria-label`, `data-i18n-placeholder` or `data-i18n-title` for static labels. Render with text nodes or textContent, never an HTML parser. Do not translate operator/product names, user-entered names, identifiers, raw status/error codes, currencies or request values.

The header and checkout selectors use language names, not flags. Switching updates `html.lang`, labels, accessibility text, country options, hints, errors, quote/receipt/history presentation and Intl money/date formatting. Form controls stay mounted, preserving focus and password visibility. The render-only listener does not call authentication or recharge APIs, renew a session, request a quote or submit a confirmation. Amounts and fee totals come directly from the existing backend response.

## Preference and country display

Selection priority is the saved preference, the first supported browser language, then English. Regional tags such as `fr-CA` and `pt-BR` resolve to the supported base language. Only an explicit selection writes `localStorage['ticash.language']`. Storage failures are nonfatal. Tokens remain solely in the existing API-client closure; no passwords, customer data, phones, quotes or transactions are persisted. The security checker excludes all other scripts from browser storage and checks the two allowed preference operations.

`countryFlag(code)` in `js/recharge.js` converts two ASCII letters to Unicode regional indicators, accepting lowercase and rejecting malformed input. It needs no asset, package, network request or country map. Glyph appearance depends on the operating system/font: systems without combined flag glyphs may show the two regional letters. Country names and calling codes remain present for that fallback.

`localizeCountry` uses supported `Intl.DisplayNames` region data, with the backend name as a plain-text fallback. The only Creole override is `HT: Ayiti`. Display names never replace the backend country object, ISO value or calling code. Search matches original and localized names, accent-folded text, ISO, calling code and flag. Names from all five languages remain searchable after switching, so an existing filter such as “Ayiti” continues to work. Shared `+1` countries remain separate ISO destinations.

## Validation

Run the existing repository commands:

```text
npm ci --ignore-scripts
npm test
npm run check
npm audit
```

Tests use local deterministic fixtures, with no real payment or provider calls. Coverage includes dictionary parity/fallback, language detection/storage, flags/search, separate shared-calling-code countries, localized hints, account and guest state preservation, registration/password controls, unresolved confirmation/idempotency, safe provider text and the existing authentication, phone, quote, sandbox and fee regressions. The backend-authoritative $5.00 recharge + $3.50 fee = $8.50 example remains covered.

Browser smoke checks use a separate loopback-only fixture server. Verify desktop and mobile selectors, all five languages, the selected destination and phone, quote preservation and keyboard focus. No backend, Render configuration, deployment, payment mode, API contract or live-mode flag is changed by this feature.
