/**
 * Behavioural unit tests for studio-access helpers.
 *
 * Added as part of triage iter-006 (cluster-defect team cycle, R1 exception).
 * The F1 fix (Codex-w30gi) replaced two inline `STUDIO_ROLES` triples in
 * SidebarRail.svelte and SidebarRailUserSection.svelte with `useStudioAccess()`
 * — the structural F1 proof test (grep assertion) confirmed the dedup but did
 * NOT verify behavioural correctness of the canonical helpers the consumers
 * now rely on. This file covers that gap per skill R10 (test-gate before close).
 *
 * Scope: pure helpers (`hasStudioRole`, `resolveStudioHref`, `getInitials`,
 * `STUDIO_ROLES` membership). The reactive composable `useStudioAccess` wraps
 * these in `$derived` and is correct by construction if the pure functions are.
 */

import { AUTH_ROLES } from '@codex/constants';
import { describe, expect, test } from 'vitest';

import {
  getInitials,
  hasStudioRole,
  resolveStudioHref,
  STUDIO_ROLES,
} from './studio-access.svelte';

describe('studio-access', () => {
  describe('STUDIO_ROLES', () => {
    test('contains creator, admin, platform_owner', () => {
      expect(STUDIO_ROLES.has(AUTH_ROLES.CREATOR)).toBe(true);
      expect(STUDIO_ROLES.has(AUTH_ROLES.ADMIN)).toBe(true);
      expect(STUDIO_ROLES.has(AUTH_ROLES.PLATFORM_OWNER)).toBe(true);
    });

    test('does not contain customer', () => {
      expect(STUDIO_ROLES.has(AUTH_ROLES.CUSTOMER)).toBe(false);
    });

    test('does not contain arbitrary unknown role', () => {
      expect(STUDIO_ROLES.has('not-a-real-role')).toBe(false);
    });
  });

  describe('hasStudioRole', () => {
    test('returns true for studio-eligible roles', () => {
      expect(
        hasStudioRole({ id: '1', role: AUTH_ROLES.CREATOR } as never)
      ).toBe(true);
      expect(hasStudioRole({ id: '1', role: AUTH_ROLES.ADMIN } as never)).toBe(
        true
      );
      expect(
        hasStudioRole({ id: '1', role: AUTH_ROLES.PLATFORM_OWNER } as never)
      ).toBe(true);
    });

    test('returns false for non-studio roles', () => {
      expect(
        hasStudioRole({ id: '1', role: AUTH_ROLES.CUSTOMER } as never)
      ).toBe(false);
    });

    test('returns false for null user (unauthenticated)', () => {
      expect(hasStudioRole(null)).toBe(false);
    });

    test('returns false for undefined user', () => {
      expect(hasStudioRole(undefined)).toBe(false);
    });

    test('returns false for user without a role field', () => {
      expect(hasStudioRole({ id: '1' } as never)).toBe(false);
    });
  });

  describe('resolveStudioHref', () => {
    test('returns root-relative /studio on org subdomain', () => {
      const url = new URL('https://acme.lvh.me:3000/some/page');
      expect(resolveStudioHref(url)).toBe('/studio');
    });

    test('returns root-relative /studio on any non-creators non-www subdomain', () => {
      const url = new URL('https://bruce-studio.lvh.me:3000/explore');
      expect(resolveStudioHref(url)).toBe('/studio');
    });

    test('returns cross-subdomain creators URL when on creators subdomain', () => {
      const url = new URL('https://creators.lvh.me:3000/');
      const result = resolveStudioHref(url);
      expect(result).toContain('/studio');
      expect(result).toContain('creators');
    });

    test('returns cross-subdomain creators URL when on www subdomain', () => {
      const url = new URL('https://www.lvh.me:3000/');
      const result = resolveStudioHref(url);
      expect(result).toContain('/studio');
      expect(result).toContain('creators');
    });

    test('returns cross-subdomain creators URL when no subdomain (platform)', () => {
      const url = new URL('https://lvh.me:3000/');
      const result = resolveStudioHref(url);
      expect(result).toContain('/studio');
    });
  });

  describe('getInitials', () => {
    test('returns first letter of up to two whitespace-separated tokens, uppercased', () => {
      expect(getInitials('Jane Doe')).toBe('JD');
      expect(getInitials('Alice Bob Charlie')).toBe('AB');
    });

    test('returns single uppercased letter for single-word name', () => {
      expect(getInitials('Single')).toBe('S');
      expect(getInitials('lowercase')).toBe('L');
    });

    test('returns empty string for empty input', () => {
      expect(getInitials('')).toBe('');
    });

    test('handles whitespace-only input gracefully', () => {
      expect(getInitials('   ')).toBe('');
    });
  });
});
