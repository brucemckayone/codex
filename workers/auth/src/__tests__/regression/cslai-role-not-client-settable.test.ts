/**
 * Codex-cslai: a client can never set its own role.
 *
 * BetterAuth copies every additional user field from the request body of
 * POST /sign-up/email and POST /update-user unless the field is
 * `input: false`. `role` lacked it, so `{"role": "platform_owner"}` on
 * sign-up (anonymous) or update-user (any signed-in user) made the account a
 * platform owner. These run BetterAuth's own parser on the fields the auth
 * worker really configures.
 */
import { AUTH_ROLES } from '@codex/constants';
import type { BetterAuthOptions } from 'better-auth';
import { parseUserInput } from 'better-auth/db';
import { describe, expect, it } from 'vitest';
import { USER_ADDITIONAL_FIELDS } from '../../user-fields';

const options = {
  user: { additionalFields: USER_ADDITIONAL_FIELDS },
} as BetterAuthOptions;

describe('a client can never set its own role (Codex-cslai)', () => {
  it('sign-up stores the default, whatever role the body names', () => {
    const data = parseUserInput(
      options,
      {
        name: 'Mallory',
        email: 'mallory@example.test',
        role: AUTH_ROLES.PLATFORM_OWNER,
      },
      'create'
    );

    expect(data.role).toBe(AUTH_ROLES.USER);
  });

  it('update-user refuses a role outright', () => {
    expect(() =>
      parseUserInput(options, { role: AUTH_ROLES.PLATFORM_OWNER }, 'update')
    ).toThrow(/role is not allowed to be set/);
  });

  it('the guard is what stops it: without input:false the body is stored', () => {
    const open = {
      user: {
        additionalFields: {
          role: { ...USER_ADDITIONAL_FIELDS.role, input: true },
        },
      },
    } as BetterAuthOptions;

    expect(
      parseUserInput(open, { role: AUTH_ROLES.PLATFORM_OWNER }, 'create').role
    ).toBe(AUTH_ROLES.PLATFORM_OWNER);
  });
});
