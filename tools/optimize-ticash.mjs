import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://www.ticash-app.com';
const pages = {
  'index.html': ['/', 'TiCash & FlupFlap Recharge | Worldwide mobile recharge', 'Send mobile airtime and supported data plans worldwide with FlupFlap Recharge, powered by TiCash App. Availability varies by country and operator. TiCash money transfers to Haiti are in development.'],
  'about.html': ['/about.html', 'About TiCash | Built for the Haitian diaspora', 'Learn about TiCash and our mission to help the Haitian diaspora support family and loved ones in Haiti.'],
  'security.html': ['/security.html', 'TiCash Security | Account protection and service readiness', 'Learn about TiCash account protection, responsible integrations, and the approvals required before money-transfer services launch.'],
  'privacy.html': ['/privacy.html', 'TiCash Privacy Policy', 'Read the TiCash privacy policy and learn how to contact our team about personal information and privacy questions.'],
  'terms.html': ['/terms.html', 'TiCash Terms of Service', 'Read the TiCash terms of service, product availability information, and contact details.'],
};
const mimeExtensions = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg', 'x-icon': 'ico' };
const escapeAttribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function brandHomepage(html) {
  if (html.includes('data-flupflap-home-brand')) return html;
  const anchor = '<div class="connect-copy">';
  if (html.split(anchor).length !== 2) throw new Error('Expected one homepage recharge feature');
  const lockup = `<div class="flupflap-home-lockup" data-flupflap-home-brand>
    <div class="flupflap-home-product"><img src="/assets/flupflap-home-logo.png" alt="FlupFlap" width="2172" height="724" loading="lazy" decoding="async"><span>Recharge</span></div>
    <div class="flupflap-home-powered"><span>Powered by</span><strong>TiCash App</strong></div>
  </div>`;
  return html.replace(anchor, anchor + '\n' + lockup)
    .replace('Explore Mobile Recharge</a>', 'Explore FlupFlap Recharge</a>')
    .replace('</head>', '<link rel="stylesheet" href="/flupflap-home.css">\n</head>');
}

export function updateRechargeContent(html) {
  const sectionPattern = /<section\b[^>]*\bid=["']services["'][^>]*>[\s\S]*?<\/section>/i;
  if (!sectionPattern.test(html)) throw new Error('Missing homepage services section');
  return html.replace(sectionPattern, section => {
    section = section.replace(/<p class="services-intro">[\s\S]*?<\/p>/, '<p class="services-intro">FlupFlap Recharge connects family and friends worldwide with mobile airtime and supported data plans. Availability varies by country and operator. TiCash money transfers to Haiti are still being prepared.</p>');
    section = section.replace(/<article\b[^>]*>[\s\S]*?<\/article>/g, article => {
      if (/<h3>Mobile Recharge<\/h3>/.test(article)) {
        return article.replace('<article class="service-card">', '<article class="service-card" data-service-live>')
          .replace('COMING SOON', 'AVAILABLE NOW')
          .replace('<h3>Mobile Recharge</h3>', '<h3>FlupFlap Recharge</h3>')
          .replace(/<p>[\s\S]*?<\/p>/, '<p>Send mobile airtime worldwide with FlupFlap. Choose a supported country and operator, enter the phone number, and review your total before paying.</p>');
      }
      if (/<h3>Internet &amp; Data Plans<\/h3>/.test(article)) {
        article = article.replace('COMING SOON', 'CHECK AVAILABILITY')
          .replace(/<p>[\s\S]*?<\/p>/, '<p>Browse supported data bundles. Plan duration, allowance, and availability depend on the destination and mobile operator.</p>');
        if (!article.includes('href="/recharge"')) article = article.replace('</article>', '<a class="service-link" href="/recharge">Browse plans <span aria-hidden="true">→</span></a></article>');
      }
      return article;
    });
    section = section.replace(/(<div class="connect-copy">[\s\S]*?<p>)[\s\S]*?(<\/p>)/, '$1Send airtime and supported mobile data plans worldwide with FlupFlap Recharge, powered by TiCash App. Select your destination country and operator to see the options available for that phone number.$2')
      .replace('<span>🇭🇹 Built for Haiti</span>', '<span>🌍 Worldwide recharge</span>')
      .replace('Explore FlupFlap Recharge</a>', 'Start FlupFlap Recharge</a>')
      .replace('<span class="demo-label">MOBILE RECHARGE</span>', '<span class="demo-label">FLUPFLAP RECHARGE</span>')
      .replace('<span class="demo-status">COMING SOON</span>', '<span class="demo-status">ILLUSTRATION</span>');
    if (!section.includes('data-flupflap-home-details')) {
      section = section.replace('</section>', `<div class="flupflap-home-details" data-flupflap-home-details aria-label="Before you recharge">
        <article><span class="flupflap-detail-number">01</span><h3>Airtime or data</h3><p>Choose mobile credit or an available data bundle. Check the phone number, operator, plan allowance, and duration carefully.</p></article>
        <article><span class="flupflap-detail-number">02</span><h3>Clear before you pay</h3><p>Review the recharge price, applicable service fee, and total at checkout. Your final quote shows the amount you will pay.</p></article>
        <article><span class="flupflap-detail-number">03</span><h3>Delivery &amp; support</h3><p>Payment confirmation and recharge delivery are separate steps. Follow the transaction status; delivery timing depends on the operator.</p><a href="/support/">Contact support <span aria-hidden="true">→</span></a></article>
      </div></section>`);
    }
    return section;
  });
}

export function optimizeHtml(source, details) {
  if (!/<head\b[^>]*>/i.test(source) || !/<\/head\s*>/i.test(source)) throw new Error('Missing HTML head');
  const assets = new Map();
  let html = source.replace(/data:image\/(png|jpeg|jpg|webp|gif|svg\+xml|x-icon);base64,([A-Za-z0-9+/]+={0,2})/g, (original, mime, encoded) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('Invalid embedded image encoding');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `/assets/ticash-optimized/${hash}.${mimeExtensions[mime]}`;
    assets.set(path, { bytes, original });
    return path;
  });
  // Verify a lossless substitution before applying head-only metadata changes.
  let restored = html;
  for (const [path, asset] of assets) restored = restored.split(path).join(asset.original);
  if (restored !== source) throw new Error('Image substitution changed source unexpectedly');
  const body = html.match(/<body\b[\s\S]*$/i)?.[0];
  if (!body) throw new Error('Missing HTML body');
  const [route, title, description] = details;
  html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, head => {
    head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
    head = head.replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? '' : tag);
    head = head.replace(/<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*["'](?:description|og:(?:title|description|url|type|image)|twitter:(?:card|title|description|image))["']/i.test(tag) ? '' : tag);
    const url = ORIGIN + route;
    const tags = [
      `<title>${escapeAttribute(title)}</title>`,
      `<meta name="description" content="${escapeAttribute(description)}">`,
      `<link rel="canonical" href="${url}">`,
      '<meta property="og:type" content="website">',
      `<meta property="og:title" content="${escapeAttribute(title)}">`,
      `<meta property="og:description" content="${escapeAttribute(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${ORIGIN}/ticash-logo.png">`,
      '<meta name="twitter:card" content="summary">',
      `<meta name="twitter:title" content="${escapeAttribute(title)}">`,
      `<meta name="twitter:description" content="${escapeAttribute(description)}">`,
      `<meta name="twitter:image" content="${ORIGIN}/ticash-logo.png">`,
    ];
    return head.replace(/\s*<\/head\s*>/i, tags.join('\n') + '\n</head>');
  });
  if (html.match(/<body\b[\s\S]*$/i)?.[0] !== body) throw new Error('Metadata changed the page body');
  if (Buffer.byteLength(html) > 256 * 1024) throw new Error('Optimized marketing HTML remains larger than 256 KiB');
  return { html, assets };
}

export async function build(root = process.cwd()) {
  const assetsDir = join(root, 'assets/ticash-optimized');
  await mkdir(assetsDir, { recursive: true });
  const report = [];
  // Stage and validate every page before writing any HTML.
  const outputs = [];
  const publicConfig = await readFile(join(root, 'public-config.js'), 'utf8');
  const rechargeLive = /mobileRechargeLive:\s*true\b/.test(publicConfig);
  for (const [path, details] of Object.entries(pages)) {
    const source = await readFile(join(root, path), 'utf8');
    const output = optimizeHtml(source, details);
    if (path === 'index.html') {
      output.html = brandHomepage(output.html);
      if (rechargeLive) output.html = updateRechargeContent(output.html);
      if (!output.html.includes('/js/home-language.js')) output.html = output.html.replace('</body>', '<script type="module" src="/js/home-language.js"></script>\n</body>');
    }
    outputs.push({ path, source, ...output });
  }
  await copyFile(join(root, 'brand/flupflap/ChatGPT Image Sep 24, 2026, 09_49_40 PM.png'), join(root, 'assets/flupflap-home-logo.png'));
  for (const { path, source, html, assets } of outputs) {
    for (const [url, asset] of assets) await writeFile(join(root, url.slice(1)), asset.bytes);
    await writeFile(join(root, path), html);
    report.push({ page: path, before: Buffer.byteLength(source), after: Buffer.byteLength(html), extractedImages: assets.size });
  }
  console.log('TiCash static optimization:', JSON.stringify(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
