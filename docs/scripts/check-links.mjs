import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = new URL('https://docs.openshop.run');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    if (entity.startsWith('&#')) {
      const hex = entity[2].toLowerCase() === 'x';
      return String.fromCodePoint(parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
    }
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity];
  });
}

// Astro serializes attributes with quotes. Inspect the rendered output so MDX
// components, sidebar links, and generated heading IDs are checked too.
function attributes(html, name) {
  return [...html.matchAll(new RegExp(`\\b${name}=(['"])(.*?)\\1`, 'gs'))]
    .map((match) => decode(match[2]));
}

function links(html) {
  return [...html.matchAll(/<a\s[^>]*>/g)].flatMap(([tag]) => attributes(tag, 'href'));
}

function routeFor(path) {
  return `/${path}`.replace(/index\.html$/, '');
}

export function checkLinks(directory) {
  const root = resolve(directory);
  const errors = [];
  const pages = new Map();
  for (const file of walk(root).filter((file) => file.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    pages.set(routeFor(relative(root, file)), {
      links: links(html),
      ids: new Set(attributes(html, 'id')),
    });
  }

  function target(href, from) {
    const url = new URL(href, new URL(from, site));
    if (url.origin !== site.origin) return;
    const pathname = decodeURIComponent(url.pathname);
    const route = pathname.replace(/index\.html$/, '');
    const canonical = pages.has(route) ? route : `${route.replace(/\/$/, '')}/`;
    const page = pages.get(canonical);
    if (!page) {
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}/`) || !existsSync(file) || !statSync(file).isFile()) {
        errors.push(`${from}: missing target ${href}`);
      }
      return;
    }
    if (url.hash && !page.ids.has(decodeURIComponent(url.hash.slice(1)))) {
      errors.push(`${from}: missing anchor ${href}`);
    }
    return canonical;
  }

  for (const [route, page] of pages) {
    for (const href of page.links) target(href, route);
  }

  const home = pages.get('/');
  if (!home) errors.push('Missing documentation home page');
  const navigation = new Set((home?.links ?? []).map((href) => target(href, '/')));
  const llmsFile = resolve(root, 'llms.txt');
  const llms = existsSync(llmsFile) ? readFileSync(llmsFile, 'utf8') : '';
  if (!llms) errors.push('Missing llms.txt index');
  const indexed = new Set([...llms.matchAll(/\]\(([^)]+)\)/g)]
    .map(([, href]) => target(href, '/llms.txt')));

  for (const route of pages.keys()) {
    if (route === '/404.html') continue;
    if (route !== '/' && !navigation.has(route)) errors.push(`${route}: missing from home/sidebar navigation`);
    if (!indexed.has(route)) errors.push(`${route}: missing from llms.txt`);
  }

  return { pages: pages.size, errors: [...new Set(errors)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pages, errors } = checkLinks(fileURLToPath(new URL('../dist/', import.meta.url)));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Checked ${pages} pages: internal links, anchors, navigation, and llms.txt are valid.`);
  }
}
