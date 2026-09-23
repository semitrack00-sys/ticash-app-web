import en from './translations/en.js';
import ht from './translations/ht.js';
import fr from './translations/fr.js';
import es from './translations/es.js';
import pt from './translations/pt.js';

export const translations = Object.freeze({ en, ht, fr, es, pt });
const languages = Object.freeze([
  { code: 'en', name: 'English', locale: 'en-US' },
  { code: 'ht', name: 'Kreyòl Ayisyen', locale: 'ht-HT' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
].map(Object.freeze));
const englishKeys = new Map(Object.entries(en).map(([key, value]) => [value, key]));
const listeners = new Set();
let language = 'en';
let preferenceStorage;
let languageDocument;

function supported(code) {
  const base = typeof code === 'string' ? code.trim().toLowerCase().split('-')[0] : '';
  return languages.some((item) => item.code === base) ? base : undefined;
}
export function detectLanguage(saved, browserLanguages = []) {
  return supported(saved) || browserLanguages.map(supported).find(Boolean) || 'en';
}
export function initializeLanguage(doc = globalThis.document) {
  languageDocument = doc;
  let saved;
  preferenceStorage = undefined;
  try {
    preferenceStorage = doc?.defaultView?.localStorage;
    saved = preferenceStorage?.getItem('ticash.language');
  } catch { /* Storage may be blocked; language switching still works in memory. */ }
  language = detectLanguage(saved, doc?.defaultView?.navigator?.languages || []);
  if (doc) doc.documentElement.lang = language;
}
export function supportedLanguages() { return languages; }
export function getLanguage() { return language; }
export function languageLocale() { return languages.find((item) => item.code === language).locale; }
export function setLanguage(code) {
  language = supported(code) || 'en';
  if (languageDocument) languageDocument.documentElement.lang = language;
  try { preferenceStorage?.setItem('ticash.language', language); } catch { /* Nonessential preference. */ }
  for (const listener of listeners) listener();
}
export function onLanguageChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

// English phrases are aliases for stable keys, including existing local error messages.
export function translate(key, params = {}, code = language, catalogs = translations) {
  if (key === undefined || key === null) return '';
  const resolved = Object.hasOwn(en, key) ? key : englishKeys.get(key);
  const value = resolved ? catalogs[code]?.[resolved] || en[resolved] : String(key);
  return value.replace(/\{(\w+)\}/g, (match, name) => params[name] == null ? match : String(params[name]));
}
export const t = (key, params) => translate(key, params);

const creoleCountries = Object.freeze({ HT: 'Ayiti' });
const displayNames = new Map();
export function localizeCountry(country, code = language) {
  const fallback = typeof country?.name === 'string' ? country.name : String(country?.code || '');
  if (!/^[A-Z]{2}$/.test(country?.code)) return fallback;
  if (code === 'ht' && creoleCountries[country.code]) return creoleCountries[country.code];
  try {
    if (!Intl.DisplayNames || !Intl.DisplayNames.supportedLocalesOf([code]).length) return fallback;
    if (!displayNames.has(code)) displayNames.set(code, new Intl.DisplayNames([code], { type: 'region', fallback: 'none' }));
    return displayNames.get(code).of(country.code) || fallback;
  } catch { return fallback; }
}

export function translateElements(root) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    for (const node of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)));
    }
  }
}
export function languageSelector(doc, id) {
  const label = doc.createElement('label'); label.className = 'language-picker'; label.htmlFor = id;
  const caption = doc.createElement('span'); caption.dataset.i18n = 'language'; caption.textContent = t('language');
  const select = doc.createElement('select'); select.id = id; select.dataset.languageSelector = '';
  select.dataset.i18nAriaLabel = 'language'; select.setAttribute('aria-label', t('language'));
  for (const item of languages) {
    const option = doc.createElement('option'); option.value = item.code; option.textContent = item.name; option.lang = item.code;
    select.append(option);
  }
  select.value = language; select.addEventListener('change', () => setLanguage(select.value));
  label.append(caption, select);
  return label;
}
export function syncLanguageSelectors(doc) {
  for (const select of doc.querySelectorAll('[data-language-selector]')) select.value = language;
}
