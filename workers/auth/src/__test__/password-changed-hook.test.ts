/**
 * Unit tests for handlePasswordChangedHook.
 *
 * Covers the path-matched after-hook semantics: only fire on successful
 * `/change-password`, never on reset/sign-in/set-password, never on
 * non-success response shapes, and never propagate downstream failures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../email', () => ({
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendPasswordChangedEmail } from '../email';
import {
  CHANGE_PASSWORD_PATH,
  handlePasswordChangedHook,
} from '../password-changed-hook';
import type { AuthBindings } from '../types';

const mockEnv = {
  WORKER_SHARED_SECRET: 'test-secret',
  WEB_APP_URL: 'http://localhost:3000',
} as unknown as AuthBindings;

const successUser = {
  id: 'user-123',
  email: 'alice@example.com',
  name: 'Alice',
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeCtx(overrides: { path?: string; returned?: unknown }): {
  path: string | undefined;
  context: { returned: unknown };
} {
  return {
    path: overrides.path,
    context: { returned: overrides.returned },
  };
}

describe('handlePasswordChangedHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('sends the password-changed email on successful POST /change-password', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: CHANGE_PASSWORD_PATH,
          returned: { token: null, user: successUser },
        })
      );

      expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
      expect(sendPasswordChangedEmail).toHaveBeenCalledWith(mockEnv, {
        id: successUser.id,
        email: successUser.email,
        name: successUser.name,
        emailVerified: successUser.emailVerified,
        createdAt: successUser.createdAt,
        updatedAt: successUser.updatedAt,
      });
    });

    it('fires exactly once per invocation (idempotent within a request)', async () => {
      const ctx = makeCtx({
        path: CHANGE_PASSWORD_PATH,
        returned: { user: successUser },
      });

      await handlePasswordChangedHook(mockEnv, ctx);

      expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('path exclusion (must not trigger on adjacent flows)', () => {
    it('does not send on /reset-password (reset has its own confirmation)', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: '/reset-password',
          returned: { user: successUser },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send on /set-password (no prior password = different security event)', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: '/set-password',
          returned: { status: true },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send on /sign-in/email (unrelated endpoint with user-shaped response)', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: '/sign-in/email',
          returned: { user: successUser, token: 'session-token' },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send when path is missing entirely', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({ path: undefined, returned: { user: successUser } })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });
  });

  describe('response-shape exclusion (success-only)', () => {
    it('does not send when ctx.context.returned is undefined', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({ path: CHANGE_PASSWORD_PATH, returned: undefined })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send when returned has no user (raw error/object)', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: CHANGE_PASSWORD_PATH,
          returned: { token: null },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send when returned looks like an APIError (no .user.email)', async () => {
      const apiErrorLike = {
        statusCode: 400,
        message: 'Invalid current password',
        headers: null,
      };

      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({ path: CHANGE_PASSWORD_PATH, returned: apiErrorLike })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send when user is present but email is empty', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: CHANGE_PASSWORD_PATH,
          returned: { user: { ...successUser, email: '' } },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('does not send when user.email is the wrong type', async () => {
      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: CHANGE_PASSWORD_PATH,
          returned: { user: { id: 'x', email: 12345 } },
        })
      );

      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });
  });

  describe('failure isolation', () => {
    it('resolves cleanly when sendPasswordChangedEmail rejects', async () => {
      vi.mocked(sendPasswordChangedEmail).mockRejectedValueOnce(
        new Error('notifications-api unreachable')
      );

      await expect(
        handlePasswordChangedHook(
          mockEnv,
          makeCtx({
            path: CHANGE_PASSWORD_PATH,
            returned: { user: successUser },
          })
        )
      ).resolves.toBeUndefined();
    });

    it('still attempted the send before failing (mock was called)', async () => {
      vi.mocked(sendPasswordChangedEmail).mockRejectedValueOnce(
        new Error('boom')
      );

      await handlePasswordChangedHook(
        mockEnv,
        makeCtx({
          path: CHANGE_PASSWORD_PATH,
          returned: { user: successUser },
        })
      );

      expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    });
  });
});
