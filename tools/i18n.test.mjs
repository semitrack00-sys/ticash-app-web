import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { countryFlag, searchCountries } from '../js/recharge.js';
import { translations, translate, detectLanguage, initializeLanguage, setLanguage, getLanguage, localizeCountry, translateElements } from '../js/i18n.js';
import { countries } from './fixtures.mjs';

test('flags are local regional indicators with strict ASCII ISO-style validation', () => {
  for (const [code, flag] of [['HT','🇭🇹'],['ht','🇭🇹'],['JM','🇯🇲'],['CA','🇨🇦'],['FR','🇫🇷'],['BR','🇧🇷']]) assert.equal(countryFlag(code), flag);
  for (const code of ['', 'H1', 'HTI', ' H', 'éé', 'KR', '<b>', null, undefined, 12, {}, ['HT']]) assert.equal(countryFlag(code), '');
});
test('every language has every canonical key and matching substitution parameters', () => {
  const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [language, catalog] of Object.entries(translations)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(translations.en).sort(), language);
    for (const [key, text] of Object.entries(catalog)) {
      assert.equal(typeof text, 'string'); assert.ok(text.trim(), `${language}.${key}`);
      assert.doesNotMatch(text, /<\/?[a-z][^>]*>/i);
      assert.deepEqual(params(text), params(translations.en[key]), `${language}.${key}`);
    }
  }
});
test('English fallback handles missing translations and absent or unknown messages safely', () => {
  assert.equal(translate('signIn', {}, 'fr', { fr: {} }), 'Sign in');
  assert.equal(translate('signIn', {}, 'xx'), 'Sign in');
  assert.equal(translate(null), ''); assert.equal(translate(undefined), '');
  assert.equal(translate('PROVIDER_ERROR_CODE'), 'PROVIDER_ERROR_CODE');
  assert.equal(translate('quoteUntil', { date: '$& <b>date</b>' }, 'en'), 'Quote valid until $& <b>date</b>');
});
test('saved preference precedes supported regional browser languages and English fallback', () => {
  assert.equal(detectLanguage(), 'en'); assert.equal(detectLanguage(null, ['ja-JP']), 'en');
  for (const code of ['fr-CA','fr-FR','ht-HT','es-MX','es-US','pt-BR','pt-PT']) assert.equal(detectLanguage(null, [code]), code.slice(0,2));
  assert.equal(detectLanguage('ht', ['fr-CA']), 'ht');
  assert.equal(detectLanguage('xx', ['ja', 'es-MX']), 'es');
});
test('only language preference persists and unavailable storage remains optional', () => {
  const dom = new JSDOM('', { url: 'https://website.example' });
  try {
    const writes = []; const storage = dom.window.localStorage;
    dom.window.Storage.prototype.setItem = function(key, value) { writes.push([key,value]); };
    Object.defineProperty(dom.window.navigator, 'languages', { value: ['fr-CA'] });
    initializeLanguage(dom.window.document); assert.equal(getLanguage(), 'fr'); assert.deepEqual(writes, []);
    setLanguage('ht'); assert.deepEqual(writes, [['ticash.language','ht']]); assert.equal(dom.window.document.documentElement.lang, 'ht');
    Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('blocked'); } });
    initializeLanguage(dom.window.document); assert.doesNotThrow(() => setLanguage('pt')); assert.equal(getLanguage(),'pt');
    assert.equal(storage.length, 0);
  } finally { initializeLanguage(); dom.window.close(); }
});
test('localized countries retain backend identity with safe unsupported-Intl fallback', () => {
  const haiti = Object.freeze({ code:'HT', name:'Haiti', callingCode:'+509' });
  for (const [code,name] of [['en','Haiti'],['ht','Ayiti'],['fr','Haïti'],['es','Haití'],['pt','Haiti']]) assert.equal(localizeCountry(haiti,code),name);
  const original = Intl.DisplayNames;
  try { Intl.DisplayNames = undefined; assert.equal(localizeCountry(haiti,'fr'),'Haiti'); assert.equal(localizeCountry(haiti,'ht'),'Ayiti'); }
  finally { Intl.DisplayNames = original; }
  assert.equal(localizeCountry({code:'?',name:'<img src=x>'},'fr'),'<img src=x>');
  assert.deepEqual(haiti,{code:'HT',name:'Haiti',callingCode:'+509'});
});
test('initialization honors saved language without persisting additional browser state', () => {
  const dom = new JSDOM('', { url:'https://website.example' });
  try {
    dom.window.localStorage.setItem('ticash.language','pt');
    Object.defineProperty(dom.window.navigator,'languages',{value:['fr-CA']});
    initializeLanguage(dom.window.document);assert.equal(getLanguage(),'pt');assert.equal(dom.window.document.documentElement.lang,'pt');
    assert.equal(dom.window.localStorage.length,1);assert.equal(dom.window.sessionStorage.length,0);
  } finally { initializeLanguage();dom.window.close(); }
});
test('localized and backend names, accents, ISO, calling code and flag search preserve separate destinations', () => {
  for (const language of Object.keys(translations)) {
    for (const term of ['Haiti','Haïti','Haití','Ayiti','HT','509','+509','🇭🇹']) assert.deepEqual(searchCountries(countries,term,language).map(c=>c.code),['HT']);
    assert.deepEqual(searchCountries(countries,'+1',language).map(c=>c.code),['JM','CA']);
  }
});
test('DOM translation and interpolation use text, never executable markup', () => {
  const dom = new JSDOM('<p data-i18n="&lt;img src=x onerror=alert(1)&gt;"></p>');
  translateElements(dom.window.document);
  assert.equal(dom.window.document.querySelector('p').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(dom.window.document.querySelector('img'),null); dom.window.close();
});
test('all local model and API validation/error literals have canonical translations', () => {
  const english = new Set(Object.values(translations.en));
  for (const path of ['js/recharge.js','js/api-client.js']) {
    const source = readFileSync(path,'utf8');
    const messages = [...source.matchAll(/(?:new ApiError\('[^']+',\s*|throw invalid\()'([^']+)'/g)];
    assert.ok(messages.length > 5);
    for (const [,message] of messages) assert.ok(english.has(message), message);
  }
});
