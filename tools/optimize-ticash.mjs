import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://www.ticash-app.com';
const pages = {
  'index.html': ['/', 'TiCash | Support family in Haiti', 'Learn about TiCash, a service in development for supporting family in Haiti through money transfers and mobile connectivity. Explore our plans and contact our team.'],
  'about.html': ['/about.html', 'About TiCash | Built for the Haitian diaspora', 'Learn about TiCash and our mission to help the Haitian diaspora support family and loved ones in Haiti.'],
  'security.html': ['/security.html', 'TiCash Security | Account protection and service readiness', 'Learn about TiCash account protection, responsible integrations, and the approvals required before money-transfer services launch.'],
  'privacy.html': ['/privacy.html', 'TiCash Privacy Policy', 'Read the TiCash privacy policy and learn how to contact our team about personal information and privacy questions.'],
  'terms.html': ['/terms.html', 'TiCash Terms of Service', 'Read the TiCash terms of service, product availability information, and contact details.'],
};
const mimeExtensions = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg', 'x-icon': 'ico' };
const escapeAttribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

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
  for (const [path, details] of Object.entries(pages)) {
    const source = await readFile(join(root, path), 'utf8');
    const output = optimizeHtml(source, details);
    outputs.push({ path, source, ...output });
  }
  for (const { path, source, html, assets } of outputs) {
    for (const [url, asset] of assets) await writeFile(join(root, url.slice(1)), asset.bytes);
    await writeFile(join(root, path), html);
    report.push({ page: path, before: Buffer.byteLength(source), after: Buffer.byteLength(html), extractedImages: assets.size });
  }
  console.log('TiCash static optimization:', JSON.stringify(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
