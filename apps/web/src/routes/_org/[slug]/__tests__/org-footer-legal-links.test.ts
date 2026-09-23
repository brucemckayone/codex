import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildPlatformUrl } from '$lib/utils/subdomain';

/**
 * No component that can render on an ORG host may link legal pages
 * relatively. (Codex-6wkr1, hardened by Codex-fpw69)
 *
 * /about, /terms and /privacy exist ONLY in the `(platform)` route group. A
 * TENANT host is rewritten by `hooks.ts` to `/_org/<slug>/terms`, which does
 * not exist, so a relative href there 404s. It MUST be built with
 * `buildPlatformUrl` (which stays in the viewer's own environment,
 * Codex-a9kn0).
 *
 * The opposite holds for platform-scoped files. `lib/components/ui/Layout/
 * Footer.svelte` is mounted only by `(platform)`, reachable on the apex and on
 * RESERVED subdomains, where `hooks.ts` returns the path UNREWRITTEN — so a
 * relative href is correct there and an absolute one moves the viewer off the
 * host they are on. Pinned in `Footer.svelte.test.ts`; asserted here too so the
 * distinction is visible from both sides.
 *
 * WHY EVERY .svelte FILE, NOT A LIST. This file used to scan exactly two named
 * files. That cannot catch the failure it was written in response to: a footer
 * nobody remembered existed (`MobileBottomSheet.svelte` is already imported by
 * the org layout). So the scan is every `src/**\/*.svelte`, and the exceptions
 * are an explicit, reasoned ALLOWLIST below — a new relative legal link fails
 * until someone writes down why its file can never render on a tenant host.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST. `_org/[slug]/+layout.svelte`
 * is ~900 lines with brand-token injection, ShaderHero, collection hydration,
 * progress sync and MobileBottomNav; the repo has no render harness for it.
 * It is the weaker instrument and says so: it proves the markup, not the
 * rendered output. The BEHAVIOUR half — what the builder the layout calls
 * actually returns on each host class — is asserted directly below.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidiness:
 * explanatory comments contain the literal string `/terms`, so a scan of raw
 * source would match the prose, and a commented-out fix would stay green.
 */

const WEB_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SRC = join(WEB_ROOT, 'src');

/**
 * Files allowed to link legal pages RELATIVELY. Each entry MUST say why the
 * file can only ever render on a host where `hooks.ts` leaves the path
 * unrewritten (the apex or a reserved subdomain). Paths are relative to
 * apps/web.
 */
const RELATIVE_LEGAL_HREF_ALLOWLIST: Record<string, string> = {
  // Mounted ONLY by routes/(platform)/+layout.svelte. Deliberately reverted to
  // relative hrefs in 8f2cc585 — an absolute URL moved staging viewers to
  // production. Pinned by Footer.svelte.test.ts.
  'src/lib/components/ui/Layout/Footer.svelte':
    'platform footer, (platform) only',
  // A (platform) route: rendered only on the apex / reserved subdomains, never
  // on a tenant host (tenant paths are rewritten under /_org/<slug>/).
  'src/routes/(platform)/pricing/+page.svelte': '(platform) route',
};

const LEGAL_PATHS = ['about', 'terms', 'privacy'] as const;

/**
 * A relative legal link in any spelling: `href="/terms"`, `href='/terms/'`,
 * `href="/terms?x=1"`, `href="/terms#s"`, `href={'/terms'}`, `href={`/terms`}`,
 * and a nav-config object property `href: '/terms'`. The lookahead stops
 * `/termsheet` from matching.
 */
const RELATIVE_LEGAL_HREF =
  /\bhref\s*[=:]\s*\{?\s*["'`]\/(about|terms|privacy)(?=["'`/?#])/g;

/** Strip block and line comments so prose cannot satisfy or mask an assertion. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function relativeLegalHrefs(source: string): string[] {
  return [...stripComments(source).matchAll(RELATIVE_LEGAL_HREF)].map(
    (m) => m[0]
  );
}

/** Every .svelte file under apps/web/src, as apps/web-relative POSIX paths. */
function allSvelteFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.svelte'))
    .map((f) => `src/${f.split('\\').join('/')}`);
}

function codeOf(relative: string): string {
  return stripComments(readFileSync(join(WEB_ROOT, relative), 'utf8'));
}

const ORG_LAYOUT = 'src/routes/_org/[slug]/+layout.svelte';
const PLATFORM_FOOTER = 'src/lib/components/ui/Layout/Footer.svelte';
const MOBILE_SHEET =
  'src/lib/components/layout/MobileNav/MobileBottomSheet.svelte';

describe('relative legal hrefs only where the path is not rewritten (Codex-fpw69)', () => {
  const files = allSvelteFiles();

  test('no non-allowlisted .svelte file links a legal page relatively', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file in RELATIVE_LEGAL_HREF_ALLOWLIST) continue;
      for (const hit of relativeLegalHrefs(
        readFileSync(join(WEB_ROOT, file), 'utf8')
      )) {
        offenders.push(`${file}: ${hit}`);
      }
    }
    // A failure here means a legal link that 404s on every org subdomain.
    // Use buildPlatformUrl(page.url, '/terms'), or — only if the file can
    // never render on a tenant host — add it to the allowlist WITH a reason.
    expect(offenders).toEqual([]);
  });

  test('every allowlist entry still exists and still needs its exemption', () => {
    // A stale entry is a silent hole: the path could be reused by a file that
    // DOES render on tenant hosts.
    for (const file of Object.keys(RELATIVE_LEGAL_HREF_ALLOWLIST)) {
      expect(files).toContain(file);
      expect(
        relativeLegalHrefs(readFileSync(join(WEB_ROOT, file), 'utf8')).length
      ).toBeGreaterThan(0);
    }
  });

  test('the scan covers the whole tree, including the forgotten footer (control)', () => {
    // A wrong root or an empty walk would make the offender check pass
    // vacuously.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(ORG_LAYOUT);
    expect(files).toContain(MOBILE_SHEET);
    expect(codeOf(ORG_LAYOUT).length).toBeGreaterThan(500);
  });
});

describe('the matcher and the stripper (instrument controls)', () => {
  test.each([
    `<a href="/terms">`,
    `<a href='/privacy'>`,
    `<a href="/terms/">`,
    `<a href="/terms?x=1">`,
    `<a href="/about#team">`,
    `<a href={'/terms'}>`,
    `<a href={ "/privacy" }>`,
    '<a href={`/terms`}>',
    `{ href: '/about', label: 'About' }`,
  ])('matches a relative legal link: %s', (snippet) => {
    expect(relativeLegalHrefs(snippet)).toHaveLength(1);
  });

  test.each([
    `<a href={platformTermsUrl}>`,
    `<a href="https://revelations.studio/terms">`,
    `<a href="/termsheet">`,
    `<a href="/library">`,
    `buildPlatformUrl(page.url, '/terms')`,
  ])('does not match: %s', (snippet) => {
    expect(relativeLegalHrefs(snippet)).toHaveLength(0);
  });

  test.each([
    `<!-- <a href="/terms">x</a> -->`,
    `// <a href="/terms">x</a>`,
    `/* <a href="/terms">x</a> */`,
  ])('ignores a commented-out link: %s', (snippet) => {
    expect(relativeLegalHrefs(snippet)).toHaveLength(0);
  });
});

describe('the org layout builds legal links in-env (Codex-6wkr1, Codex-a9kn0)', () => {
  test('each legal path goes through buildPlatformUrl', () => {
    // The positive half. Without it, deleting the links entirely would satisfy
    // the negative scan. Whitespace- and quote-tolerant so a formatter pass
    // cannot break it.
    const code = codeOf(ORG_LAYOUT);
    for (const path of LEGAL_PATHS) {
      expect(code).toMatch(
        new RegExp(`buildPlatformUrl\\(\\s*[^,()]+,\\s*["'\`]/${path}["'\`]`)
      );
    }
  });

  test.each([
    // [org host the layout renders on, platform origin the link must reach]
    ['https://yoga.revelations.studio/', 'https://revelations.studio'],
    [
      'https://yoga-staging.revelations.studio/',
      'https://staging.revelations.studio',
    ],
    ['https://yoga.dev.revelations.studio/', 'https://dev.revelations.studio'],
    ['http://yoga.lvh.me:3000/', 'http://lvh.me:3000'],
  ])('on %s the builder reaches %s', (orgHost, platformOrigin) => {
    // Behaviour, not text: the builder the layout imports yields an ABSOLUTE
    // URL on the viewer's own environment's platform origin.
    for (const path of LEGAL_PATHS) {
      const href = buildPlatformUrl(new URL(orgHost), `/${path}`);
      const url = new URL(href);
      expect(url.origin).toBe(platformOrigin);
      expect(url.pathname).toBe(`/${path}`);
    }
  });
});

describe('the platform footer keeps them RELATIVE (the inverse)', () => {
  test('all three legal paths are relative and no builder is used', () => {
    // Deliberately the opposite of the org layout: (platform) renders in place
    // on reserved subdomains such as staging, so relative keeps the viewer on
    // the host they are on.
    const hits = relativeLegalHrefs(
      readFileSync(join(WEB_ROOT, PLATFORM_FOOTER), 'utf8')
    ).join(' ');
    for (const path of LEGAL_PATHS) expect(hits).toContain(`/${path}`);
    expect(codeOf(PLATFORM_FOOTER)).not.toMatch(/buildPlatformUrl/);
  });
});
