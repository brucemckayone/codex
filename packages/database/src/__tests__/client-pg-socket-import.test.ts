/**
 * pg's import SHAPE across client.ts and hyperdrive-client.ts (Codex-s1i7h)
 *
 * Both invariants were paid for on PR #487's first CI run (33893639869):
 *
 * 1. client.ts must have NO static pg / node-postgres import at module
 *    scope, and must dynamically import './hyperdrive-client'. A static
 *    import lands in the built dist and evaluates pg in EVERY consumer —
 *    `env.test` workers and vitest suites with no Hyperdrive binding — where
 *    pg's CJS `require('events')` resolves to a stub whose EventEmitter is
 *    undefined and `class Query extends EventEmitter` throws
 *    "Class extends value undefined is not a constructor or null". That
 *    killed organization-service.test.ts and the e2e auth worker at import
 *    time.
 *
 * 2. hyperdrive-client.ts must STATICALLY import BOTH
 *    `drizzle-orm/node-postgres` and `pg`. The bare `pg` reference is a
 *    bundling side effect: measured with `wrangler deploy --env production
 *    --dry-run` on workers/organization-api, static imports in this
 *    dynamically-imported file yield `cloudflare:sockets` (wrangler's `net`
 *    polyfill, pg's transport) in the bundle, while inline dynamic
 *    `import('pg')` in client.ts yields pg's protocol code but NO transport
 *    — a bundle that looks complete and cannot connect.
 *
 * Assertions run on comment-stripped source: a presence check on raw source
 * passes happily when the line has merely been commented out.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLIENT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../client.ts'
);

/** Strip block and line comments so a commented-out import cannot pass. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The text before the first function/export declaration — module scope. */
function moduleScope(code: string): string {
  const cut = code.search(/^export (async )?function /m);
  return cut === -1 ? code : code.slice(0, cut);
}

describe('pg import shape (client.ts + hyperdrive-client.ts)', () => {
  const clientSource = readFileSync(CLIENT_PATH, 'utf-8');
  const hyperSource = readFileSync(
    CLIENT_PATH.replace('client.ts', 'hyperdrive-client.ts'),
    'utf-8'
  );
  const viteSource = readFileSync(
    CLIENT_PATH.replace('src/client.ts', 'vite.config.database.ts'),
    'utf-8'
  );
  const clientCode = stripComments(clientSource);
  const hyperCode = stripComments(hyperSource);

  it('client.ts has no STATIC pg or node-postgres import at module scope', () => {
    expect(
      /^\s*import\s+[^;]*['"](pg|drizzle-orm\/node-postgres)['"];?\s*$/m.test(
        moduleScope(clientCode)
      ),
      "client.ts must not statically import 'pg' or 'drizzle-orm/node-postgres' — the built dist carries it into every consumer, and pg's CJS 'events' require throws 'Class extends value undefined' in vitest and env.test workers (PR #487, run 33893639869). Delegate via dynamic import('./hyperdrive-client')."
    ).toBe(false);
  });

  it("client.ts loads the Hyperdrive driver through a DYNAMIC import of './hyperdrive-client'", () => {
    expect(
      /import\(['"]\.\/hyperdrive-client['"]\)/.test(clientCode),
      "createHyperdriveDbClient must dynamically import './hyperdrive-client' — that boundary is what keeps pg out of non-Hyperdrive environments"
    ).toBe(true);
  });

  it('hyperdrive-client.ts STATICALLY imports BOTH the adapter and pg', () => {
    expect(
      /^\s*import\s+[^;]*['"]drizzle-orm\/node-postgres['"];?\s*$/m.test(
        hyperCode
      ),
      'the Hyperdrive path needs the node-postgres adapter'
    ).toBe(true);
    expect(
      /^\s*import\s+['"]pg['"];?\s*$/m.test(hyperCode),
      "the bare static import 'pg' keeps the reference live in the chunk so the vite build sees the dependency"
    ).toBe(true);
  });

  it("vite.config externalizes 'pg' and 'drizzle-orm/node-postgres'", () => {
    // THE LOAD-BEARING LINE OF THE WHOLE DESIGN. Without these externals,
    // vite bundles pg into the library chunk with rollup's CJS interop, whose
    // `require('events')` artifact throws "Class extends value undefined"
    // under workerd — reproduced under wrangler 4.50 AND 4.129, with
    // nodejs_compat, before the fix landed. With them, the chunk is 571 bytes
    // of verbatim external imports and wrangler's own esbuild does the CJS
    // conversion — verified end-to-end: a wrangler dev worker importing
    // @codex/database's dist ran `SELECT 1` against the real Neon origin
    // through this exact path (2026-09-04).
    expect(
      /^\s*'pg',\s*$/m.test(viteSource),
      "vite.config.database.ts additionalExternals must list 'pg' — bundled instead of external, pg fails to module-load in workerd. Removing the entry regresses a 571-byte chunk to a 209KB one that throws at import."
    ).toBe(true);
    expect(
      /^\s*'drizzle-orm\/node-postgres',\s*$/m.test(viteSource),
      "vite.config.database.ts additionalExternals must list 'drizzle-orm/node-postgres' — the bare 'drizzle-orm' entry does NOT cover subpaths; rollup externals match exactly."
    ).toBe(true);
  });

  it('calibration — the stripper and scope cutter actually discriminate', () => {
    // If these failed, the assertions above would pass on commented-out or
    // in-function code and the guard would be decorative.
    expect(stripComments("// import 'pg';\n")).not.toMatch(/import 'pg'/);
    expect(stripComments("/* import 'pg'; */\n")).not.toMatch(/import 'pg'/);
    expect(
      /^\s*import\s+['"]pg['"];?\s*$/m.test(
        moduleScope("import 'pg';\nexport function x() {}\n")
      )
    ).toBe(true);
    expect(
      /^\s*import\s+['"]pg['"];?\s*$/m.test(
        moduleScope("export function f() {\n  import('pg');\n}\n")
      )
    ).toBe(false);
  });
});
