import { describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

/**
 * Footer legal links must be apex-pinned. (Codex-6wkr1)
 *
 * `/about`, `/terms` and `/privacy` exist ONLY in the `(platform)` route group,
 * but this footer renders on every page — including org subdomains. On a tenant
 * host `hooks.ts` rewrites a relative `/terms` to `/_org/<slug>/terms`, and
 * `routes/_org/[slug]/` contains no such route, so all three links 404'd on
 * every tenant host. The original bead was filed for the same 404 on the apex;
 * the placeholder pages fixed the apex only and left the tenant hosts broken.
 *
 * These tests assert the RENDERED href, not the source text. A source-level
 * grep would be wrong twice over: it cannot see a link commented out, and the
 * fix's own explanatory comment in Footer.svelte contains the string
 * `/terms` — so scanning raw source would match the comment and pass while the
 * markup regressed.
 *
 * `$app/state` is mocked because `page` is request-scoped and unavailable in
 * jsdom. This is the first such mock in apps/web; `page.url` is the only member
 * the component reads.
 */

let currentUrl = new URL('https://revelations.studio/');

vi.mock('$app/state', () => ({
  get page() {
    return {
      get url() {
        return currentUrl;
      },
    };
  },
}));

// Imported AFTER the mock factory is registered.
const Footer = (await import('../Footer.svelte')).default;

function renderAt(href: string) {
  currentUrl = new URL(href);
  const component = mount(Footer, { target: document.body });
  flushSync();
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a.footer-link')
  ).map((a) => a.getAttribute('href'));
  unmount(component);
  document.body.innerHTML = '';
  return links;
}

describe('Footer — legal links are apex-pinned (Codex-6wkr1)', () => {
  test('on an ORG SUBDOMAIN every legal link points at the apex, not the tenant', () => {
    // The defect: relative hrefs here resolve to the tenant host, which
    // reroutes to /_org/<slug>/... and 404s.
    const links = renderAt('https://alice.revelations.studio/journeys/x');

    expect(links).toEqual([
      'https://revelations.studio/about',
      'https://revelations.studio/terms',
      'https://revelations.studio/privacy',
    ]);
    for (const href of links) {
      expect(href).not.toMatch(/alice\./);
    }
  });

  test('on the APEX the links resolve to the apex, now absolutely', () => {
    // NOT a control — labelled as one in the first draft and that was wrong.
    // Pre-fix this renders `/about`, which FUNCTIONED correctly on the apex but
    // is not what this asserts, so it fails pre-fix like the rest. Its value is
    // as a regression guard on the host where the links already worked.
    expect(renderAt('https://revelations.studio/discover')).toEqual([
      'https://revelations.studio/about',
      'https://revelations.studio/terms',
      'https://revelations.studio/privacy',
    ]);
  });

  test('protocol and port are preserved, so local dev is not broken', () => {
    // buildPlatformUrl derives scheme + port from the request. A hardcoded
    // https://revelations.studio would send a local developer to production.
    // `lvh.me` is the dev apex parseHost recognises (alongside `localhost`);
    // measured, not assumed.
    expect(renderAt('http://alice.lvh.me:3000/')).toEqual([
      'http://lvh.me:3000/about',
      'http://lvh.me:3000/terms',
      'http://lvh.me:3000/privacy',
    ]);
  });

  test('an UNRECOGNISED host is left untouched — the documented boundary', () => {
    // Not a bug being asserted as correct: a deliberate record of where the fix
    // does NOT reach. `parseHost` only knows revelations.studio, dev.
    // revelations.studio, lvh.me, localhost and nip.io; anything else returns
    // `env: null` and the host passes through unchanged, so on such a host
    // these links stay tenant-relative and would still 404.
    //
    // This matters because `localtest.me` appears in this repo and looks like a
    // dev host — it is the DATABASE proxy domain (db.localtest.me), NOT a web
    // apex, and parseHost does not recognise it. If the dev stack is ever moved
    // onto an unrecognised host, this test is the thing that will explain why
    // the footer links break.
    expect(renderAt('http://alice.localtest.me:3000/')).toEqual([
      'http://alice.localtest.me:3000/about',
      'http://alice.localtest.me:3000/terms',
      'http://alice.localtest.me:3000/privacy',
    ]);
  });

  test('exactly three footer links render (control)', () => {
    // A real control: passes before AND after the fix. Without it, a harness
    // that rendered nothing would make every `expect(links).toEqual([...])`
    // above vacuous, and a fix that dropped a link would read as a pass.
    expect(renderAt('https://alice.revelations.studio/')).toHaveLength(3);
  });

  test('no link is left relative', () => {
    // The property that actually matters, stated independently of the exact
    // host: a relative href is what 404s on a tenant.
    for (const href of renderAt('https://alice.revelations.studio/')) {
      expect(href).not.toBeNull();
      expect(href?.startsWith('/')).toBe(false);
    }
  });
});
