/**
 * Drift guard for the Hyperdrive bindings (Codex-s1i7h)
 *
 * `selectHyperdrive()` in worker-utils derives which config a route uses from
 * `policy.cache`, but it can only choose between bindings that the wrangler
 * config actually declares. Three ways that goes wrong, none of which throws:
 *
 *   1. HYPERDRIVE declared, HYPERDRIVE_UNCACHED missing. Private and `fresh`
 *      routes silently fall back to the Neon driver, so one worker runs two
 *      drivers and only some of its traffic is pooled.
 *   2. Either binding declared in `env.test`. `wrangler dev` resolves a
 *      Hyperdrive binding to a DIRECT connection string, so the e2e suite
 *      would swap to node-postgres while exercising neither pooling nor query
 *      caching — a green suite proving nothing about the thing it changed.
 *   3. Both bindings pointing at the SAME config id. The derivation still
 *      compiles, still runs, and every private route gets a 75-second
 *      staleness window. This is the one a human review would miss.
 *
 * The set of units that need the bindings is DERIVED from their dependencies,
 * not listed here — a list cannot cover a worker added next month.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Candidate deployment units: every worker, plus the SvelteKit app. */
const UNIT_DIRS = [
  'workers/admin-api',
  'workers/auth',
  'workers/content-api',
  'workers/dev-cdn',
  'workers/ecom-api',
  'workers/identity-api',
  'workers/media-api',
  'workers/notifications-api',
  'workers/organization-api',
  'apps/web',
];

/** Strip JSONC comments and trailing commas. Mirrors rate-limit-bindings.test.ts. */
function parseJsonc(source: string, path: string): Record<string, unknown> {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${(error as Error).message}. Fix the parser or the config rather than deleting this guard.`
    );
  }
}

interface HyperdriveBinding {
  binding?: string;
  id?: string;
}

/**
 * Does this unit reach the database through the shared per-request client?
 * DERIVED from dependencies: @codex/worker-utils owns getSharedDb(), and
 * @codex/database is the factory itself. A unit depending on neither (dev-cdn
 * proxies R2) needs no binding.
 */
function needsHyperdrive(dir: string): boolean {
  const pkgPath = join(REPO_ROOT, dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});
  return (
    deps.includes('@codex/database') || deps.includes('@codex/worker-utils')
  );
}

function bindingsFor(dir: string, env: string): HyperdriveBinding[] {
  const path = join(REPO_ROOT, dir, 'wrangler.jsonc');
  if (!existsSync(path)) return [];
  const cfg = parseJsonc(readFileSync(path, 'utf-8'), path);
  const envs = cfg.env as Record<string, { hyperdrive?: unknown }> | undefined;
  const list = envs?.[env]?.hyperdrive;
  return Array.isArray(list) ? (list as HyperdriveBinding[]) : [];
}

const UNITS = UNIT_DIRS.filter(needsHyperdrive);

describe('Hyperdrive bindings — wrangler config drift guard', () => {
  it('identifies the units that need a binding', () => {
    // Calibration: every assertion below iterates UNITS, so an empty list
    // would pass the suite while checking nothing. dev-cdn must be excluded
    // and the rest included, which also proves the predicate discriminates
    // rather than matching everything.
    expect(UNITS.length).toBeGreaterThan(0);
    expect(UNITS).not.toContain('workers/dev-cdn');
    expect(UNITS).toContain('apps/web');
    expect(UNITS).toContain('workers/auth');
  });

  it.each(UNITS)('%s declares BOTH bindings in env.production', (dir) => {
    const names = bindingsFor(dir, 'production')
      .map((b) => b.binding)
      .sort();
    expect(
      names,
      `${dir}: selectHyperdrive() needs both, or private routes quietly fall back to the Neon driver`
    ).toEqual(['HYPERDRIVE', 'HYPERDRIVE_UNCACHED']);
  });

  it.each(UNITS)('%s points the two bindings at DIFFERENT configs', (dir) => {
    const ids = bindingsFor(dir, 'production').map((b) => b.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true
    );
    expect(
      new Set(ids).size,
      `${dir}: both bindings resolve to the same Hyperdrive config, so the cache-disabled path is CACHED — every private route gets a 75s staleness window and nothing fails`
    ).toBe(ids.length);
  });

  it.each(UNITS)('%s declares NO binding in env.test', (dir) => {
    expect(
      bindingsFor(dir, 'test'),
      `${dir}: a Hyperdrive binding under env.test swaps the driver for local/CI while wrangler dev exercises neither pooling nor query caching — the e2e suite would go green having proved nothing`
    ).toEqual([]);
  });
});
