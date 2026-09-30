import en from './translations/en.js';
import ht from './translations/ht.js';
import fr from './translations/fr.js';
import es from './translations/es.js';
import pt from './translations/pt.js';
import ar from './translations/ar.js';
import de from './translations/de.js';
import it from './translations/it.js';
import hi from './translations/hi.js';
import zh from './translations/zh.js';
import ja from './translations/ja.js';
import ko from './translations/ko.js';
import ru from './translations/ru.js';
import tr from './translations/tr.js';
import sw from './translations/sw.js';
import bn from './translations/bn.js';
import id from './translations/id.js';
import vi from './translations/vi.js';
import th from './translations/th.js';
import ur from './translations/ur.js';
import fa from './translations/fa.js';
import pl from './translations/pl.js';
import nl from './translations/nl.js';
import el from './translations/el.js';
import uk from './translations/uk.js';
import fil from './translations/fil.js';
import ms from './translations/ms.js';

export const translations = Object.freeze({ en, ht, fr, es, pt, ar, de, it, hi, zh, ja, ko, ru, tr, sw, bn, id, vi, th, ur, fa, pl, nl, el, uk, fil, ms });
const languages = Object.freeze([
  { code: 'en', name: 'English', locale: 'en-US' },
  { code: 'ht', name: 'Kreyòl Ayisyen', locale: 'ht-HT' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
  { code: 'ar', name: 'العربية', locale: 'ar' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'hi', name: 'हिन्दी', locale: 'hi-IN' },
  { code: 'zh', name: '简体中文', locale: 'zh-CN' },
  { code: 'ja', name: '日本語', locale: 'ja-JP' },
  { code: 'ko', name: '한국어', locale: 'ko-KR' },
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'tr', name: 'Türkçe', locale: 'tr-TR' },
  { code: 'sw', name: 'Kiswahili', locale: 'sw-KE' },
  { code: 'bn', name: 'বাংলা', locale: 'bn-BD' },
  { code: 'id', name: 'Bahasa Indonesia', locale: 'id-ID' },
  { code: 'vi', name: 'Tiếng Việt', locale: 'vi-VN' },
  { code: 'th', name: 'ไทย', locale: 'th-TH' },
  { code: 'ur', name: 'اردو', locale: 'ur-PK' },
  { code: 'fa', name: 'فارسی', locale: 'fa-IR' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL' },
  { code: 'el', name: 'Ελληνικά', locale: 'el-GR' },
  { code: 'uk', name: 'Українська', locale: 'uk-UA' },
  { code: 'fil', name: 'Filipino', locale: 'fil-PH' },
  { code: 'ms', name: 'Bahasa Melayu', locale: 'ms-MY' },
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
  if (doc) {
    doc.documentElement.lang = language;
    doc.documentElement.dir = ['ar','ur','fa'].includes(language) ? 'rtl' : 'ltr';
  }
}
export function supportedLanguages() { return languages; }
export function getLanguage() { return language; }
export function languageLocale() { return languages.find((item) => item.code === language).locale; }
export function setLanguage(code) {
  language = supported(code) || 'en';
  if (languageDocument) {
    languageDocument.documentElement.lang = language;
    languageDocument.documentElement.dir = ['ar','ur','fa'].includes(language) ? 'rtl' : 'ltr';
  }
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
