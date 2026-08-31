/**
 * Drift guard for RESERVED_SUBDOMAINS.
 *
 * `getSubdomainContext()` in apps/web resolves EVERY non-reserved subdomain as
 * an organization slug, so an infrastructure hostname missing from the reserved
 * list costs 3-4 worker subrequests and 3-4 Neon queries per request and then
 * throws "Organization not found". In the 24h window that prompted this test
 * that was the top error on codex-web-production, driven by our own CDN and
 * tunnel hostnames hitting the tenant-resolution endpoint.
 *
 * These tests deliberately do NOT assert the list's contents — a contents
 * assertion would have stayed green through the entire drift. They derive the
 * expectation from the files that PROVISION each hostname:
 *
 *   - `routes[].pattern` in every worker `wrangler.jsonc` and in
 *     apps/web/wrangler.jsonc          → what Cloudflare routes to a worker
 *   - `.github/config/r2-infrastructure.json`, applied by
 *     sync-r2-infrastructure.yml       → what R2 custom domains exist
 *   - infrastructure/cloudflare-tunnel/config.yml
 *                                      → what the dev tunnel exposes
 *
 * A hostname cannot start resolving without an edit to one of those files, so
 * the guard fails on the same commit that creates the hostname. The reverse
 * direction is covered too: the generated portion of the list can only contain
 * what the axes expand to, and each axis value must be justified by one of
 * those files — which is why `cdn-staging` (reserved for months, never in DNS)
 * cannot come back.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_SUBDOMAINS,
  CDN_HOST_SUFFIXES,
  DEPLOY_HOST_SUFFIXES,
  DOMAINS,
  GENERATED_INFRASTRUCTURE_SUBDOMAINS,
  isReservedSubdomain,
  R2_BUCKET_TYPES,
  RESERVED_SUBDOMAINS,
  RESERVED_SUBDOMAINS_SET,
  STATIC_RESERVED_SUBDOMAINS,
  WORKER_SUBDOMAINS,
} from '../urls';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const R2_CONFIG_PATH = join(REPO_ROOT, '.github/config/r2-infrastructure.json');
const TUNNEL_CONFIG_PATH = join(
  REPO_ROOT,
  'infrastructure/cloudflare-tunnel/config.yml'
);
const WORKERS_DIR = join(REPO_ROOT, 'workers');
const WEB_WRANGLER_PATH = join(REPO_ROOT, 'apps/web/wrangler.jsonc');

/**
 * Read a required source-of-truth file. Missing files FAIL rather than skip —
 * a drift guard that silently stops running is worse than no guard, because
 * the suite still reports success.
 */
function readSourceOfTruth(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `Source-of-truth file missing: ${path}. RESERVED_SUBDOMAINS cannot be verified against provisioning config; fix the path rather than deleting this test.`
    );
  }
  return readFileSync(path, 'utf-8');
}

/**
 * Leading hostname label for a host under the production apex, or null when the
 * host is the apex itself, a wildcard route, or off-zone. Deeper hosts
 * (`auth.dev.revelations.studio`) collapse to their first label because that is
 * the label `extractSubdomain` compares against the reserved list.
 */
function leadingLabel(host: string): string | null {
  const apex = DOMAINS.PROD;
  if (host === apex) return null;
  if (!host.endsWith(`.${apex}`)) return null;
  const label = host.slice(0, -(apex.length + 1)).split('.')[0];
  if (!label || label.includes('*')) return null;
  return label.toLowerCase();
}

/** `routes[].pattern` values from a wrangler config (JSONC — regex, no parser). */
function routePatterns(source: string): string[] {
  return [...source.matchAll(/"pattern"\s*:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((pattern): pattern is string => pattern !== undefined);
}

/** Hostname labels a wrangler config binds to a worker. */
function routeLabels(source: string): string[] {
  const labels = routePatterns(source)
    .map((pattern) => pattern.replace(/\/\*$/, ''))
    .map(leadingLabel)
    .filter((label): label is string => label !== null);
  return [...new Set(labels)];
}

function workerWranglerSources(): { name: string; source: string }[] {
  return readdirSync(WORKERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(WORKERS_DIR, entry.name, 'wrangler.jsonc'),
    }))
    .filter((worker) => existsSync(worker.path))
    .map((worker) => ({
      name: worker.name,
      source: readFileSync(worker.path, 'utf-8'),
    }));
}

interface R2InfrastructureConfig {
  domainStructure: Record<string, Record<string, unknown>>;
  buckets: Record<
    string,
    {
      publicAccess?: { customDomain?: string };
      dns?: { subdomain?: string };
    }
  >;
}

function r2Config(): R2InfrastructureConfig {
  return JSON.parse(readSourceOfTruth(R2_CONFIG_PATH));
}

/** Env keys under a `domainStructure` entry that name a hostname. */
const R2_ENV_KEYS = ['production', 'preview', 'dev'] as const;

/** Every hostname the R2 infrastructure config provisions. */
function r2Hostnames(): string[] {
  const config = r2Config();
  const hosts: string[] = [];

  for (const [type, entry] of Object.entries(config.domainStructure)) {
    if (!R2_BUCKET_TYPES.some((known) => known === type)) continue;
    for (const envKey of R2_ENV_KEYS) {
      const host = entry[envKey];
      if (typeof host === 'string') hosts.push(host);
    }
  }

  for (const bucket of Object.values(config.buckets)) {
    const host = bucket.publicAccess?.customDomain;
    if (typeof host === 'string') hosts.push(host);
  }

  return [...new Set(hosts)];
}

/** Hostnames the dev tunnel exposes. */
function tunnelHostnames(): string[] {
  const source = readSourceOfTruth(TUNNEL_CONFIG_PATH);
  return [...source.matchAll(/^\s*-\s*hostname:\s*(\S+)/gm)]
    .map((match) => match[1])
    .filter((host): host is string => host !== undefined);
}

describe('RESERVED_SUBDOMAINS provisioning coverage', () => {
  it('reserves every hostname a worker route binds', () => {
    const sources = [
      ...workerWranglerSources(),
      { name: 'apps/web', source: readSourceOfTruth(WEB_WRANGLER_PATH) },
    ];

    // Sanity: if the glob ever matches nothing the assertions below become
    // vacuous, so prove the routes were actually found.
    const allLabels = sources.flatMap((s) => routeLabels(s.source));
    expect(allLabels.length).toBeGreaterThan(10);

    const unreserved = sources.flatMap(({ name, source }) =>
      routeLabels(source)
        .filter((label) => !RESERVED_SUBDOMAINS_SET.has(label))
        .map((label) => `${name}: ${label}`)
    );
    expect(unreserved).toEqual([]);
  });

  it('reserves every R2 custom domain in the infrastructure config', () => {
    const hosts = r2Hostnames();
    expect(hosts.length).toBeGreaterThan(10);

    const unreserved = hosts.filter((host) => {
      const label = leadingLabel(host);
      return label === null || !RESERVED_SUBDOMAINS_SET.has(label);
    });
    expect(unreserved).toEqual([]);
  });

  it('reserves every DNS subdomain the R2 config provisions', () => {
    const config = r2Config();
    const subdomains = Object.values(config.buckets)
      .map((bucket) => bucket.dns?.subdomain)
      .filter((value): value is string => typeof value === 'string');
    expect(subdomains.length).toBeGreaterThan(10);

    const unreserved = subdomains.filter(
      (subdomain) => !RESERVED_SUBDOMAINS_SET.has(subdomain.toLowerCase())
    );
    expect(unreserved).toEqual([]);
  });

  it('reserves every hostname the dev tunnel exposes', () => {
    const hosts = tunnelHostnames();
    expect(hosts.length).toBeGreaterThan(0);

    const unreserved = hosts.filter((host) => {
      const label = leadingLabel(host);
      return label === null || !RESERVED_SUBDOMAINS_SET.has(label);
    });
    expect(unreserved).toEqual([]);
  });
});

describe('RESERVED_SUBDOMAINS axes are justified by provisioning config', () => {
  it('R2_BUCKET_TYPES matches the infrastructure config bucket types', () => {
    const config = r2Config();
    const declared = Object.entries(config.domainStructure)
      .filter(([, entry]) => typeof entry === 'object' && entry !== null)
      .filter(([, entry]) =>
        R2_ENV_KEYS.some((key) => typeof entry[key] === 'string')
      )
      .map(([type]) => type);

    expect([...R2_BUCKET_TYPES].sort()).toEqual(declared.sort());
  });

  it('CDN_HOST_SUFFIXES matches the suffixes the infrastructure config uses', () => {
    const config = r2Config();
    const suffixes = new Set<string>();

    for (const type of R2_BUCKET_TYPES) {
      const entry = config.domainStructure[type];
      if (!entry) {
        throw new Error(`missing domainStructure.${type} in ${R2_CONFIG_PATH}`);
      }
      for (const envKey of R2_ENV_KEYS) {
        const host = entry[envKey];
        if (typeof host !== 'string') continue;
        const label = leadingLabel(host);
        if (label === null) {
          throw new Error(`${type}.${envKey} is off-zone: ${host}`);
        }
        // `cdn-media-preview` → `-preview`; `cdn-media` → ``.
        expect(label).toMatch(new RegExp(`^cdn-${type}`));
        suffixes.add(label.slice(`cdn-${type}`.length));
      }
    }

    expect([...CDN_HOST_SUFFIXES].sort()).toEqual([...suffixes].sort());
  });

  it('WORKER_SUBDOMAINS matches the worker custom-domain routes exactly', () => {
    const declared = new Set(
      workerWranglerSources().flatMap(({ source }) => routeLabels(source))
    );
    expect([...WORKER_SUBDOMAINS].sort()).toEqual([...declared].sort());
  });

  it('every APP_SUBDOMAINS entry has a route in each deployed env', () => {
    const declared = new Set(routeLabels(readSourceOfTruth(WEB_WRANGLER_PATH)));
    for (const app of APP_SUBDOMAINS) {
      for (const suffix of DEPLOY_HOST_SUFFIXES) {
        expect(
          declared.has(`${app}${suffix}`),
          `apps/web declares no route for ${app}${suffix}`
        ).toBe(true);
      }
    }
  });
});

describe('RESERVED_SUBDOMAINS structural invariants', () => {
  /**
   * Shapes the generator owns. A hand-added entry matching one of these means
   * an infrastructure hostname was patched in as a one-off instead of being
   * expressed as an axis value — the exact move that produced the drift.
   */
  const GENERATOR_OWNED_SHAPES = [
    /^cdn(-|$)/,
    /-local$/,
    /-preview(-\d+)?$/,
  ] as const;

  it('holds no infrastructure-shaped entry outside the generator', () => {
    const smuggled = STATIC_RESERVED_SUBDOMAINS.filter((entry) =>
      GENERATOR_OWNED_SHAPES.some((shape) => shape.test(entry))
    );
    expect(smuggled).toEqual([]);
  });

  it('keeps the generated and static lists disjoint', () => {
    const generated = new Set<string>(GENERATED_INFRASTRUCTURE_SUBDOMAINS);
    const overlap = STATIC_RESERVED_SUBDOMAINS.filter((entry) =>
      generated.has(entry)
    );
    expect(overlap).toEqual([]);
  });

  it('contains no duplicates', () => {
    expect(RESERVED_SUBDOMAINS_SET.size).toBe(RESERVED_SUBDOMAINS.length);
  });

  it('holds only lowercase DNS labels', () => {
    // Lookups lowercase their input, so an uppercase entry is unreachable.
    const invalid = RESERVED_SUBDOMAINS.filter(
      (entry) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(entry)
    );
    expect(invalid).toEqual([]);
  });

  it('drops cdn-staging, which never existed in DNS', () => {
    // The tell that the list had drifted: reserved for months against a naming
    // scheme that changed before it shipped. Nothing provisions it, so nothing
    // may reserve it.
    expect(RESERVED_SUBDOMAINS_SET.has('cdn-staging')).toBe(false);
  });
});

describe('isReservedSubdomain structural prefix rule', () => {
  it('reserves any cdn- prefixed label, listed or not', () => {
    // The rule exists so a future `cdn-{bucket-type}{-env}` hostname cannot
    // wait for a constants release before it stops resolving as a slug.
    expect(isReservedSubdomain('cdn-anything')).toBe(true);
    expect(isReservedSubdomain('cdn-some-future-bucket-preview')).toBe(true);
  });

  it('reserves the bare cdn host via the list', () => {
    expect(isReservedSubdomain('cdn')).toBe(true);
  });

  it('does not reserve ordinary tenant slugs', () => {
    expect(isReservedSubdomain('myorg')).toBe(false);
  });

  it('requires the hyphen — cdnographic is a legal slug', () => {
    // The prefix is `cdn-`, not `cdn`; anything broader would silently claim
    // real tenant names.
    expect(isReservedSubdomain('cdnographic')).toBe(false);
  });

  it('lowercases its input like the Set lookups always did', () => {
    expect(isReservedSubdomain('CDN-Media-Dev')).toBe(true);
    expect(isReservedSubdomain('MYORG')).toBe(false);
  });

  it('agrees with the list — every reserved entry stays reserved', () => {
    const disagreements = RESERVED_SUBDOMAINS.filter(
      (entry) => !isReservedSubdomain(entry)
    );
    expect(disagreements).toEqual([]);
  });
});

describe('isReservedSubdomain covers the R2 infrastructure config', () => {
  /** First DNS label of any `<label>.revelations.studio` host, anywhere in a string. */
  const PROD_HOST_IN_ANY_STRING = new RegExp(
    `([a-z0-9-]+)\\.${DOMAINS.PROD.replace(/\./g, '\\.')}`,
    'gi'
  );

  /** Adds the first DNS label of every `<label>.revelations.studio` host in `text`. */
  function collectLabels(text: string, labels: Set<string>): void {
    for (const match of text.matchAll(PROD_HOST_IN_ANY_STRING)) {
      labels.add(match[1].toLowerCase());
    }
  }

  /**
   * Walks the ENTIRE config — not just the keys known to carry hostnames
   * today — and collects the first DNS label of every
   * `<label>.revelations.studio` host in any string value (bare hosts,
   * `https://` URL bases, summary table rows) or object key. A hostname
   * provisioned under a new key, or keyed BY its hostname, therefore cannot
   * slip the guard, and the expectation is always derived from the parsed
   * file, never a hardcoded host list.
   */
  function provisionedLabels(
    node: unknown,
    labels = new Set<string>()
  ): Set<string> {
    if (typeof node === 'string') {
      collectLabels(node, labels);
    } else if (Array.isArray(node)) {
      for (const item of node) provisionedLabels(item, labels);
    } else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        collectLabels(key, labels);
        provisionedLabels(value, labels);
      }
    }
    return labels;
  }

  it('reserves the first DNS label of every hostname in the config', () => {
    const labels = provisionedLabels(r2Config());
    // Sanity: a walk that matched nothing would make the assertion vacuous.
    expect(labels.size).toBeGreaterThan(10);

    const unreserved = [...labels].filter(
      (label) => !isReservedSubdomain(label)
    );
    expect(unreserved).toEqual([]);
  });
});

describe('RESERVED_SUBDOMAINS incident regression', () => {
  // Hostnames observed resolving to organization-api tenant lookups in
  // production. Pinned by hostname (not by list contents) so the specific
  // reported failures cannot recur — `bot` and `preview` in particular have no
  // provisioning file to derive them from.
  it.each([
    'cdn-media-preview', // 404 on /api/organizations/public/cdn-media-preview/info
    'cdn-resources-preview', // 404 on /cdn-resources-preview/stats
    'cdn-media-dev', // 404 on /cdn-media-dev/creators
    'local', // 404 on /local/info
    'ecom-api-local',
    'bot',
    'preview',
  ])('reserves %s', (subdomain) => {
    expect(RESERVED_SUBDOMAINS_SET.has(subdomain)).toBe(true);
  });
});
