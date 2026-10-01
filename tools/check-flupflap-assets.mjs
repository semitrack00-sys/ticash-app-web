import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const assetExtension = /\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|json)(?:[?#].*)?$/i;
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);

// Crawl the emitted files, including JS-created images and computed asset families.
// An SPA fallback returning index.html does not count as an existing asset.
export function checkFlupflapAssets(output = resolve(repository, 'dist/flupflap'), source = repository) {
  output = resolve(output); source = resolve(source);
  const required = new Set(); const families = new Set(); const external = new Set();
  const missing = new Set(); const links = new Set();
  const localPath = (url, owner) => {
    if (!url || url.startsWith('#') || /^(?:data:|mailto:|tel:)/i.test(url)) return null;
    const parsed = new URL(url, 'https://artifact.invalid/' + owner);
    if (parsed.origin !== 'https://artifact.invalid') { external.add(parsed.href); return null; }
    return decodeURIComponent(parsed.pathname).replace(/^\//, '');
  };
  const requireFile = path => {
    required.add(path);
    const target = resolve(output, path);
    if (!target.startsWith(output + sep) || !existsSync(target) || !statSync(target).isFile()) missing.add(path);
  };
  const asset = (url, owner) => { const path = localPath(url, owner); if (path) requireFile(path); };
  const link = (url, owner) => { const path = localPath(url, owner); if (path !== null) links.add(path); };

  for (const file of walk(output)) {
    const owner = relative(output, file).split(sep).join('/');
    if (!/\.(?:html|css|js|mjs|svg)$/.test(owner)) continue;
    const text = readFileSync(file, 'utf8');
    if (/\.(?:html|svg)$/.test(owner)) {
      for (const [, tag, attrs] of text.matchAll(/<([a-z][\w:-]*)\b([^>]+)>/gi)) {
        for (const [, attribute, value] of attrs.matchAll(/\b(src|href|poster|xlink:href)\s*=\s*["']([^"']+)["']/gi)) {
          if (tag.toLowerCase() === 'a' && attribute === 'href') link(value, owner);
          else asset(value, owner);
        }
        for (const [, value] of attrs.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
          for (const candidate of value.split(',')) asset(candidate.trim().split(/\s+/)[0], owner);
        }
      }
    }
    if (/\.(?:html|css)$/.test(owner)) {
      for (const [, doubleQuoted, singleQuoted, bare] of text.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g)) asset(doubleQuoted || singleQuoted || bare, owner);
      for (const [, url] of text.matchAll(/@import\s+["']([^"']+)["']/g)) asset(url, owner);
    }
    if (/\.(?:js|mjs)$/.test(owner)) {
      for (const [, url] of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) asset(url, owner);
      for (const [, url] of text.matchAll(/["']((?:\/|\.\/|\.\.\/)[^"'\r\n]+)["']/g)) {
        if (assetExtension.test(url)) asset(url, owner);
      }
      for (const [, url] of text.matchAll(/href\s*:\s*["']([^"']+)["']/g)) link(url, owner);
      for (const [, template] of text.matchAll(/`((?:\/|\.\/|\.\.\/)[^`]+)`/g)) {
        if (!template.includes('${') || !assetExtension.test(template)) continue;
        const pattern = template.replace(/\$\{[^}]+\}/g, '*');
        const wildcard = pattern.indexOf('*');
        const slash = pattern.lastIndexOf('/', wildcard);
        const familyUrl = pattern.slice(0, slash + 1);
        const family = localPath(familyUrl, owner);
        if (!family) throw new Error('External computed assets require explicit review: ' + owner);
        const directory = resolve(source, family);
        if (!directory.startsWith(source + sep) || !existsSync(directory)) throw new Error('Missing asset source family: ' + family);
        const suffix = pattern.slice(slash + 1).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        const matches = walk(directory).filter(path => new RegExp('^' + suffix + '$').test(relative(directory, path).split(sep).join('/')));
        if (!matches.length) throw new Error('Empty asset source family: ' + pattern);
        families.add(pattern);
        for (const path of matches) requireFile(relative(source, path).split(sep).join('/'));
      }
    }
  }
  // Send/legal intentionally leave FlupFlap through reviewed Render redirects.
  // Support is now a first-class page in the dedicated build and must exist locally.
  const render = readFileSync(resolve(source, 'render.flupflap.yaml'), 'utf8');
  for (const path of links) {
    if (/^(?:send|legal\/.*)$/.test(path)) {
      const prefix = path.split('/')[0];
      if (!render.includes('source: /' + prefix) || !render.includes('destination: https://ticash-app.com/' + prefix)) missing.add('redirect:/' + path);
    } else if (assetExtension.test(path)) requireFile(path);
    else requireFile((path ? path.replace(/\/$/, '') + '/' : '') + 'index.html');
  }
  if (missing.size) throw new Error('Broken FlupFlap assets/links:\n' + [...missing].sort().join('\n'));
  return { required: [...required].sort(), families: [...families].sort(), external: [...external].sort(), links: [...links].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkFlupflapAssets();
  console.log(`FlupFlap assets/links PASS: ${result.required.length} files, ${result.families.length} computed families`);
}
