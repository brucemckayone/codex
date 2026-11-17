/**
 * Ownership transfer schemas (Codex-2hxff.2): the user ids an owner offers to
 * and support reassigns to are `users.id` values, TEXT and never a uuid, so
 * they are held to `userIdSchema`'s bound and format (Codex-2hxff.46 (f)). An
 * unbounded id reached the service's lookups before.
 */

import { describe, expect, it } from 'vitest';
import { offerOwnershipSchema, reassignOwnerSchema } from '../organization';

// A BetterAuth id, as `users.id` holds it.
const USER_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';
const TOO_LONG = 'a'.repeat(65);

describe('offerOwnershipSchema', () => {
  const offer = (recipientUserId: string) =>
    offerOwnershipSchema.safeParse({
      recipientUserId,
      confirmName: 'Studio Alpha',
    });

  it('accepts a user id, trimmed, up to 64 characters', () => {
    expect(offer(` ${USER_ID} `)).toMatchObject({
      success: true,
      data: { recipientUserId: USER_ID },
    });
    expect(offer('a'.repeat(64)).success).toBe(true);
  });

  it('refuses an over-long id', () => {
    const result = offer(TOO_LONG);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('User ID is too long');
  });

  it('refuses an id that is not a users.id', () => {
    expect(offer('not a user; id').success).toBe(false);
  });

  it('keeps its own message for an empty recipient', () => {
    const result = offer('   ');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Choose who to offer ownership to'
    );
  });
});

describe('reassignOwnerSchema', () => {
  const reassign = (userId: string) =>
    reassignOwnerSchema.safeParse({ userId, reason: 'owner unreachable' });

  it('accepts a user id, trimmed', () => {
    expect(reassign(` ${USER_ID} `)).toMatchObject({
      success: true,
      data: { userId: USER_ID },
    });
  });

  it('refuses an over-long id', () => {
    const result = reassign(TOO_LONG);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('User ID is too long');
  });

  it('refuses an empty id', () => {
    expect(reassign('  ').success).toBe(false);
  });
});
