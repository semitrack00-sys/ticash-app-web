import { initializeLanguage, languageSelector, onLanguageChange, syncLanguageSelectors, translateElements } from './i18n.js';

export function mountLanguageHeader(doc = document) {
  initializeLanguage(doc);
  const header = doc.querySelector('header');
  const picker = header ? languageSelector(doc, 'header-language') : null;
  if (picker) header.append(picker);
  const update = () => { translateElements(doc); syncLanguageSelectors(doc); };
  update();
  const unsubscribe = onLanguageChange(update);
  return () => { unsubscribe(); picker?.remove(); };
}

// Recharge mounts this together with its state-preserving presentation lifecycle.
if (typeof document !== 'undefined' && !document.querySelector('[data-recharge-root]')) mountLanguageHeader(document);
