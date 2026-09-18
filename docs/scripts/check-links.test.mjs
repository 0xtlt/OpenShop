import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkLinks } from './check-links.mjs';

function fixture(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'openshop-docs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return directory;
}

test('resolves rendered links, encoded anchors, queries, and static files', (t) => {
  const directory = fixture(t, {
    'index.html': '<a href="/guide/#caf%C3%A9">Guide</a><a href="/file.txt">File</a>',
    'guide/index.html': '<h2 id="café">Title</h2><a href="?a=1&amp;b=2#caf%C3%A9">Here</a><a href="../">Home</a><a href="https://example.com/">External</a>',
    'file.txt': 'asset',
    '404.html': '<a href="/">Home</a>',
    'llms.txt': '[Home](https://docs.openshop.run/)\n[Guide](https://docs.openshop.run/guide)',
  });
  assert.deepEqual(checkLinks(directory), { pages: 3, errors: [] });
});

test('reports broken pages, missing anchors, unlisted pages, and stale llms links', (t) => {
  const directory = fixture(t, {
    'index.html': '<a href="/missing/">Missing</a><a href="/guide/#missing">Bad anchor</a>',
    'guide/index.html': '<h2 id="exists">Title</h2>',
    'orphan/index.html': '<p>Unlisted</p>',
    'llms.txt': '[Home](https://docs.openshop.run/)\n[Old](https://docs.openshop.run/old/)',
  });
  const { errors } = checkLinks(directory);
  for (const expected of [
    '/: missing target /missing/',
    '/: missing anchor /guide/#missing',
    '/llms.txt: missing target https://docs.openshop.run/old/',
    '/orphan/: missing from home/sidebar navigation',
    '/guide/: missing from llms.txt',
  ]) assert.ok(errors.includes(expected), expected);
});
