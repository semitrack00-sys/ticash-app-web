import './language-page.js';
import { getLanguage, onLanguageChange, t } from './i18n.js';
import copy from './home-copy.js';

const bindings = [
  ['.services-intro', 0], ['[data-service-live] .service-status', 1],
  ['.service-grid .service-card:nth-child(3) .service-status', 2],
  ['.flupflap-home-powered > span', 3], ['.connect-copy > p', 4],
  ['[data-service-live] > p', 4], ['.benefit-grid > span:first-child', 5],
  ['.services-cta', 6], ['[data-flupflap-home-details] article:nth-child(1) h3', 7],
  ['[data-flupflap-home-details] article:nth-child(1) p', 8],
  ['.service-grid .service-card:nth-child(3) p', 8],
  ['[data-flupflap-home-details] article:nth-child(2) h3', 9],
  ['[data-flupflap-home-details] article:nth-child(2) p', 10],
  ['[data-flupflap-home-details] article:nth-child(3) h3', 11],
  ['[data-flupflap-home-details] article:nth-child(3) p', 12],
  ['.demo-status', 13], ['.connect-copy > h2', 14],
];
export function translateHome(doc = document) {
  const root = doc.querySelector('#services');
  if (!root?.querySelector('[data-flupflap-home-details]')) return;
  const values = copy[getLanguage()] || copy.en;
  for (const [selector, index] of bindings) {
    const node = root.querySelector(selector);
    if (node) node.textContent = values[index];
  }
  const help = root.querySelector('[data-flupflap-home-details] a');
  if (help) help.textContent = t('support') + ' →';
}
if (typeof document !== 'undefined') { translateHome(); onLanguageChange(() => translateHome()); }
