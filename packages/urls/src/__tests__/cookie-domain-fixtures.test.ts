/**
 * Byte-equal fixture matrix for `cookieDomainFor` — MERGE GATE for WP-5a.
 *
 * Every known host that exists in any deployed env (or in any developer's
 * local setup) is enumerated here with the exact `Domain` attribute string
 * the cookie MUST carry. If this test fails, an existing session's cookie
 * scope would shift — browsers would treat the new cookie as a different
 * entry from the existing one, and users could see "logged out" UX even
 * though the session row in DB is still valid.
 *
 * Three originally-divergent implementations were unified into the single
 * `cookieDomainFor` function:
 *  1. `@codex/constants/src/cookies.ts` `getCookieConfig` (host-driven)
 *  2. `workers/auth/src/auth-config.ts` `getDevCookieDomain` (WEB_APP_URL-driven)
 *  3. `workers/auth/src/auth-config.ts` `crossSubDomainCookies.domain` ternary (env-driven)
 *
 * This test asserts the NEW function's output matches what the OLD ones
 * collectively produced for the same routing context. It is THE rollback-
 * safety guarantee for WP-5a.
 *
 * ### When this test fails
 *
 * STOP. Do not merge the PR. Likely causes:
 *  - Output drifted (case, leading dot, port-stripping) — must restore exact match
 *  - A new env or host pattern was added without updating the fixture matrix
 *  - The host-classification ordering changed (dev.revelations.studio MUST
 *    come before the generic revelations.studio check)
 */

import { describe, expect, it } from 'vitest';
import { cookieDomainFor } from '../cookie-domain';
import type { EnvName } from '../types';

interface Fixture {
  description: string;
  input: { host?: string; env?: EnvName | Record<string, unknown> };
  expected: string | undefined;
}

const HOST_DRIVEN_FIXTURES: Fixture[] = [
  // ─── Local dev: localhost / 127.x.x.x → no Domain ────────────────────
  {
    description: 'localhost (no Domain — browser rejects per RFC 6761)',
    input: { host: 'localhost:3000' },
    expected: undefined,
  },
  {
    description: 'localhost without port',
    input: { host: 'localhost' },
    expected: undefined,
  },
  {
    description: '127.0.0.1 with port',
    input: { host: '127.0.0.1:3000' },
    expected: undefined,
  },
  {
    description: '127.0.0.1 without port',
    input: { host: '127.0.0.1' },
    expected: undefined,
  },

  // ─── Local dev: lvh.me cross-subdomain ───────────────────────────────
  {
    description: 'bare lvh.me with port',
    input: { host: 'lvh.me:3000' },
    expected: '.lvh.me',
  },
  {
    description: 'org subdomain on lvh.me',
    input: { host: 'studio-alpha.lvh.me:3000' },
    expected: '.lvh.me',
  },
  {
    description: 'creators subdomain on lvh.me',
    input: { host: 'creators.lvh.me:3000' },
    expected: '.lvh.me',
  },
  {
    description: 'auth subdomain on lvh.me',
    input: { host: 'auth.lvh.me:3000' },
    expected: '.lvh.me',
  },

  // ─── Local dev: nip.io LAN testing ───────────────────────────────────
  {
    description: 'bare {ip}.nip.io',
    input: { host: '192.168.1.10.nip.io:3000' },
    expected: '.192.168.1.10.nip.io',
  },
  {
    description: 'org subdomain on {ip}.nip.io',
    input: { host: 'studio-alpha.192.168.1.10.nip.io:3000' },
    expected: '.192.168.1.10.nip.io',
  },
  {
    description: 'different IP under nip.io',
    input: { host: 'bruce-studio.10.0.0.5.nip.io:3000' },
    expected: '.10.0.0.5.nip.io',
  },

  // ─── Deployed dev: dev.revelations.studio ────────────────────────────
  {
    description: 'bare dev.revelations.studio (platform apex)',
    input: { host: 'dev.revelations.studio' },
    expected: '.dev.revelations.studio',
  },
  {
    description: 'org subdomain on dev.revelations.studio',
    input: { host: 'studio-alpha.dev.revelations.studio' },
    expected: '.dev.revelations.studio',
  },
  {
    description: 'auth subdomain on dev.revelations.studio',
    input: { host: 'auth.dev.revelations.studio' },
    expected: '.dev.revelations.studio',
  },
  {
    description: 'content-api subdomain on dev.revelations.studio',
    input: { host: 'content-api.dev.revelations.studio' },
    expected: '.dev.revelations.studio',
  },

  // ─── Production: revelations.studio ──────────────────────────────────
  {
    description: 'bare revelations.studio',
    input: { host: 'revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'org subdomain on revelations.studio',
    input: { host: 'yoga-studio.revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'www on revelations.studio',
    input: { host: 'www.revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'creators on revelations.studio',
    input: { host: 'creators.revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'auth subdomain on revelations.studio',
    input: { host: 'auth.revelations.studio' },
    expected: '.revelations.studio',
  },

  // ─── Staging: -staging suffix pattern on revelations.studio ──────────
  {
    description: 'codex-staging.revelations.studio (staging platform)',
    input: { host: 'codex-staging.revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'studio-alpha-staging.revelations.studio (staging org)',
    input: { host: 'studio-alpha-staging.revelations.studio' },
    expected: '.revelations.studio',
  },
  {
    description: 'auth-staging.revelations.studio (staging worker)',
    input: { host: 'auth-staging.revelations.studio' },
    expected: '.revelations.studio',
  },
];

const ENV_DRIVEN_FIXTURES: Fixture[] = [
  // ─── No host: derived purely from EnvName string ──────────────────────
  {
    description: 'env=production yields .revelations.studio',
    input: { env: 'production' },
    expected: '.revelations.studio',
  },
  {
    description: 'env=staging yields .revelations.studio (under same apex)',
    input: { env: 'staging' },
    expected: '.revelations.studio',
  },
  {
    description: 'env=dev yields .dev.revelations.studio',
    input: { env: 'dev' },
    expected: '.dev.revelations.studio',
  },
  {
    description:
      'env=development yields undefined (local dev hosts are ambiguous without host signal — caller must provide host)',
    input: { env: 'development' },
    expected: undefined,
  },
  {
    description: 'env=test yields undefined (tests use exact origin)',
    input: { env: 'test' },
    expected: undefined,
  },

  // ─── No host: derived from Env-shaped object ──────────────────────────
  {
    description: 'Env.ENVIRONMENT=production',
    input: { env: { ENVIRONMENT: 'production' } },
    expected: '.revelations.studio',
  },
  {
    description: 'Env.ENVIRONMENT=dev',
    input: { env: { ENVIRONMENT: 'dev' } },
    expected: '.dev.revelations.studio',
  },
  {
    description:
      'Env.MODE=development (no host) yields undefined — same ambiguity rule',
    input: { env: { MODE: 'development' } },
    expected: undefined,
  },
];

const OVERRIDE_FIXTURES: Fixture[] = [
  // ─── COOKIE_DOMAIN env override ──────────────────────────────────────
  {
    description: 'COOKIE_DOMAIN override wins on revelations.studio host',
    input: {
      host: 'revelations.studio',
      env: { ENVIRONMENT: 'production', COOKIE_DOMAIN: '.custom.example.com' },
    },
    expected: '.custom.example.com',
  },
  {
    description: 'COOKIE_DOMAIN override wins on env-driven prod (no host)',
    input: {
      env: { ENVIRONMENT: 'production', COOKIE_DOMAIN: '.tenant.example.org' },
    },
    expected: '.tenant.example.org',
  },
  {
    description: 'COOKIE_DOMAIN ignored on lvh.me host (host wins)',
    input: {
      host: 'studio-alpha.lvh.me:3000',
      env: { COOKIE_DOMAIN: '.this-should-be-ignored.com' },
    },
    expected: '.lvh.me',
  },
];

const EDGE_FIXTURES: Fixture[] = [
  // ─── Case insensitivity (DNS is case-insensitive per RFC 4343) ───────
  {
    description: 'uppercase LVH.ME normalized to .lvh.me',
    input: { host: 'LVH.ME:3000' },
    expected: '.lvh.me',
  },
  {
    description: 'mixed-case Studio-Alpha.Dev.Revelations.Studio',
    input: { host: 'Studio-Alpha.Dev.Revelations.Studio' },
    expected: '.dev.revelations.studio',
  },
  {
    description: 'uppercase REVELATIONS.STUDIO',
    input: { host: 'REVELATIONS.STUDIO' },
    expected: '.revelations.studio',
  },

  // ─── Unknown host with env fallback ──────────────────────────────────
  {
    description: 'unknown host + env=production → falls to .revelations.studio',
    input: { host: 'custom-tenant.example.com', env: 'production' },
    expected: '.revelations.studio',
  },
  {
    description: 'unknown host + no env → undefined',
    input: { host: 'unknown.example.com' },
    expected: undefined,
  },

  // ─── Empty input ──────────────────────────────────────────────────────
  {
    description: 'empty input → undefined',
    input: {},
    expected: undefined,
  },

  // ─── Priority: dev.revelations.studio MUST win over generic prod ─────
  {
    description: 'priority check: dev.revelations.studio NOT matched by prod',
    input: { host: 'dev.revelations.studio', env: 'production' },
    expected: '.dev.revelations.studio',
  },

  // ─── Adversarial host: must NOT match without proper separator ────────
  {
    description:
      'adversarial host evil-revelations.studio (no dot separator) → unknown, no domain',
    input: { host: 'evil-revelations.studio' },
    expected: undefined,
  },
  {
    description:
      'adversarial host fakerevelations.studio (no dash either) → unknown, no domain',
    input: { host: 'fakerevelations.studio' },
    expected: undefined,
  },
  {
    description:
      'host with revelations.studio in middle but different TLD → unknown',
    input: { host: 'attacker.revelations.studio.io' },
    expected: undefined,
  },
];

describe('cookieDomainFor — byte-equal fixture matrix (MERGE GATE)', () => {
  describe('host-driven path', () => {
    it.each(HOST_DRIVEN_FIXTURES)('$description', ({ input, expected }) => {
      expect(cookieDomainFor(input)).toBe(expected);
    });
  });

  describe('env-driven path (no host)', () => {
    it.each(ENV_DRIVEN_FIXTURES)('$description', ({ input, expected }) => {
      expect(cookieDomainFor(input)).toBe(expected);
    });
  });

  describe('COOKIE_DOMAIN override', () => {
    it.each(OVERRIDE_FIXTURES)('$description', ({ input, expected }) => {
      expect(cookieDomainFor(input)).toBe(expected);
    });
  });

  describe('edge cases (case, unknown, empty, priority)', () => {
    it.each(EDGE_FIXTURES)('$description', ({ input, expected }) => {
      expect(cookieDomainFor(input)).toBe(expected);
    });
  });
});
