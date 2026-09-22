import { describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

/**
 * Footer legal links must stay RELATIVE. (Codex-6wkr1)
 *
 * This file previously asserted the OPPOSITE. That was a regression, caught in
 * review, and these inverted assertions are the guard against reintroducing it
 * — so read the reasoning before "fixing" them back.
 *
 * WHY RELATIVE IS CORRECT HERE. This component is mounted ONLY by
 * `routes/(platform)/+layout.svelte`, and the `(platform)` group is reachable on
 * exactly two host classes:
 *   1. the apex — `revelations.studio`
 *   2. a RESERVED subdomain — `hooks.ts` does
 *      `if (isReservedSubdomain(subdomain)) return pathname`, returning the path
 *      UNREWRITTEN, so `(platform)/terms` renders in place.
 * A relative `/terms` resolves correctly on both.
 *
 * WHY ABSOLUTE WAS WRONG. `buildPlatformUrl` collapses a subdomain to the apex,
 * so on `staging.revelations.studio` it yields `https://revelations.studio/terms`
 * — sending a staging viewer to PRODUCTION. Measured:
 *   staging.revelations.studio        -> https://revelations.studio/terms
 *   codex-staging.revelations.studio  -> https://revelations.studio/terms
 *   dev.revelations.studio            -> https://dev.revelations.studio/terms
 * `dev` survives only because it is a recognised apex in `parseHost`; `staging`
 * is not, and collapses.
 *
 * THE TRAP THAT CAUSED THIS. `isReservedSubdomain('staging')` is TRUE, and so is
 * `isReservedSubdomain('codex-staging')` — via a suffix rule, NOT via membership
 * in `STATIC_RESERVED_SUBDOMAINS` (which contains `api-staging` but not bare
 * `staging`). Grepping the list gives the wrong answer; run the predicate.
 *
 * WHERE THE REAL 404 IS. Not here. Org subdomains never mount this component —
 * they have their own inline footer in `routes/_org/[slug]/+layout.svelte`, which
 * DOES need `buildPlatformUrl` because a tenant host IS rewritten to
 * `/_org/<slug>/...`. The two footers need OPPOSITE treatments because they
 * render on different host classes. `org-footer-legal-links.test.ts` pins that
 * side, and this file pins this one.
 */

vi.mock('$app/state', () => ({
  get page() {
    return {
      get url() {
        return new URL('https://revelations.studio/');
      },
    };
  },
}));

const Footer = (await import('../Footer.svelte')).default;

function renderFooter() {
  const component = mount(Footer, { target: document.body });
  flushSync();
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a.footer-link')
  ).map((a) => a.getAttribute('href'));
  unmount(component);
  document.body.innerHTML = '';
  return links;
}

describe('Footer — legal links stay relative (Codex-6wkr1)', () => {
  test('all three legal links are relative, in order', () => {
    // The guard. An absolute apex URL here breaks every reserved subdomain, and
    // staging is the host where nobody would notice.
    expect(renderFooter()).toEqual(['/about', '/terms', '/privacy']);
  });

  test('no link is absolute', () => {
    // Stated as a property rather than exact strings, so renaming a path does
    // not quietly disable the guard.
    for (const href of renderFooter()) {
      expect(href).not.toMatch(/^https?:\/\//);
      expect(href?.startsWith('/')).toBe(true);
    }
  });

  test('exactly three footer links render (control)', () => {
    // A real control: passes whichever way the hrefs are written. Without it, a
    // footer that rendered nothing would make both assertions above vacuous.
    expect(renderFooter()).toHaveLength(3);
  });
});
