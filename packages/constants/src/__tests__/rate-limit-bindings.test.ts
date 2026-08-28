/**
 * Drift guard for the `ratelimits` bindings in every worker's wrangler config.
 *
 * `procedure()` now ENFORCES `policy.rateLimit` (Codex-kgrdp.9), and an omitted
 * preset falls back to `api`. Enforcement reads the binding named by
 * `RATE_LIMIT_PRESETS[preset].bindingName` off `env`, so a preset declared on a
 * route with no matching `ratelimits` entry in that worker's config does not
 * throttle anything — it fails OPEN and logs `rate_limit.fail_open` at error
 * level on EVERY request, which both leaves the surface uncapped and buries the
 * signal that exists to catch a genuinely dead backend.
 *
 * The counter substrate makes a second invariant load-bearing: two bindings
 * that share a `namespace_id` share counters ACCOUNT-wide. A collision silently
 * merges two workers' (or two environments') budgets, so one worker's traffic
 * spends another's and E2E traffic can 429 production. The failure mode is a
 * mysterious 429, not an error — nothing else in the repo would catch it.
 *
 * These tests derive their expectations from the configs themselves rather than
 * asserting a hand-maintained list, so adding a worker or an env block is
 * covered without editing this file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_BINDING_PERIODS, RATE_LIMIT_PRESETS } from '../limits';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const WORKERS_DIR = join(REPO_ROOT, 'workers');

interface RateLimitBinding {
  name: string;
  namespaceId: string;
  limit: number;
  period: number;
  worker: string;
  env: string;
}

/**
 * Strip JSONC comments and trailing commas. Adding a JSONC parser dependency
 * for a test is not worth it, and the configs are machine-written enough that
 * the shapes below are stable — but every parse failure THROWS rather than
 * being skipped, so a config this cannot read fails the suite loudly.
 */
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

/** Every `ratelimits` entry across every worker and every env block. */
function collectBindings(): RateLimitBinding[] {
  if (!existsSync(WORKERS_DIR)) {
    throw new Error(
      `workers/ not found at ${WORKERS_DIR}; the rate-limit binding guard cannot run.`
    );
  }

  const bindings: RateLimitBinding[] = [];

  for (const worker of readdirSync(WORKERS_DIR)) {
    const path = join(WORKERS_DIR, worker, 'wrangler.jsonc');
    if (!existsSync(path)) continue;

    const config = parseJsonc(readFileSync(path, 'utf-8'), path);
    const blocks: [string, Record<string, unknown>][] = [['(default)', config]];
    const envs = config.env as
      | Record<string, Record<string, unknown>>
      | undefined;
    for (const [name, block] of Object.entries(envs ?? {})) {
      blocks.push([name, block]);
    }

    for (const [envName, block] of blocks) {
      const entries = (block.ratelimits ?? []) as {
        name?: string;
        namespace_id?: string;
        simple?: { limit?: number; period?: number };
      }[];
      for (const entry of entries) {
        bindings.push({
          name: String(entry.name),
          namespaceId: String(entry.namespace_id),
          limit: Number(entry.simple?.limit),
          period: Number(entry.simple?.period),
          worker,
          env: envName,
        });
      }
    }
  }

  return bindings;
}

/**
 * Presets a worker's own source declares on a `procedure()` policy, plus the
 * `api` fallback whenever that worker has any procedure route at all — an
 * omitted `rateLimit` is enforced as `api`, not as "unlimited".
 */
function declaredPresets(worker: string): Set<string> {
  const srcDir = join(WORKERS_DIR, worker, 'src');
  if (!existsSync(srcDir)) return new Set();

  const presets = new Set<string>();
  let hasProcedureRoute = false;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Test and proof files declare presets that never reach a deployment.
        if (
          entry.name === '__tests__' ||
          entry.name === '__test__' ||
          entry.name === '__denoise_proofs__'
        ) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.includes('.test.'))
        continue;

      const source = readFileSync(full, 'utf-8');
      for (const match of source.matchAll(/rateLimit:\s*'([a-z]+)'/g)) {
        presets.add(match[1] as string);
      }
      if (/\bprocedure\s*\(/.test(source)) hasProcedureRoute = true;
    }
  };

  walk(srcDir);
  if (hasProcedureRoute) presets.add('api');
  return presets;
}

describe('rate-limit bindings — wrangler config drift guard', () => {
  const bindings = collectBindings();

  it('finds bindings to check (non-vacuity floor)', () => {
    // A broken parser or a moved directory would otherwise make every
    // assertion below pass over an empty array.
    expect(bindings.length).toBeGreaterThan(10);
  });

  it('never reuses a namespace_id — a shared id merges counters account-wide', () => {
    const byId = new Map<string, string[]>();
    for (const b of bindings) {
      const where = `${b.worker}/${b.env}/${b.name}`;
      byId.set(b.namespaceId, [...(byId.get(b.namespaceId) ?? []), where]);
    }
    const collisions = [...byId.entries()].filter(
      ([, uses]) => uses.length > 1
    );
    expect(collisions).toEqual([]);
  });

  it('matches limit/period to the preset the binding name belongs to', () => {
    const byBindingName = new Map(
      Object.values(RATE_LIMIT_PRESETS)
        .filter((p) => 'bindingName' in p)
        .map((p) => [
          (p as { bindingName: string }).bindingName,
          p as { maxRequests: number; periodSeconds: number },
        ])
    );

    for (const b of bindings) {
      const preset = byBindingName.get(b.name);
      expect(
        preset,
        `${b.worker}/${b.env} binds ${b.name}, which is not any preset's bindingName`
      ).toBeDefined();
      if (!preset) continue;

      expect(
        { name: b.name, limit: b.limit, period: b.period },
        `${b.worker}/${b.env}/${b.name} drifted from RATE_LIMIT_PRESETS`
      ).toEqual({
        name: b.name,
        limit: preset.maxRequests,
        period: preset.periodSeconds,
      });
    }
  });

  it('only uses periods Cloudflare actually accepts', () => {
    for (const b of bindings) {
      expect(
        RATE_LIMIT_BINDING_PERIODS as readonly number[],
        `${b.worker}/${b.env}/${b.name} period=${b.period}`
      ).toContain(b.period);
    }
  });

  it('declares every preset its routes use, in EVERY env block', () => {
    const workers = [...new Set(bindings.map((b) => b.worker))];
    const workerDirs = readdirSync(WORKERS_DIR).filter((w) =>
      existsSync(join(WORKERS_DIR, w, 'wrangler.jsonc'))
    );
    expect(workerDirs.length).toBeGreaterThan(5);

    const missing: string[] = [];

    for (const worker of workerDirs) {
      const presets = declaredPresets(worker);
      const required = [...presets]
        .map((preset) => {
          const config =
            RATE_LIMIT_PRESETS[
              preset.toUpperCase() as keyof typeof RATE_LIMIT_PRESETS
            ];
          return config && 'bindingName' in config
            ? (config as { bindingName: string }).bindingName
            : null;
        })
        .filter((name): name is string => name !== null);
      if (required.length === 0) continue;

      const envs = [
        ...new Set(
          bindings.filter((b) => b.worker === worker).map((b) => b.env)
        ),
      ];
      // A worker that needs bindings but declares none in any env block is the
      // worst case: it fails open on every request in every environment.
      if (envs.length === 0) {
        missing.push(
          `${worker}: no ratelimits block at all, needs ${required.join(', ')}`
        );
        continue;
      }

      for (const env of envs) {
        const bound = new Set(
          bindings
            .filter((b) => b.worker === worker && b.env === env)
            .map((b) => b.name)
        );
        for (const name of required) {
          if (!bound.has(name))
            missing.push(`${worker}/${env} missing ${name}`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(workers.length).toBeGreaterThan(3);
  });
});
