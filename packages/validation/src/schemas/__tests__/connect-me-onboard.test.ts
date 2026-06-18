/**
 * Unit tests for `connectMeOnboardSchema` (Codex-69t7c.3 / WP3).
 *
 * The creator-scoped onboarding body carries ONLY return/refresh URLs — never a
 * client-supplied org/user id (IDOR prevention, epic decision D8). These tests
 * lock the security-relevant negatives: open-redirect protocols and untrusted
 * domains are rejected, and smuggled identity fields are stripped.
 */
import { describe, expect, it } from 'vitest';
import { connectMeOnboardSchema } from '../subscription';

describe('connectMeOnboardSchema (WP3 / Codex-69t7c.3)', () => {
  const returnUrl =
    'http://localhost:3000/creators/studio/earnings?connect=success';
  const refreshUrl =
    'http://localhost:3000/creators/studio/earnings?connect=refresh';

  it('accepts valid trusted-domain return/refresh URLs', () => {
    const result = connectMeOnboardSchema.parse({ returnUrl, refreshUrl });
    expect(result).toEqual({ returnUrl, refreshUrl });
  });

  it('strips any smuggled organizationId / userId (creator is session-scoped)', () => {
    const parsed = connectMeOnboardSchema.parse({
      returnUrl,
      refreshUrl,
      organizationId: '11111111-1111-4111-8111-111111111111',
      userId: 'attacker-supplied-id',
    }) as Record<string, unknown>;

    expect(parsed.organizationId).toBeUndefined();
    expect(parsed.userId).toBeUndefined();
    expect(parsed).toEqual({ returnUrl, refreshUrl });
  });

  it('rejects a missing returnUrl', () => {
    expect(() => connectMeOnboardSchema.parse({ refreshUrl })).toThrow();
  });

  it('rejects a missing refreshUrl', () => {
    expect(() => connectMeOnboardSchema.parse({ returnUrl })).toThrow();
  });

  it('rejects a javascript: protocol URL (XSS / open-redirect guard)', () => {
    expect(() =>
      connectMeOnboardSchema.parse({
        returnUrl: 'javascript:alert(1)',
        refreshUrl,
      })
    ).toThrow();
  });

  it('rejects an untrusted external domain (open-redirect guard)', () => {
    expect(() =>
      connectMeOnboardSchema.parse({
        returnUrl: 'https://evil.example.com/phish',
        refreshUrl,
      })
    ).toThrow();
  });
});
