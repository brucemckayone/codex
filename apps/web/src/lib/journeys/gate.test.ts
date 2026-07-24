import { describe, expect, it } from 'vitest';
import { evaluateCourseGate } from './gate';

describe('evaluateCourseGate', () => {
  it('404s when no course resolves for the slug', () => {
    expect(
      evaluateCourseGate({
        courseExists: false,
        isAuthenticated: true,
        canEnterCourse: true,
      })
    ).toEqual({ kind: 'not-found' });
  });

  it('redirects an anonymous visitor to the sales page', () => {
    expect(
      evaluateCourseGate({
        courseExists: true,
        isAuthenticated: false,
        canEnterCourse: false,
      })
    ).toEqual({ kind: 'redirect-to-sales' });
  });

  it('redirects an authed-but-not-entitled user to the sales page', () => {
    expect(
      evaluateCourseGate({
        courseExists: true,
        isAuthenticated: true,
        canEnterCourse: false,
      })
    ).toEqual({ kind: 'redirect-to-sales' });
  });

  it('proceeds for an entitled member', () => {
    expect(
      evaluateCourseGate({
        courseExists: true,
        isAuthenticated: true,
        canEnterCourse: true,
      })
    ).toEqual({ kind: 'ok' });
  });

  it('404 takes precedence over the auth/entitlement checks', () => {
    // Nothing to sell → never leak "sign in to buy this" for a missing course.
    expect(
      evaluateCourseGate({
        courseExists: false,
        isAuthenticated: false,
        canEnterCourse: false,
      })
    ).toEqual({ kind: 'not-found' });
  });
});
