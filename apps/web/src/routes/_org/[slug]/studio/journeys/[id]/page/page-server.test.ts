import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

type LoadEvent = Parameters<typeof load>[0];

function eventFor(userRole: string | null): LoadEvent {
  return { parent: async () => ({ userRole }) } as unknown as LoadEvent;
}

describe('page editor route guard', () => {
  it.each(['owner', 'admin'])('lets an %s in', async (role) => {
    await expect(load(eventFor(role))).resolves.toEqual({});
  });

  it.each([
    'creator',
    'member',
    null,
  ])('sends %s back to the studio', async (role) => {
    await expect(load(eventFor(role))).rejects.toMatchObject({
      status: 303,
      location: '/studio',
    });
  });
});
