/**
 * Self-test for check-e2e-ports.mjs (Codex-1yd58 WP-11): every planted
 * hardcoded port is caught, the lookalikes are not, the one helper is
 * exempt by PATH (not by name), and a wrong tree fails instead of passing.
 *
 *   node --test apps/web/scripts/check-e2e-ports.test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT, ORIGIN_FILE, scanSource } from './check-e2e-ports.mjs';

const SCRIPT = fileURLToPath(new URL('./check-e2e-ports.mjs', import.meta.url));
const P = DEFAULT_PORT;

const ORIGIN = `const DEFAULT_BASE_URL = 'http://lvh.me:${P}';\nexport const E2E_BASE_URL = DEFAULT_BASE_URL;\n`;
const CLEAN_SPEC = `import { E2E_BASE_URL } from './helpers/origin';\nawait page.goto(E2E_BASE_URL);\n`;

let root;

function plant(files) {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

function run(args = ['--root', root]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'e2e-ports-'));
  plant({ [ORIGIN_FILE]: ORIGIN, 'clean.spec.ts': CLEAN_SPEC });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanSource', () => {
  test('finds the port standing alone, 1-based lines', () => {
    const hits = scanSource(`a\nconst PORT = ${P};\n`);
    assert.deepEqual(
      hits.map((h) => h.line),
      [2]
    );
  });

  test('ignores longer numbers, words and UUID groups', () => {
    for (const text of [
      `1${P}`,
      `${P}0`,
      `id_${P}`,
      `x${P}y`,
      `a1b2c3d4-${P}-4e5f`,
      `v1.${P}`,
      `$${P}`,
    ]) {
      assert.deepEqual(scanSource(text), [], text);
    }
  });
});

describe('check-e2e-ports CLI', () => {
  test('a clean tree passes', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK: no hardcoded default port in 2 e2e file/);
  });

  for (const [name, rel, text] of [
    ['a URL', 'a.spec.ts', `await page.goto('http://lvh.me:${P}/');`],
    [
      'a template URL',
      'page-kit/b.spec.ts',
      `x(\`http://studio-alpha.lvh.me:${P}/studio\`);`,
    ],
    ['a port constant', 'helpers/studio.ts', `const BASE_PORT = ${P};`],
    ['a host fallback', 'helpers/sub.ts', `const host = h || 'lvh.me:${P}';`],
    [
      'an Origin header',
      'helpers/auth.ts',
      `headers: { Origin: 'http://lvh.me:${P}' }`,
    ],
    ['a comment', 'c.spec.ts', ` * SvelteKit dev server on lvh.me:${P}`],
    ['a JSON fixture', 'fixtures/d.json', `{ "url": "http://lvh.me:${P}" }`],
    ['a README', 'README.md', `Run against port ${P}.`],
    [
      'an origin.ts elsewhere',
      'page-kit/origin.ts',
      `export const B = 'http://lvh.me:${P}';`,
    ],
  ]) {
    test(`catches ${name}`, () => {
      plant({ [rel]: `// line one\n${text}\n` });
      const r = run();
      assert.equal(r.code, 1, r.out);
      assert.ok(r.out.includes(`e2e/${rel}:2`), r.out);
      assert.match(r.out, /1 hardcoded default port\(s\)/);
    });
  }

  test('skips node_modules and binary files', () => {
    plant({
      'node_modules/x/index.js': `const p = ${P};`,
      'shots/a.png': `PNG ${P}`,
    });
    const r = run();
    assert.equal(r.code, 0, r.out);
  });

  test('a tree without the helper fails as the wrong tree', () => {
    rmSync(join(root, ORIGIN_FILE));
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no helpers\/origin\.ts/);
  });

  test('a helper that no longer names the default fails as the wrong tree', () => {
    plant({ [ORIGIN_FILE]: 'export const E2E_BASE_URL = process.env.X;\n' });
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer names the default port/);
  });

  test('a missing directory fails', () => {
    const r = run(['--root', join(root, 'nope')]);
    assert.equal(r.code, 1, r.out);
  });

  test('an unknown argument is a usage error', () => {
    const r = run(['--bogus']);
    assert.equal(r.code, 2, r.out);
  });

  test('the real e2e tree passes', () => {
    const r = run([]);
    assert.equal(r.code, 0, r.out);
  });
});
