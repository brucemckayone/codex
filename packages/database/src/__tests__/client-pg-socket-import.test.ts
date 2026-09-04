/**
 * The `pg` side-effect import in client.ts is load-bearing (Codex-s1i7h)
 *
 * `drizzle({ connection })` constructs the `pg` Pool internally, so client.ts
 * references no `pg` symbol. That makes `import 'pg'` look like a stray line
 * any tidy-up commit would delete — and deleting it ships a worker that cannot
 * open a database connection.
 *
 * Measured with `wrangler deploy --env production --dry-run` on
 * workers/organization-api:
 *
 *   without the import:  cloudflare:sockets 0   net/tls requires 0
 *   with the import:     cloudflare:sockets 1   net/tls requires 2
 *
 * esbuild bundles pg's pool and wire-protocol code either way — `pg-pool`,
 * `readyForQuery` and `ConnectionParameters` are all present — so the bundle
 * looks complete. Only the transport is missing, and only a deployed worker
 * would say so.
 *
 * Asserting the bundle itself would mean running wrangler inside a unit test.
 * This asserts the source instead, with comments stripped first: a
 * presence-check on raw source passes happily when the line has merely been
 * commented out.
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

describe('client.ts pg side-effect import', () => {
  const source = readFileSync(CLIENT_PATH, 'utf-8');
  const code = stripComments(source);

  it('is present as executable code, not just in a comment', () => {
    expect(
      /^\s*import\s+['"]pg['"];?\s*$/m.test(code),
      "client.ts must keep the bare `import 'pg'`. Without it esbuild omits pg's socket layer and the deployed worker cannot reach the database — verify with: cd workers/organization-api && npx wrangler deploy --env production --dry-run --outdir /tmp/b && grep -c 'cloudflare:sockets' /tmp/b/index.js"
    ).toBe(true);
  });

  it('calibration — the stripper actually removes a commented-out copy', () => {
    // If this failed, the assertion above would pass on a commented-out
    // import and the whole guard would be decorative.
    expect(stripComments("// import 'pg';\n")).not.toMatch(/import 'pg'/);
    expect(stripComments("/* import 'pg'; */\n")).not.toMatch(/import 'pg'/);
    // ...and does NOT remove the real one.
    expect(stripComments("import 'pg';\n")).toMatch(/import 'pg'/);
  });

  it('still reaches the node-postgres driver, which needs that transport', () => {
    // Ties the two together: if the Hyperdrive driver path were removed, this
    // guard would be asserting an import nothing needs.
    expect(code).toMatch(/drizzle-orm\/node-postgres/);
  });
});
