/**
 * Rename guard for the legacy tier column (Codex-2hxff.91, design §2.4 #11).
 *
 * `content.included_in_tier_id` is now the drizzle property
 * `legacyIncludedInTierId`: a phase 1-2 dual-write for an older web, never a
 * gate. The gate is `isTierGated` and the tiers are `content_tier_access`. A
 * new server reader of the legacy column would bring back the ladder ("this
 * tier and above") or, worse, read a NULL as free. So the name may appear in
 * production source only where it is written or shimmed:
 * - the schema that declares it;
 * - `content-tier-access.ts` (the dual-write helper, the wire shim, the
 *   legacy-input expander) and `content-service.ts` (its read-back after the
 *   dual-write, and the "unchanged legacy pick" comparison);
 * - `tier-service.ts` (the delete sweep's inline dual-write; that package
 *   cannot reach @codex/content);
 * - the test-utils factories and plan-access fixture helpers.
 * Tests may name it freely.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const ALLOWED = new Set([
  'packages/database/src/schema/content.ts',
  'packages/content/src/services/content-tier-access.ts',
  'packages/content/src/services/content-service.ts',
  'packages/subscription/src/services/tier-service.ts',
  'packages/test-utils/src/factories.ts',
  'packages/test-utils/src/plan-access.ts',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.turbo']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.d.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

function serverSourceRoots(): string[] {
  const roots: string[] = [];
  for (const group of ['packages', 'workers']) {
    for (const pkg of readdirSync(join(REPO_ROOT, group))) {
      const src = join(REPO_ROOT, group, pkg, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // A package without src/ has no server source to guard.
      }
    }
  }
  return roots;
}

describe('legacyIncludedInTierId rename guard (Codex-2hxff.91)', () => {
  it('appears in server source only where it is dual-written or shimmed', () => {
    const offenders = serverSourceRoots()
      .flatMap(sourceFiles)
      .map((path) => relative(REPO_ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) =>
        readFileSync(join(REPO_ROOT, path), 'utf8').includes(
          'legacyIncludedInTierId'
        )
      );

    expect(offenders).toEqual([]);
  });

  it('scans the real tree (not vacuous)', () => {
    const files = serverSourceRoots().flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(200);
    // Every allowed file exists, and the schema still names the property.
    for (const path of ALLOWED) {
      expect(statSync(join(REPO_ROOT, path)).isFile()).toBe(true);
    }
    expect(
      readFileSync(
        join(REPO_ROOT, 'packages/database/src/schema/content.ts'),
        'utf8'
      )
    ).toContain('legacyIncludedInTierId');
  });
});
