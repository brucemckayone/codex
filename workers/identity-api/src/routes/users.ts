/**
 * User Management Endpoints
 *
 * RESTful API for user profile management including avatar uploads.
 * All routes require authentication.
 *
 * Endpoints:
 * - POST /api/user/avatar - Upload user avatar
 */

import {
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@codex/image-processing';
import { NotFoundError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import {
  deleteAccountSchema,
  publicProfileParamsSchema,
  updateCreatorOnboardingSchema,
  updateNotificationPreferencesSchema,
  updateProfileSchema,
  upgradeToCreatorSchema,
} from '@codex/validation';
import { multipartProcedure, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

/**
 * GET /api/user/public/:username
 * Public creator profile — the ONLY anonymous route in this worker.
 *
 * The three `creators.<host>/<username>` page loads have always called this
 * path; nothing served it, so every call 404'd into their `catch` and the
 * profile rendered as a placeholder (URL handle for a name, letter avatar,
 * boilerplate bio, no social links) for every creator on the platform.
 *
 * Security shape, since this is unauthenticated and enumerable by design:
 * - `auth: 'none'` — no session is resolved, so the body cannot vary by viewer
 * - `cache: 'public'` — legal only because of the line above; the type system
 *   rejects `public` on an authenticated route (`CachePolicyRule`)
 * - `rateLimit: 'api'` — 100/min per subject. identity-api declares the
 *   matching `RATE_LIMIT_API` binding, without which the preset would fail
 *   OPEN and log `rate_limit.fail_open` on every request
 * - params are slug-validated, so arbitrary path input never reaches Neon
 * - the service returns only { id, name, image, bio, socialLinks } from an
 *   explicit column allowlist — no email, no role
 *
 * An unknown username returns 404 via NotFoundError, which is deliberately
 * indistinguishable from "this user has no public profile": a caller must not
 * be able to tell a non-existent handle from a private one.
 */
app.get(
  '/public/:username',
  procedure({
    policy: { auth: 'none', rateLimit: 'api', cache: 'public' },
    input: { params: publicProfileParamsSchema },
    handler: async (ctx) => {
      const profile = await ctx.services.identity.getPublicProfileByUsername(
        ctx.input.params.username
      );
      if (!profile) {
        throw new NotFoundError('Creator not found', {
          username: ctx.input.params.username,
        });
      }
      return profile;
    },
  })
);

/**
 * POST /api/user/avatar
 * Upload and process user avatar
 *
 * Security: Authenticated user only, must own their own profile
 * Content-Type: multipart/form-data
 * Form field: avatar (file)
 */
app.post(
  '/avatar',
  multipartProcedure({
    policy: { auth: 'required' },
    files: {
      avatar: {
        required: true,
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES),
      },
    },
    handler: async (ctx) => {
      // Process avatar image via identity service (handles cache invalidation)
      const result = await ctx.services.identity.uploadAvatar(
        ctx.user.id,
        new File([ctx.files.avatar.buffer], ctx.files.avatar.name, {
          type: ctx.files.avatar.type,
        })
      );

      return {
        avatarUrl: result.url,
        size: result.size,
        mimeType: result.mimeType,
      };
    },
  })
);

/**
 * DELETE /api/user/avatar
 * Remove user avatar (revert to default)
 *
 * Security: Authenticated user (own avatar only)
 */
app.delete(
  '/avatar',
  procedure({
    policy: { auth: 'required' },
    successStatus: 204,
    handler: async (ctx) => {
      // Use service method for cleanup (deletes R2 files + clears DB field)
      await ctx.services.imageProcessing.deleteUserAvatar(ctx.user.id);

      return null;
    },
  })
);

/**
 * GET /api/user/profile
 * Get authenticated user's profile
 *
 * Security: Authenticated user only
 */
app.get(
  '/profile',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.identity.getProfile(ctx.user.id);
    },
  })
);

/**
 * PATCH /api/user/profile
 * Update authenticated user's profile
 *
 * Security: Authenticated user only
 */
app.patch(
  '/profile',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateProfileSchema },
    handler: async (ctx) => {
      return await ctx.services.identity.updateProfile(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * POST /api/user/upgrade-to-creator
 * Upgrade authenticated customer to creator role
 *
 * Security: Authenticated user only, must currently be role 'customer'
 * Rate limit: strict (20/min) — sensitive one-time operation
 */
app.post(
  '/upgrade-to-creator',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: upgradeToCreatorSchema },
    handler: async (ctx) => {
      const result = await ctx.services.identity.upgradeToCreator(
        ctx.user.id,
        ctx.input.body
      );

      // Invalidate session KV cache so next request picks up new role from DB.
      // Must await (not waitUntil) — the redirect that follows needs the cache
      // cleared before the browser's next request arrives.
      // One key: the bare token. BetterAuth's secondaryStorage is the sole
      // owner of session entries in this namespace (Codex-kgrdp.7), so the
      // second `session:{token}` delete this used to issue was a guaranteed
      // no-op that still spent a KV write out of the account-wide budget.
      const kv = ctx.env.AUTH_SESSION_KV;
      if (kv && ctx.session?.token) {
        await kv.delete(ctx.session.token).catch((err: unknown) => {
          ctx.obs?.error('Failed to invalidate session KV after role upgrade', {
            error: err instanceof Error ? err.message : String(err),
            userId: ctx.user.id,
          });
        });
      }

      return result;
    },
  })
);

/**
 * DELETE /api/user/account
 * Self-service soft-delete of the authenticated user's own account.
 *
 * Security: Authenticated user only; rate limit strict (20/min).
 * Requires an explicit typed confirmation ({ confirmation: 'DELETE' }) so a
 * stray request can never delete an account by accident.
 * Blocks (422) if the user still owns an organization.
 */
app.delete(
  '/account',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: deleteAccountSchema },
    successStatus: 204,
    handler: async (ctx) => {
      const sessionTokens = await ctx.services.identity.deleteAccount(
        ctx.user.id
      );

      // Invalidate EVERY cached session this user holds, not just the current
      // one. Await (not waitUntil) — the client clears its cookie and redirects
      // immediately after, and must not race a still-cached session.
      //
      // ONE KEY PER SESSION: the bare token, BetterAuth's own namespace
      // (Codex-kgrdp.7) — matching upgrade-to-creator.
      //
      // WHY ALL OF THEM (Codex-na929). The comment here used to say "the
      // DB-fallback deletedAt gate in @codex/security covers this user's
      // other-device sessions". The gate is real, but a session still present
      // in `AUTH_SESSION_KV` NEVER REACHES THE DB and so never reaches the
      // gate: `session-auth.ts` authenticates a cache hit on `expiresAt` alone.
      // So every other device stayed signed in until KV reaped its entry on the
      // session's own TTL. Deleting the cached copies is what actually closes
      // it, and it costs nothing on the authenticated hot path — see the note
      // on `IdentityService.deleteAccount` for why a hot-path check is the
      // wrong shape.
      //
      // The current token is unioned in rather than assumed present: it is
      // normally one of the rows, but a session whose DB row has already been
      // reaped would otherwise be missed, and re-deleting one key is free.
      const kv = ctx.env.AUTH_SESSION_KV;
      if (kv) {
        const tokens = new Set(sessionTokens);
        if (ctx.session?.token) tokens.add(ctx.session.token);
        // Sequential, not Promise.all: this is a rate-limited `strict` route on
        // a handful of devices, and a burst of parallel KV writes on the same
        // namespace buys nothing here.
        for (const token of tokens) {
          await kv.delete(token).catch((err: unknown) => {
            ctx.obs?.error(
              'Failed to invalidate session KV after account deletion',
              {
                error: err instanceof Error ? err.message : String(err),
                userId: ctx.user.id,
              }
            );
          });
        }
        ctx.obs?.info('Invalidated cached sessions after account deletion', {
          userId: ctx.user.id,
          sessionCount: tokens.size,
        });
      }

      return null;
    },
  })
);

/**
 * GET /api/user/notification-preferences
 * Get authenticated user's notification preferences
 * Upserts default preferences on first access
 *
 * Security: Authenticated user only
 */
app.get(
  '/notification-preferences',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.identity.getNotificationPreferences(
        ctx.user.id
      );
    },
  })
);

/**
 * PUT /api/user/notification-preferences
 * Update authenticated user's notification preferences
 *
 * Security: Authenticated user only
 */
app.put(
  '/notification-preferences',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateNotificationPreferencesSchema },
    handler: async (ctx) => {
      return await ctx.services.identity.updateNotificationPreferences(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

/**
 * GET /api/user/creator-onboarding
 * Get the authenticated creator's first-run onboarding state
 * Upserts defaults on first access
 *
 * Security: Authenticated user only
 */
app.get(
  '/creator-onboarding',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.identity.getCreatorOnboarding(ctx.user.id);
    },
  })
);

/**
 * PATCH /api/user/creator-onboarding
 * Patch the authenticated creator's onboarding state (step pointer +
 * welcomeSeen/dismissed/completed intents → server-set timestamps)
 *
 * Security: Authenticated user only
 */
app.patch(
  '/creator-onboarding',
  procedure({
    policy: { auth: 'required' },
    input: { body: updateCreatorOnboardingSchema },
    handler: async (ctx) => {
      return await ctx.services.identity.updateCreatorOnboarding(
        ctx.user.id,
        ctx.input.body
      );
    },
  })
);

export default app;
