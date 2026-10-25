/**
 * The extra columns BetterAuth manages on `users` (Codex-cslai).
 *
 * `role` decides authorisation (`procedure()` grants `auth: 'platform_owner'`
 * from it), so a client must never set it. BetterAuth copies any additional
 * field from the request body of POST /sign-up/email and POST /update-user
 * unless the field says `input: false`; without it, `{"role":
 * "platform_owner"}` made anyone a platform owner. With it, sign-up stores the
 * default and update-user answers 400.
 *
 * Roles change server-side only: identity-service `upgradeToCreator`, and the
 * dev/test fast-register endpoint's own database write.
 */

import { AUTH_ROLES } from '@codex/constants';

export const USER_ADDITIONAL_FIELDS = {
  role: {
    type: 'string',
    required: true,
    defaultValue: AUTH_ROLES.USER,
    input: false,
  },
} as const;
