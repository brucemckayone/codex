/**
 * Self-test for check-e2e-ports.mjs (Codex-1yd58 WP-11): every planted
 * hardcoded port is caught, the default app port AND each SERVICE_PORTS
 * value, the lookalikes are not, the one helper is exempt by PATH (not by
 * name) and from the default port only, the port list is READ from the
 * constants file, and a wrong tree or constants file fails instead of passing.
 *
 *   node --test apps/web/scripts/check-e2e-ports.test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PORT,
  ORIGIN_FILE,
  parseServicePorts,
  SERVICE_PORTS_FILE,
  scanSource,
} from './check-e2e-ports.mjs';

const SCRIPT = fileURLToPath(new URL('./check-e2e-ports.mjs', import.meta.url));
const P = DEFAULT_PORT;

const ORIGIN = `const DEFAULT_BASE_URL = 'http://lvh.me:${P}';\nexport const E2E_BASE_URL = DEFAULT_BASE_URL;\n`;
const CLEAN_SPEC = `import { E2E_BASE_URL } from './helpers/origin';\nawait page.goto(E2E_BASE_URL);\n`;

// The shape of packages/constants/src/urls.ts: a shared port, trailing and
// own-line comments (one naming an entry-like `OLD: 9999`), and another
// constant after the block whose number is not a service port. The first
// line is urls.ts's own hazard: a `/*` inside a LINE comment, which a
// block-comments-first strip opens and runs to the `*/` inside the block,
// eating AUTH through MEDIA.
const CONSTANT_LINES = [
  '// Hostnames: `routes[].pattern` in workers/*/wrangler.jsonc.',
  "export const DEV_HOST = 'http://localhost'; // not a port",
  'export const SERVICE_PORTS = {',
  '  AUTH: 42069,',
  '  CONTENT: 4001,',
  '  ACCESS: 4001, // Shares CONTENT worker deployment',
  '  ORGANIZATION: 42071,',
  '  ECOMMERCE: 42072,',
  '  MEDIA: 4002, // Media API worker port',
  '  // A stub, NOT a worker (was OLD: 9999 before WP-3).',
  '  /* MOVED: 9998 */',
  '  MOCK_RUNPOD: 4101,',
  '} as const;',
  '',
  'export const DOMAINS = { PROD: 8443 };',
];
const CONSTANTS = `${CONSTANT_LINES.join('\n')}\n`;

/** The planted SERVICE_PORTS values. */
const WORKER_PORTS = [...parseServicePorts(CONSTANTS).keys()];

let base;
let root;
let constants;

function plant(files) {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

function run(args = ['--root', root, '--constants', constants]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'e2e-ports-'));
  root = join(base, 'e2e');
  constants = join(base, 'urls.ts');
  writeFileSync(constants, CONSTANTS);
  plant({ [ORIGIN_FILE]: ORIGIN, 'clean.spec.ts': CLEAN_SPEC });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('parseServicePorts', () => {
  test('reads each port with every name that holds it, and nothing else', () => {
    assert.deepEqual(Object.fromEntries(parseServicePorts(CONSTANTS)), {
      42069: ['AUTH'],
      4001: ['CONTENT', 'ACCESS'],
      42071: ['ORGANIZATION'],
      42072: ['ECOMMERCE'],
      4002: ['MEDIA'],
      4101: ['MOCK_RUNPOD'],
    });
  });

  test('reads nothing without the block', () => {
    assert.equal(parseServicePorts('export const X = { A: 1 };\n').size, 0);
  });

  test('reads the real SERVICE_PORTS', () => {
    const real = parseServicePorts(readFileSync(SERVICE_PORTS_FILE, 'utf8'));
    assert.deepEqual(real.get('42069'), ['AUTH']);
    assert.ok(real.size >= 5, `${real.size} port(s)`);
  });
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

  test('finds every worker port on a line, each once', () => {
    const hits = scanSource('f(42069, 4001, 42069);', WORKER_PORTS);
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].ports, ['42069', '4001']);
  });

  test('ignores worker-port lookalikes', () => {
    for (const text of [
      '420690',
      '142069',
      'id_42069',
      '42069px',
      'a1b2c3d4-4001-4e5f-8a9b-0c1d2e3f4a5b',
      'v1.4001',
      '$4002',
      '41010',
    ]) {
      assert.deepEqual(scanSource(text, WORKER_PORTS), [], text);
    }
  });
});

describe('check-e2e-ports CLI', () => {
  test('a clean tree passes', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK: no hardcoded port in 2 e2e file/);
    assert.match(r.out, /none of 6 SERVICE_PORTS value/);
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
    test(`catches the default port in ${name}`, () => {
      plant({ [rel]: `// line one\n${text}\n` });
      const r = run();
      assert.equal(r.code, 1, r.out);
      assert.ok(r.out.includes(`e2e/${rel}:2  [the default port]`), r.out);
      assert.match(r.out, /1 hardcoded port\(s\)/);
    });
  }

  // Each as the sweep found it before helpers/workers.ts.
  for (const [name, rel, text, labels] of [
    [
      'a sign-in URL',
      'helpers/seed.ts',
      "await request.post('http://localhost:42069/api/auth/sign-in/email');",
      ['SERVICE_PORTS.AUTH'],
    ],
    [
      'a cookie-host constant',
      'fixtures/auth.ts',
      "const AUTH_WORKER_URL = 'http://lvh.me:42069';",
      ['SERVICE_PORTS.AUTH'],
    ],
    [
      'a skip message',
      'e.spec.ts',
      "test.skip(true, 'Ecom worker not running on port 42072');",
      ['SERVICE_PORTS.ECOMMERCE'],
    ],
    [
      'a port and name pair',
      'subscription/f.spec.ts',
      "for (const [port, name] of [[42071, 'organization-api']]) {",
      ['SERVICE_PORTS.ORGANIZATION'],
    ],
    [
      'an IPv4 host on a shared port',
      'g.spec.ts',
      "await fetch('http://127.0.0.1:4001/api/content');",
      ['SERVICE_PORTS.CONTENT / SERVICE_PORTS.ACCESS'],
    ],
    [
      'two workers in a comment',
      'h.spec.ts',
      ' * Needs auth (42069) and media (4002) running.',
      ['SERVICE_PORTS.AUTH', 'SERVICE_PORTS.MEDIA'],
    ],
    [
      'the stub',
      'helpers/runpod.ts',
      "const STUB = 'http://localhost:4101';",
      ['SERVICE_PORTS.MOCK_RUNPOD'],
    ],
    [
      'a README',
      'README.md',
      'Start the auth worker on :42069 first.',
      ['SERVICE_PORTS.AUTH'],
    ],
  ]) {
    test(`catches a worker port in ${name}`, () => {
      plant({ [rel]: `// line one\n${text}\n` });
      const r = run();
      assert.equal(r.code, 1, r.out);
      assert.ok(r.out.includes(`e2e/${rel}:2  [`), r.out);
      for (const label of labels) assert.ok(r.out.includes(label), r.out);
      assert.match(r.out, /1 hardcoded port\(s\)/);
    });
  }

  test('the origin helper is exempt from the default port only', () => {
    plant({
      [ORIGIN_FILE]: `${ORIGIN}export const AUTH = 'http://lvh.me:42069';\n`,
    });
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.ok(
      r.out.includes(`e2e/${ORIGIN_FILE}:3  [SERVICE_PORTS.AUTH]`),
      r.out
    );
    assert.ok(!r.out.includes(`e2e/${ORIGIN_FILE}:1`), r.out);
    assert.match(r.out, /1 hardcoded port\(s\)/);
  });

  test('worker-port lookalikes pass', () => {
    plant({
      'ids.spec.ts': [
        "const id = 'a1b2c3d4-4001-4e5f-8a9b-0c1d2e3f4a5b';",
        'const n = 420690 + 142069;',
        "const w = '42069px';",
      ].join('\n'),
    });
    const r = run();
    assert.equal(r.code, 0, r.out);
  });

  test('the port list is read from the constants file, not a list here', () => {
    plant({ 'm.spec.ts': "fetch('http://localhost:8025/api/v2/messages');\n" });
    assert.equal(run().code, 0, 'no MAILHOG in the planted constants yet');
    writeFileSync(
      constants,
      CONSTANTS.replace('  AUTH: 42069,', '  AUTH: 42069,\n  MAILHOG: 8025,')
    );
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.ok(
      r.out.includes('e2e/m.spec.ts:1  [SERVICE_PORTS.MAILHOG]'),
      r.out
    );
  });

  test('skips node_modules and binary files', () => {
    plant({
      'node_modules/x/index.js': `const p = ${P}; const a = 42069;`,
      'shots/a.png': `PNG ${P} 4001`,
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

  test('a missing constants file fails', () => {
    const r = run(['--root', root, '--constants', join(base, 'nope.ts')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no file at .*nope\.ts/);
  });

  test('a constants file without SERVICE_PORTS fails', () => {
    writeFileSync(constants, 'export const DOMAINS = { PROD: 8443 };\n');
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer defines SERVICE_PORTS \(0 port name/);
  });

  test('a SERVICE_PORTS without AUTH fails', () => {
    writeFileSync(constants, CONSTANTS.replace('  AUTH: 42069,\n', ''));
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /AUTH not among them/);
  });

  test('a SERVICE_PORTS with too few ports fails', () => {
    writeFileSync(
      constants,
      'export const SERVICE_PORTS = {\n  AUTH: 42069,\n} as const;\n'
    );
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\(1 port name\(s\) read, AUTH among them\)/);
  });

  test('a missing directory fails', () => {
    const r = run(['--root', join(root, 'nope'), '--constants', constants]);
    assert.equal(r.code, 1, r.out);
  });

  test('an unknown argument is a usage error', () => {
    const r = run(['--bogus']);
    assert.equal(r.code, 2, r.out);
  });

  test('a flag without its value is a usage error', () => {
    const r = run(['--root', root, '--constants']);
    assert.equal(r.code, 2, r.out);
  });

  test('the real e2e tree passes against the real SERVICE_PORTS', () => {
    const r = run([]);
    assert.equal(r.code, 0, r.out);
  });
});
