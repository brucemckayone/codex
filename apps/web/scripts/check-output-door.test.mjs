/**
 * Tests for the output-door gate (Codex-1yd58 WP-2).
 *
 * node:test rather than vitest, as for the other check:* gates: the thing
 * under test is a plain `.mjs` CLI. Wired via `pnpm --filter web run
 * check:output-door:test` and a self-test step in static_analysis.yml.
 *
 * Every form the WP-2 reviews named is planted: the plain, wrapped, `gl!.`,
 * `gl?.`, cast, `undefined`, numeric and DRAW_ forms must fire; comments,
 * READ_FRAMEBUFFER and a real framebuffer must not; and a `/*` in a line
 * comment, a string or a regex must not hide the code after it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  blankComments,
  collectViolations,
  scanSource,
} from './check-output-door.mjs';

const GATE = fileURLToPath(new URL('./check-output-door.mjs', import.meta.url));

/** The lines of `source` where the gate finds a raw null bind. */
const lines = (source, name = 'renderer.ts') => {
  const result = scanSource(name, source);
  assert.equal(result.unscannable, null, `scannable: ${result.unscannable}`);
  return result.violations.map((v) => v.line);
};

describe('a raw null bind fires', () => {
  const forms = {
    plain: 'gl.bindFramebuffer(gl.FRAMEBUFFER, null);',
    wrapped: 'gl.bindFramebuffer(\n  gl.FRAMEBUFFER,\n  null\n);',
    'wrapped, trailing comma':
      'gl.bindFramebuffer(\n  gl.FRAMEBUFFER,\n  null,\n);',
    'non-null receiver': 'gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);',
    'optional receiver': 'gl?.bindFramebuffer(gl?.FRAMEBUFFER, null);',
    'optional call': 'gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);',
    cast: '(gl as WebGL2RenderingContext).bindFramebuffer((gl as WebGL2RenderingContext).FRAMEBUFFER, null);',
    'destructured constant': 'gl.bindFramebuffer(FRAMEBUFFER, null);',
    undefined: 'gl.bindFramebuffer(gl.FRAMEBUFFER, undefined);',
    'void 0': 'gl.bindFramebuffer(gl.FRAMEBUFFER, void 0);',
    'cast null':
      'gl.bindFramebuffer(gl.FRAMEBUFFER, null as unknown as WebGLFramebuffer);',
    'hex enum': 'gl.bindFramebuffer(0x8d40, null);',
    'decimal enum': 'gl.bindFramebuffer(36160, null);',
    DRAW_FRAMEBUFFER: 'gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);',
    'DRAW enum': 'gl.bindFramebuffer(0x8CA9, null);',
    // A null as one branch: bindOutput's own idiom, written by hand.
    'nullish branch':
      'gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);',
    'ternary branch':
      'gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : fbo);',
    'or branch': 'gl.bindFramebuffer(gl.FRAMEBUFFER, fbo || null);',
  };
  for (const [name, call] of Object.entries(forms)) {
    test(name, () => {
      assert.deepEqual(lines(`const a = 1;\n${call}\n`), [2]);
    });
  }
});

describe('what is allowed', () => {
  const allowed = {
    'a real framebuffer': 'gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);',
    'the output door': 'bindOutput(gl);',
    READ_FRAMEBUFFER: 'gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);',
    'READ enum': 'gl.bindFramebuffer(0x8CA8, null);',
    'a line comment': '// gl.bindFramebuffer(gl.FRAMEBUFFER, null);',
    'a block comment': '/* gl.bindFramebuffer(gl.FRAMEBUFFER, null); */',
    'a JSDoc block':
      '/**\n * Never `gl.bindFramebuffer(gl.FRAMEBUFFER, null)`.\n */',
    'a string mention': "const note = 'bindFramebuffer';",
    'a target named like null': 'gl.bindFramebuffer(gl.FRAMEBUFFER, nullFbo);',
    // Legal code the tokenizer once read as a regex start (and failed).
    'a division after a postfix !': 'const half = w! / 2;',
    'a division after a postfix ++': 'let i = 0;\ni++ / 2;',
    'a division after a postfix --': 'let i = 0;\ni-- / 2;',
    'a division after a call': 'const q = f(x) / 2;',
    // A property named like a keyword is a name: what follows its call divides.
    'a division after Symbol.for(...)': 'const q = Symbol.for(k) / 2;',
    'a division after obj.if(...)': 'const q = obj.if(a) / 2;',
    // ... and so is one named like `new` or `delete`: it divides.
    'a division after a property named new': 'const half = sizes.new / 2;',
  };
  for (const [name, source] of Object.entries(allowed)) {
    test(name, () => {
      assert.deepEqual(lines(source), []);
    });
  }
});

describe('nothing hides the code after it', () => {
  const bind = 'gl.bindFramebuffer(gl.FRAMEBUFFER, null);';
  const hiders = {
    'a glob in a line comment': '// matches lib/*.ts files',
    'a block opener in a string': "const s = '/* not a comment';",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text; its ${} is what is tested
    'a block opener in a template': 'const s = `/* ${x} not a comment`;',
    'a quote in a regex': "const r = /'/g;",
    'a block opener in a regex': 'const r = /\\/\\*/;',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text; its ${} is what is tested
    'a nested template': 'const s = `a ${cond ? `b` : `c`} d`;',
    'a division': 'const half = width / 2; const q = a / b;',
    // A regex starting a statement after a condition's `)`.
    'a regex after if (...)': 'if (s) /\\/*x/.test(s);',
    'a regex after while (...)': 'while (s) /\\/*x/.test(s);',
    // `!` after a keyword is the prefix not, so a regex follows.
    'a regex after return !': 'function f(s) { return !/\\/*x/.test(s); }',
    // A postfix then a division: a phantom regex here would end at the
    // comment's `/` and leave its `/*` open.
    'a postfix ! then a division': 'const r = w! / h; // see /* note',
    'a postfix ++ then a division': 'let i = 0; const r = i++ / 2; // a /* b',
    'a property call then a division':
      'const r = arr.with(i, v) / 2; // a /* b',
    'a keyword-named property then a division':
      'const r = opts.delete / 2; // a /* b',
    'a regex after for await (...)':
      'for await (const s of xs) /\\/*x/.test(s);',
  };
  for (const [name, hider] of Object.entries(hiders)) {
    test(name, () => {
      // A later block comment gives a phantom `/*` something to run on to.
      assert.deepEqual(
        lines(`${hider}\n${bind}\n/* a later comment */\n`),
        [2]
      );
    });
  }
});

describe('svelte files', () => {
  test('reads the script, with true line numbers', () => {
    const source = [
      '<!--',
      '  Mentions gl.bindFramebuffer(gl.FRAMEBUFFER, null) in prose.',
      '-->',
      '<script lang="ts">',
      '  const x = 1;',
      '  gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);',
      '</script>',
      "<p>The org's name, and don't stop.</p>",
    ].join('\n');
    assert.deepEqual(lines(source, 'ShaderHero.svelte'), [6]);
  });

  test('markup and an HTML comment are not code', () => {
    const source =
      "<!-- gl.bindFramebuffer(gl.FRAMEBUFFER, null) -->\n<p>it's fine</p>\n<script>\nconst a = 1;\n</script>";
    assert.deepEqual(lines(source, 'Thing.svelte'), []);
  });

  // A script is raw text up to </script>: a `<!--` in it opens nothing. The
  // first .svelte pass blanked HTML comments across the whole file first, so
  // this hid the script and reported the file clean.
  for (const [name, opener] of Object.entries({
    'a <!-- in a script comment':
      '  // keeps the <!-- marker out of the markup',
    'a <!-- in a script string': "  const OPEN = '<!--';",
  })) {
    test(`${name} does not hide the script`, () => {
      const source = [
        '<script lang="ts">',
        opener,
        '  gl.bindFramebuffer(gl.FRAMEBUFFER, null);',
        '</script>',
        '<!-- the canvas -->',
        '<canvas></canvas>',
      ].join('\n');
      assert.deepEqual(lines(source, 'ShaderHero.svelte'), [3]);
    });
  }

  test('a complete <!-- --> pair in a script string is text too', () => {
    const source =
      "<script>\nconst s = '<!-- x -->';\ngl.bindFramebuffer(gl.FRAMEBUFFER, null);\n</script>";
    assert.deepEqual(lines(source, 'Thing.svelte'), [3]);
  });

  // A `<!--` that Svelte reads as text ABOVE the script (an attribute value,
  // a markup string) must not swallow it: the second hand-written reader did,
  // and reported the file clean. Svelte's own parser reads it.
  for (const [name, markup] of Object.entries({
    'a <!-- in an attribute above the script': '<p title="<!--">x</p>',
    'a <!-- in a markup expression above the script': "<p>{'<!--'}</p>",
    'a <script> in an attribute above the script': '<p title="<script>">x</p>',
  })) {
    test(`${name} does not hide it`, () => {
      const source = [
        markup,
        '<script>',
        '  gl.bindFramebuffer(gl.FRAMEBUFFER, null);',
        '</script>',
        '<!-- note -->',
      ].join('\n');
      assert.deepEqual(lines(source, 'Thing.svelte'), [3]);
    });
  }

  test('reads legal Svelte 5 the old reader failed: generics, a <Script /> component, module + instance', () => {
    const source = [
      '<script module lang="ts">',
      '  export const m = 1;',
      '</script>',
      '<script lang="ts" generics="T extends Record<string, number>">',
      "  import Script from './Script.svelte';",
      '  gl.bindFramebuffer(gl.FRAMEBUFFER, null);',
      '</script>',
      '<Script />',
    ].join('\n');
    assert.deepEqual(lines(source, 'Thing.svelte'), [6]);
  });

  test('a style block is not code, and a <!-- in it opens nothing', () => {
    const source =
      '<style>\n  /* <!-- */ .a { color: red; }\n</style>\n<script>\ngl.bindFramebuffer(gl.FRAMEBUFFER, null);\n</script>';
    assert.deepEqual(lines(source, 'Thing.svelte'), [5]);
  });
});

describe('fails closed', () => {
  test('a file left inside a string cannot be scanned', () => {
    const result = scanSource(
      'broken.ts',
      "const s = 'never closed\ngl.bindFramebuffer(gl.FRAMEBUFFER, null);"
    );
    assert.match(result.unscannable ?? '', /string/);
  });

  test('a file left inside a block comment cannot be scanned', () => {
    assert.equal(blankComments('/* open').open, 'block comment');
  });

  test('the reason names the line the open thing started on', () => {
    const result = scanSource('broken.ts', 'const a = 1;\nconst r = /never;\n');
    assert.match(result.unscannable ?? '', /regex opened at line 2/);
  });

  test('a .svelte file Svelte cannot parse cannot be scanned', () => {
    for (const source of [
      '<script>\nconst a = 1;\n',
      '<script>\nconst a = ;\n</script>',
    ]) {
      const result = scanSource('Broken.svelte', source);
      assert.match(result.unscannable ?? '', /Svelte cannot parse it/);
    }
  });

  test('blanking keeps the length and every newline', () => {
    const source = 'a /* x\ny */ b // z\nc';
    const { code } = blankComments(source);
    assert.equal(code.length, source.length);
    assert.equal(code.split('\n').length, source.split('\n').length);
  });
});

describe('the tree scan', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'output-door-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const write = (rel, content) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const bind = 'gl.bindFramebuffer(gl.FRAMEBUFFER, null);\n';

  test('exempts the door, tests and __tests__, and finds the rest', () => {
    write('output-target.ts', bind);
    write('__tests__/x.test.ts', bind);
    write('renderers/y.test.ts', bind);
    write('renderers/bad-renderer.ts', `// first\n${bind}`);
    const { violations, filesScanned } = collectViolations({ heroDir: root });
    assert.deepEqual(
      violations.map((v) => `${v.file}:${v.line}`),
      ['renderers/bad-renderer.ts:2']
    );
    assert.equal(filesScanned, 1);
  });

  test('the CLI exits 1 on a violation and 0 on a clean tree', () => {
    write('output-target.ts', 'export function bindOutput() {}\n');
    write('renderers/ok-renderer.ts', 'bindOutput(gl);\n');
    const clean = spawnSync(process.execPath, [GATE, '--root', root], {
      encoding: 'utf8',
    });
    assert.equal(clean.status, 0, clean.stderr);
    write('renderers/bad-renderer.ts', bind);
    const dirty = spawnSync(process.execPath, [GATE, `--root=${root}`], {
      encoding: 'utf8',
    });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /ShaderHero\/renderers\/bad-renderer\.ts:1/);
  });

  test('the CLI exits 1 on a tree with no door: the sources moved', () => {
    // A clean tree without output-target.ts is the wrong tree: OK there
    // would mean the gate read nothing that renders.
    write('renderers/ok-renderer.ts', 'bindOutput(gl);\n');
    const run = spawnSync(process.execPath, [GATE, '--root', root], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no output-target\.ts/);
  });

  test('the CLI exits 2 on an unknown argument', () => {
    const run = spawnSync(process.execPath, [GATE, '--bogus'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 2);
  });
});
