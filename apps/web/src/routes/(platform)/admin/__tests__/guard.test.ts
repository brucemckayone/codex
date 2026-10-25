/**
 * The /admin guard (Codex-2hxff.28, data design §0). The platform owner gets
 * the pages; everyone else, signed in or not, gets the 404 a missing page
 * gets, so the area's existence isn't revealed. No API call is made either
 * way: the role is on the session.
 *
 * `@sveltejs/kit` is real: `error()` throws the HttpError under test.
 */

import { describe, expect, test, vi } from 'vitest';
import { load as guard } from '../+layout.server';
import { load as adminIndex } from '../+page';

type GuardEvent = Parameters<typeof guard>[0];

function run(user: { role: string } | null) {
  const setHeaders = vi.fn();
  const event = { locals: { user }, setHeaders } as unknown as GuardEvent;
  return { call: () => guard(event), setHeaders };
}

function statusOf(thrown: () => unknown): number | null {
  try {
    thrown();
    return null;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('the /admin guard', () => {
  test.each([
    ['anonymous', null],
    ['a customer', { role: 'customer' }],
    ['a creator', { role: 'creator' }],
    ['an organisation owner or admin', { role: 'admin' }],
  ])('%s gets a 404', (_who, user) => {
    const { call, setHeaders } = run(user);
    expect(statusOf(call)).toBe(404);
    // Private even on the 404: nothing here is for a shared cache.
    expect(setHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': expect.stringContaining('private'),
      })
    );
  });

  test('the platform owner gets the pages', () => {
    const { call } = run({ role: 'platform_owner' });
    expect(statusOf(call)).toBeNull();
    expect(call()).toEqual({});
  });
});

describe('/admin', () => {
  test('opens on the queue', () => {
    let thrown: unknown;
    try {
      adminIndex({} as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 307, location: '/admin/queue' });
  });
});
