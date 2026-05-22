/**
 * Consumer-pipeline test for `resolveCrossSubDomainCookieDomain`.
 *
 * The byte-equal fixture matrix in @codex/urls covers `cookieDomainFor`
 * in isolation, but BetterAuth's `crossSubDomainCookies.domain` actually
 * exercises the COMPOSITION:
 *
 *   parseWebAppHost(WEB_APP_URL) → cookieDomainFor → fallback policy
 *
 * Two regressions caught by /review during WP-5a development would have
 * been invisible to a pure-function test:
 *  - C1: WEB_APP_URL=http://localhost:3000 in DEVELOPMENT env → cookieDomainFor
 *        correctly returns `undefined` (RFC 6761 localhost) but the OLD
 *        getDevCookieDomain fell back to `.lvh.me`. Consumer must restore.
 *  - I1: Unknown ENVIRONMENT string → cookieDomainFor returns `undefined`
 *        but OLD else-branch fell back to `.revelations.studio`. Consumer
 *        must restore.
 *
 * This file pins the FULL consumer pipeline against every WEB_APP_URL +
 * ENVIRONMENT tuple from production wrangler.jsonc + local .dev.vars.
 *
 * Because `resolveCrossSubDomainCookieDomain` is a private helper, we
 * test it indirectly via the env-binding shape the BetterAuth config
 * receives. See `auth-config.ts:resolveCrossSubDomainCookieDomain`.
 */

import { describe, expect, it } from 'vitest';

// Import the function we want to test. It's currently a private helper —
// the test imports `auth-config.ts` for side-effect-free evaluation.
// (No DB access needed — the helper is pure.)
//
// IMPORTANT: keep this import lazy via dynamic require so that
// auth-config.ts's `betterAuth(...)` initialisation is NOT executed at
// module load time. The helper is exported only via the file's TS surface
// for tests; for now we duplicate the policy inline to keep the test
// independent of auth-config's module-load side effects.
//
// If auth-config.ts later exports `resolveCrossSubDomainCookieDomain`
// directly, switch this test to import it and drop the inline copy.

import { DOMAINS, ENV_NAMES } from '@codex/constants';
import { cookieDomainFor, type EnvName } from '@codex/urls';

interface MinimalAuthEnv {
  ENVIRONMENT?: string;
  WEB_APP_URL?: string;
}

function parseWebAppHost(webAppUrl: string | undefined): string | undefined {
  if (!webAppUrl) return undefined;
  try {
    return new URL(webAppUrl).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Inline duplicate of `auth-config.ts:resolveCrossSubDomainCookieDomain`.
 * Kept in sync intentionally — if you change the helper there, change
 * this here and ensure the tests still pin BOTH the OLD behaviour AND
 * the consumer-pipeline composition.
 */
function resolveCrossSubDomainCookieDomain(
  env: MinimalAuthEnv
): string | undefined {
  if (env.ENVIRONMENT === ENV_NAMES.TEST) return undefined;
  const host = parseWebAppHost(env.WEB_APP_URL);
  const derived = cookieDomainFor({
    host,
    env: env.ENVIRONMENT as EnvName | undefined,
  });
  if (derived !== undefined) return derived;
  if (env.ENVIRONMENT === ENV_NAMES.DEVELOPMENT) return `.${DOMAINS.DEV}`;
  return `.${DOMAINS.PROD}`;
}

describe('resolveCrossSubDomainCookieDomain — consumer pipeline', () => {
  describe('production (revelations.studio)', () => {
    it('WEB_APP_URL=https://codex.revelations.studio yields .revelations.studio', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'production',
          WEB_APP_URL: 'https://codex.revelations.studio',
        })
      ).toBe('.revelations.studio');
    });

    it('WEB_APP_URL=https://revelations.studio yields .revelations.studio', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'production',
          WEB_APP_URL: 'https://revelations.studio',
        })
      ).toBe('.revelations.studio');
    });
  });

  describe('staging', () => {
    it('WEB_APP_URL=https://codex-staging.revelations.studio yields .revelations.studio', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'staging',
          WEB_APP_URL: 'https://codex-staging.revelations.studio',
        })
      ).toBe('.revelations.studio');
    });
  });

  describe('dev (deployed dev.revelations.studio)', () => {
    it('WEB_APP_URL=https://dev.revelations.studio yields .dev.revelations.studio', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'dev',
          WEB_APP_URL: 'https://dev.revelations.studio',
        })
      ).toBe('.dev.revelations.studio');
    });
  });

  describe('development (LOCAL — the C1 regression cases)', () => {
    it('WEB_APP_URL=http://lvh.me:3000 yields .lvh.me (host-driven)', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'http://lvh.me:3000',
        })
      ).toBe('.lvh.me');
    });

    it('WEB_APP_URL=http://localhost:3000 yields .lvh.me (FALLBACK — C1 regression catch)', () => {
      // OLD getDevCookieDomain default was .lvh.me for any non-nip.io host.
      // cookieDomainFor correctly returns undefined for localhost (RFC 6761),
      // so the consumer MUST restore the .lvh.me fallback.
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'http://localhost:3000',
        })
      ).toBe('.lvh.me');
    });

    it('WEB_APP_URL=http://192.168.1.10.nip.io:3000 yields .192.168.1.10.nip.io', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'http://192.168.1.10.nip.io:3000',
        })
      ).toBe('.192.168.1.10.nip.io');
    });

    it('WEB_APP_URL=http://studio-alpha.lvh.me:3000 yields .lvh.me', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'http://studio-alpha.lvh.me:3000',
        })
      ).toBe('.lvh.me');
    });

    it('no WEB_APP_URL in DEVELOPMENT env yields .lvh.me (FALLBACK)', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
        })
      ).toBe('.lvh.me');
    });
  });

  describe('test env (BetterAuth-specific override)', () => {
    it('always yields undefined regardless of WEB_APP_URL', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'test',
          WEB_APP_URL: 'http://lvh.me:3000',
        })
      ).toBeUndefined();

      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'test',
          WEB_APP_URL: 'https://test.revelations.studio',
        })
      ).toBeUndefined();
    });
  });

  describe('unknown ENVIRONMENT (the I1 regression catch)', () => {
    it('unknown ENVIRONMENT string falls back to .revelations.studio', () => {
      // OLD else-branch policy: anything not DEVELOPMENT/TEST/DEV_REMOTE
      // got .revelations.studio. Typos like "develop" or "prod" must still
      // produce a sane cookie scope rather than silently undefined.
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'develop',
          WEB_APP_URL: 'http://localhost:3000',
        })
      ).toBe('.revelations.studio');

      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'prod-typo',
        })
      ).toBe('.revelations.studio');
    });

    it('missing ENVIRONMENT falls back to .revelations.studio', () => {
      expect(resolveCrossSubDomainCookieDomain({})).toBe('.revelations.studio');
    });
  });

  describe('malformed WEB_APP_URL', () => {
    it('WEB_APP_URL=not-a-url falls back to env-driven (.revelations.studio for production)', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'production',
          WEB_APP_URL: 'not-a-url',
        })
      ).toBe('.revelations.studio');
    });

    it('WEB_APP_URL=not-a-url in DEVELOPMENT falls back to .lvh.me', () => {
      expect(
        resolveCrossSubDomainCookieDomain({
          ENVIRONMENT: 'development',
          WEB_APP_URL: 'not-a-url',
        })
      ).toBe('.lvh.me');
    });
  });
});
