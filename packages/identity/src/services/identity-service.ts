import {
  ACCOUNT_DELETED_TERMINATION_REASON,
  terminateAgreementsOnDeparture,
  withdrawProposalsOnDeparture,
} from '@codex/agreements';
import type { VersionedCache } from '@codex/cache';
import { CacheType, invalidateOrgPublicCaches } from '@codex/cache';
import type { CdnCachePurger, R2Service } from '@codex/cloudflare-clients';
import {
  type DatabaseClient,
  listedCreatorConditions,
  messageForLog,
  stackForLog,
  toIso,
  whereNotDeleted,
} from '@codex/database';
import {
  agreementProposals,
  content,
  creatorOnboarding,
  creatorOrganizationAgreements,
  mediaItems,
  notificationPreferences,
  organizationMemberships,
  organizationOwnershipOffers,
  organizations,
  sessions,
  users,
} from '@codex/database/schema';
import {
  type ImageProcessingResult,
  ImageProcessingService,
  type OrphanedFileService,
} from '@codex/image-processing';
import {
  BaseService,
  BusinessLogicError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { PublicCreatorProfile, UserProfile } from '@codex/shared-types';
import type { UpdateCreatorOnboardingInput } from '@codex/validation';
import { and, eq, inArray, ne } from 'drizzle-orm';

import {
  AccountHasContentError,
  AccountOwnsOrganizationError,
  UserNotFoundError,
  UsernameTakenError,
} from '../errors';

export interface IdentityServiceConfig extends ServiceConfig {
  r2Service: R2Service;
  r2PublicUrlBase: string;
  cache?: VersionedCache;
  /**
   * Passed through to the ImageProcessingService `uploadAvatar` builds, so a
   * failed R2 cleanup after a DB error is recorded for the media-api
   * OrphanedFileCleanupDO sweep instead of only logged (Codex-r85jo.3).
   */
  orphanedFileService?: OrphanedFileService;
  /**
   * Purges a deleted account's avatars from Cloudflare's edge cache
   * (Codex-kk9nv.15). Absent, deletion logs that it skipped the purge.
   */
  cdnPurger?: Pick<CdnCachePurger, 'purgePrefixes'>;
  /**
   * Keeps work the response does not wait for alive after it: the CDN purge.
   * The registry passes the request's plain `executionCtx.waitUntil` (the
   * purge touches no DB pool). Absent (unit tests), the work is awaited.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * A user row as the profile API returns it, from `getProfile`,
 * `updateProfile` and `upgradeToCreator` alike, so the three cannot drift.
 */
function toUserProfile(
  user: Pick<
    typeof users.$inferSelect,
    | 'id'
    | 'name'
    | 'email'
    | 'emailVerified'
    | 'avatarUrl'
    | 'image'
    | 'username'
    | 'bio'
    | 'socialLinks'
  >
): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    // A custom upload wins over the sign-in provider's picture, and only an
    // upload can be removed (Codex-kk9nv.10).
    image: user.avatarUrl ?? user.image,
    hasCustomAvatar: user.avatarUrl != null,
    username: user.username ?? null,
    bio: user.bio ?? null,
    socialLinks: user.socialLinks ?? null,
  };
}

export class IdentityService extends BaseService {
  private r2Service: R2Service;
  private r2PublicUrlBase: string;
  private cache?: VersionedCache;
  private orphanedFileService?: OrphanedFileService;
  private cdnPurger?: Pick<CdnCachePurger, 'purgePrefixes'>;
  private waitUntil?: (promise: Promise<unknown>) => void;

  constructor(config: IdentityServiceConfig) {
    super(config);
    this.r2Service = config.r2Service;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
    this.cache = config.cache;
    this.orphanedFileService = config.orphanedFileService;
    this.cdnPurger = config.cdnPurger;
    this.waitUntil = config.waitUntil;
  }

  /**
   * Upload and process user avatar
   *
   * @param userId - User ID
   * @param file - Avatar image file
   * @returns Result containing upload URL
   */
  async uploadAvatar(
    userId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    const existing = await this.db.query.users.findFirst({
      where: and(eq(users.id, userId), whereNotDeleted(users)),
    });

    if (!existing) {
      throw new UserNotFoundError(userId);
    }

    // Process, upload, and update DB (cleanup handled inside ImageProcessingService).
    // Invalidated even when it throws: a write can commit and still report
    // failure, and the folder it replaced is then deleted (Codex-kk9nv.16),
    // so a cached copy of the old URL would show a broken image. It never
    // rejects, so it cannot replace the upload's own error.
    return await this.imageService()
      .processUserAvatar(userId, file)
      .finally(() => this.invalidateUserSurfaces(userId, 'uploadAvatar'));
  }

  /**
   * Remove the user's avatar (R2 files + `avatarUrl`), then invalidate every
   * cache that shows it (Codex-kk9nv.7). The route used to call the image
   * service directly, which holds no cache, so the profile kept serving the
   * deleted URL for up to 10 minutes.
   */
  async deleteAvatar(userId: string): Promise<void> {
    try {
      // Invalidated whatever the outcome, as uploadAvatar does. When the
      // delete throws: the clear can commit and lose its ack, and the files
      // then go to the sweep. When there was nothing to remove: Remove is
      // offered only for an upload, so the usual way here is a surface left
      // stale by such a removal, and invalidating again is what lets this
      // retry heal the profile and the creators lists. It never rejects, so
      // it cannot replace the delete's own error.
      await this.imageService()
        .deleteUserAvatar(userId)
        .finally(() => this.invalidateUserSurfaces(userId, 'deleteAvatar'));
    } catch (error) {
      throw this.handleError(error, 'IdentityService.deleteAvatar');
    }
  }

  private imageService(): ImageProcessingService {
    return new ImageProcessingService({
      db: this.db,
      environment: this.environment,
      r2Service: this.r2Service,
      r2PublicUrlBase: this.r2PublicUrlBase,
      orphanedFileService: this.orphanedFileService,
    });
  }

  /**
   * Invalidate every cache that shows this user's public card: their own
   * profile entries (keyed by user id), and each org that lists them on its
   * creators list (`ORG_CREATORS`, 4h TTL). That list carries name, username,
   * avatar, bio and social links, so it goes stale on any of those writes,
   * not only on an avatar (Codex-kk9nv.7). The list has its own cache id, so
   * this leaves the org's config and stats alone (Codex-kk9nv.9).
   *
   * Both workers bind the same CACHE_KV, so the id bumped here is the version
   * organization-api reads.
   *
   * Best-effort, like `VersionedCache.invalidate` itself: it runs after the
   * write has committed, so a failed org lookup is logged and the lists
   * expire with their TTL, rather than reporting a change that happened as
   * a failure.
   */
  private async invalidateUserSurfaces(
    userId: string,
    operation: string
  ): Promise<void> {
    const cache = this.cache;
    if (!cache) return;

    const listingOrgs = async (): Promise<string[]> => {
      try {
        return await this.listingOrgSlugs(this.db, userId);
      } catch (error) {
        this.obs.warn(
          'Org creators lists not invalidated: org lookup failed; they expire with their TTL',
          { userId, operation, error: messageForLog(error) }
        );
        return [];
      }
    };

    const [, slugs] = await Promise.all([
      cache.invalidate(userId),
      listingOrgs(),
    ]);
    await Promise.all(
      slugs.map((slug) =>
        cache.invalidate(CacheType.COLLECTION_ORG_CREATORS(slug))
      )
    );
  }

  /**
   * Purge Cloudflare's edge copies of every avatar this user ever had
   * (Codex-kk9nv.15; owner: "Purge on account deletion"). Stills are stored
   * immutable for a year and deleting the R2 objects does not evict them, so
   * a deleted account's photo kept loading for anyone holding the URL. One
   * prefix covers the current folder and every one it replaced. Browser
   * caches cannot be purged.
   *
   * Best-effort and never throws: the deletion has committed.
   */
  private async purgeAvatarEdgeCache(userId: string): Promise<void> {
    const skipped = 'Avatar edge cache not purged after account deletion';
    if (!this.cdnPurger) {
      // In production this is the photo left public, worth an alert, as
      // deleteDroppedAvatar treats it. Locally nothing is configured.
      const level = this.environment === 'production' ? 'error' : 'warn';
      this.obs[level](`${skipped}: no CDN purge configured`, { userId });
      return;
    }
    try {
      const result = await this.cdnPurger.purgePrefixes([
        this.imageService().avatarCachePrefix(userId),
      ]);
      if (!result.ok) this.obs.error(skipped, { userId, error: result.reason });
    } catch (error) {
      this.obs.error(skipped, { userId, error: messageForLog(error) });
    }
  }

  /**
   * Refuse to delete an account that owns a live organization. Membership
   * lifecycle uses `status` (organization_memberships has no deletedAt
   * column); the organization itself is soft-deleted, so deleted orgs do not
   * count.
   */
  private async refuseIfOwner(
    db: Tx | DatabaseClient,
    userId: string
  ): Promise<void> {
    const ownedOrgs = await db
      .select({ name: organizations.name })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizationMemberships.organizationId, organizations.id)
      )
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.role, 'owner'),
          eq(organizationMemberships.status, 'active'),
          whereNotDeleted(organizations)
        )
      );
    if (ownedOrgs.length > 0) {
      throw new AccountOwnsOrganizationError(ownedOrgs.map((o) => o.name));
    }
  }

  /**
   * The slugs of the orgs whose public creators list shows this user: the
   * ones `listedCreatorConditions` puts them on, the same conditions the list
   * itself is read with.
   */
  private async listingOrgSlugs(
    db: Tx | DatabaseClient,
    userId: string
  ): Promise<string[]> {
    const orgs = await db
      .select({ slug: organizations.slug })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizationMemberships.organizationId, organizations.id)
      )
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          ...listedCreatorConditions(),
          whereNotDeleted(organizations)
        )
      );
    return orgs.map(({ slug }) => slug);
  }

  /**
   * Get user profile
   *
   * Uses cache-aside pattern: returns cached data if available,
   * otherwise fetches from database and caches the result.
   *
   * @param userId - User ID
   * @returns User profile data
   */
  async getProfile(userId: string): Promise<UserProfile> {
    if (this.cache) {
      const result = await this.cache.getWithResult(
        userId,
        CacheType.USER_PROFILE,
        () => this.fetchProfileFromDB(userId),
        { ttl: 600 }
      );
      this.obs.debug('getProfile', { userId, cacheHit: result.hit });
      return result.data;
    }

    return this.fetchProfileFromDB(userId);
  }

  /**
   * Fetch user profile directly from database
   *
   * Internal method used by getProfile as the cache fetcher.
   *
   * @param userId - User ID
   * @returns User profile data
   */
  private async fetchProfileFromDB(userId: string): Promise<UserProfile> {
    try {
      const user = await this.db.query.users.findFirst({
        where: and(eq(users.id, userId), whereNotDeleted(users)),
      });

      if (!user) {
        throw new UserNotFoundError(userId);
      }

      return toUserProfile(user);
    } catch (error) {
      throw this.handleError(error, 'IdentityService.fetchProfileFromDB');
    }
  }

  /**
   * Public creator profile, by username. ANONYMOUS-READABLE.
   *
   * Serves the `creators.<host>/<username>` pages, which previously called a
   * route no worker implemented and silently rendered a placeholder profile
   * for every creator.
   *
   * Returns ONLY the four fields those pages read, plus the id. No email, no
   * role, no timestamps — and the cached slot holds exactly this shape, so the
   * endpoint cannot leak by someone later returning the cached object whole.
   *
   * Having a username IS the opt-in: the column exists for creator profile
   * URLs, `upgradeToCreator` sets it atomically with `role: 'creator'`, and the
   * partial unique index only covers non-deleted rows. A user with no username
   * has no public profile and is not addressable here.
   *
   * Returns `null` (not a throw) for an unknown username. This route is
   * anonymous and enumerable by nature, so a 404-shaped answer and a
   * "no such creator" answer must be indistinguishable; the caller renders its
   * own not-found page.
   *
   * @param username - the profile's username, as it appears in the URL
   */
  async getPublicProfileByUsername(
    username: string
  ): Promise<PublicCreatorProfile | null> {
    // Two hops, deliberately. The profile is keyed by USER ID so the
    // `invalidate(userId)` calls already made by updateProfile, uploadAvatar
    // and upgradeToCreator clear it for free — an edited bio or a new avatar
    // can never leave a stale public copy. Only a username RENAME needs its
    // own invalidation, which updateProfile now does for the old and new
    // value. Keying the profile by username instead would have made every one
    // of those three existing invalidations silently miss.
    if (!this.cache) {
      const userId = await this.resolveUsernameFromDB(username);
      return userId ? await this.fetchPublicProfileFromDB(userId) : null;
    }

    const userId = await this.cache.get(
      CacheType.USERNAME_LOOKUP(username.toLowerCase()),
      CacheType.USERNAME_TO_ID,
      () => this.resolveUsernameFromDB(username),
      // Long TTL: a username changes far less often than a profile.
      { ttl: 3600 }
    );

    if (!userId) return null;

    return await this.cache.get(
      userId,
      CacheType.USER_PUBLIC_PROFILE,
      () => this.fetchPublicProfileFromDB(userId),
      { ttl: 600 }
    );
  }

  /**
   * username -> user id. Cache fetcher for `CacheType.USERNAME_TO_ID`.
   *
   * Hits the `idx_unique_username` partial index, which is already scoped to
   * `deleted_at IS NULL`, so a soft-deleted account frees its username and
   * cannot be resolved.
   */
  private async resolveUsernameFromDB(
    username: string
  ): Promise<string | null> {
    try {
      const user = await this.db.query.users.findFirst({
        where: and(eq(users.username, username), whereNotDeleted(users)),
        columns: { id: true },
      });
      return user?.id ?? null;
    } catch (error) {
      throw this.handleError(error, 'IdentityService.resolveUsernameFromDB');
    }
  }

  /**
   * The public projection. Cache fetcher for `CacheType.USER_PUBLIC_PROFILE`.
   *
   * `columns` is an explicit allowlist rather than a full row followed by a
   * projection: the row never enters memory with `email` on it, so neither the
   * cache slot nor a future careless return can carry it.
   */
  private async fetchPublicProfileFromDB(
    userId: string
  ): Promise<PublicCreatorProfile | null> {
    try {
      const user = await this.db.query.users.findFirst({
        where: and(eq(users.id, userId), whereNotDeleted(users)),
        columns: {
          id: true,
          name: true,
          image: true,
          avatarUrl: true,
          bio: true,
          socialLinks: true,
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        name: user.name,
        // Same precedence as getProfile: a custom upload wins over the
        // OAuth-provider image.
        image: user.avatarUrl ?? user.image,
        bio: user.bio ?? null,
        socialLinks: user.socialLinks ?? null,
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.fetchPublicProfileFromDB');
    }
  }

  /**
   * Get the authenticated user's membership in an organization
   *
   * Returns the user's role, status, and joined date for the specified organization.
   * Returns null for role/status/joinedAt if not a member (graceful degradation).
   * Does not throw errors for "not found" - this is intentional for frontend convenience.
   *
   * @param orgId - Organization ID
   * @param userId - Authenticated user ID
   * @returns Membership lookup response with role, status, and joinedAt (all null if not a member)
   */
  async getMyMembership(
    orgId: string,
    userId: string
  ): Promise<{
    role: string | null;
    status: string | null;
    joinedAt: string | null;
  }> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.userId, userId)
        ),
      });

      if (!membership) {
        return {
          role: null,
          status: null,
          joinedAt: null,
        };
      }

      return {
        role: membership.role,
        status: membership.status,
        joinedAt: toIso(membership.createdAt),
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.getMyMembership');
    }
  }

  /**
   * Update user profile
   *
   * @param userId - User ID
   * @param input - Profile fields to update (displayName maps to name, email requires re-verification, username/bio/socialLinks for creator profile)
   * @returns Updated user data
   */
  async updateProfile(
    userId: string,
    input: {
      displayName?: string;
      email?: string;
      username?: string | null;
      bio?: string | null;
      socialLinks?: {
        website?: string;
        twitter?: string;
        youtube?: string;
        instagram?: string;
      } | null;
    }
  ): Promise<UserProfile> {
    try {
      // First, fetch the current user to check if email or username is changing
      const existing = await this.db.query.users.findFirst({
        where: and(eq(users.id, userId), whereNotDeleted(users)),
      });

      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      const updateData: Partial<{
        name: string;
        email: string;
        emailVerified: boolean;
        username: string | null;
        bio: string | null;
        socialLinks: {
          website?: string;
          twitter?: string;
          youtube?: string;
          instagram?: string;
        } | null;
      }> = {};

      // displayName maps to the 'name' column in the database
      if (input.displayName !== undefined) {
        updateData.name = input.displayName;
      }

      // If email is being changed, mark it as unverified (requires re-verification)
      if (input.email !== undefined && input.email !== existing.email) {
        updateData.email = input.email;
        updateData.emailVerified = false;
      }

      // Username uniqueness check (if changing to a new non-null username)
      if (
        input.username !== undefined &&
        input.username !== existing.username
      ) {
        if (input.username !== null) {
          await this.validateUsernameAvailability(input.username, userId);

          this.obs.info('Username update', {
            userId,
            username: input.username,
          });
        }
        updateData.username = input.username;
      }

      // Bio update (can be set to a string or null to clear)
      if (input.bio !== undefined) {
        updateData.bio = input.bio;
      }

      // Social links update (can be set to an object or null to clear)
      if (input.socialLinks !== undefined) {
        updateData.socialLinks = input.socialLinks;
      }

      const [updated] = await this.db
        .update(users)
        .set(updateData)
        .where(and(eq(users.id, userId), whereNotDeleted(users)))
        .returning();

      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      this.obs.debug('updateProfile', { userId });

      // Invalidate cache after successful update
      if (this.cache) {
        await this.invalidateUserSurfaces(userId, 'updateProfile');

        // The public profile is keyed by user id, so the invalidate above
        // already covers it. The username -> id slot is NOT, and it is the one
        // thing a profile update can change. Bump BOTH the old and the new
        // value: the old so a freed username stops resolving to this user, the
        // new in case it was probed (and cached as a miss... which it is not,
        // since a null is never written — but a previous owner's id may be
        // sitting there). Same old-and-new discipline as the org slug rename
        // in `invalidateOrgSlugCacheEntry`.
        const previousUsername = existing.username;
        const nextUsername = updated.username;
        if (previousUsername !== nextUsername) {
          for (const name of [previousUsername, nextUsername]) {
            if (name) {
              await this.cache.invalidate(
                CacheType.USERNAME_LOOKUP(name.toLowerCase())
              );
            }
          }
        }
      }

      return toUserProfile(updated);
    } catch (error) {
      throw this.handleError(error, 'IdentityService.updateProfile');
    }
  }

  /**
   * Upgrade a customer account to creator
   *
   * Atomically sets the user's global role to 'creator' and populates
   * required creator profile fields (username). Validates that the user
   * is currently a customer and the username is available.
   *
   * @param userId - User ID
   * @param input - Creator profile fields (username required, bio/socialLinks optional)
   * @returns Updated profile with role
   */
  async upgradeToCreator(
    userId: string,
    input: {
      username: string;
      bio?: string | null;
      socialLinks?: {
        website?: string;
        twitter?: string;
        youtube?: string;
        instagram?: string;
      } | null;
    }
  ): Promise<UserProfile & { role: string }> {
    try {
      const existing = await this.db.query.users.findFirst({
        where: and(eq(users.id, userId), whereNotDeleted(users)),
      });

      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      if (existing.role !== 'customer') {
        throw new BusinessLogicError('Only customers can upgrade to creator', {
          currentRole: existing.role,
        });
      }

      await this.validateUsernameAvailability(input.username, userId);

      // Atomic update: role + profile fields
      const [updated] = await this.db
        .update(users)
        .set({
          role: 'creator',
          username: input.username,
          ...(input.bio !== undefined && { bio: input.bio }),
          ...(input.socialLinks !== undefined && {
            socialLinks: input.socialLinks,
          }),
        })
        .where(and(eq(users.id, userId), whereNotDeleted(users)))
        .returning();

      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      this.obs.info('User upgraded to creator', {
        userId,
        username: input.username,
      });

      if (this.cache) {
        // The username, bio and links are on the creators list of every org
        // that lists this user (Codex-kk9nv.7).
        await this.invalidateUserSurfaces(userId, 'upgradeToCreator');
        // This is where a username first comes into existence, so bump its
        // slot too. `writeCacheSlot` never stores a null, so an earlier probe
        // of this name could not have cached a miss — but stating it here
        // keeps the public-profile invariant local to the writes that affect
        // it, instead of resting on a guard in another package.
        await this.cache.invalidate(
          CacheType.USERNAME_LOOKUP(input.username.toLowerCase())
        );
      }

      return { ...toUserProfile(updated), role: updated.role };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.upgradeToCreator');
    }
  }

  /**
   * Soft-delete the authenticated user's own account.
   *
   * Blocks deletion if the user still owns any organization — org
   * teardown/transfer is a separate, larger flow (Codex-904q0). Otherwise it
   * tombstones the row (deletedAt) and scrubs PII in a single atomic UPDATE:
   * email becomes a per-user tombstone (the email column has a global UNIQUE
   * constraint, so it must stay distinct across deletions, and this frees the
   * real address for future re-registration), and name/username/bio/avatar/
   * socialLinks are cleared. After the commit, the dropped avatar's files are
   * deleted too (Codex-kk9nv.14); a failure is recorded for the sweep or
   * logged, and never undoes the deletion.
   *
   * RETURNS THIS USER'S SESSION TOKENS so the caller can invalidate every
   * cached session, not just the current one.
   *
   * The previous version of this comment claimed "the caller invalidates the
   * current session's KV entry; the session-validation `deletedAt` gate in
   * @codex/security closes the DB-fallback path for every other session", and
   * the second half of that is true but does not close the hole. A session that
   * is still in `AUTH_SESSION_KV` NEVER REACHES THE DB, so it never reaches the
   * gate: `session-auth.ts` authenticates a cache hit on `expiresAt` alone
   * (search for `c.set('user'` — the branch checks expiry and calls `next()`).
   * So this user's other devices kept authenticating until KV reaped each entry
   * on its own TTL, i.e. for up to the session's full remaining lifetime.
   *
   * WHY THE FIX IS HERE AND NOT IN THE AUTH HOT PATH. The tempting fix is to
   * gate the cache-hit branch on `deletedAt`, and it cannot work: `UserAuthRow`
   * carries no such field, and adding one would not help, because the cached
   * entry was written BEFORE the deletion and therefore records `deletedAt:
   * null` — that was true when it was written. THE STALENESS IS THE BUG, not a
   * missing column. Invalidating at deletion time is O(devices) ONCE, where a
   * hot-path check would be a second KV read on every authenticated request —
   * the opposite direction from `Codex-kgrdp.4`, which exists to reduce the two
   * reads a cache HIT already costs.
   *
   * The tokens are read after the commit (and after the avatar delete) and
   * returned rather than deleted here: `AUTH_SESSION_KV` is BetterAuth's
   * namespace and this service has no binding to it, so the route owns that
   * write. Session ROWS are deliberately left alone — BetterAuth owns their
   * lifecycle, and with the KV entries gone the `deletedAt` gate on the DB
   * path is what stops them.
   *
   * @param userId - Authenticated user ID (never a client-supplied value)
   * @returns Every session token belonging to the user, for KV invalidation
   */
  async deleteAccount(userId: string): Promise<readonly string[]> {
    try {
      // Block if the user owns any active organization. Asked again inside
      // the transaction below, under a lock: this first answer is the cheap
      // refusal, not the guarantee.
      await this.refuseIfOwner(this.db, userId);

      // Block accounts that have published content or uploads. Deleting a
      // creator's account has unresolved downstream implications (buyer
      // permanence, subscriber handling, R2 purge, grace window) — until that
      // lifecycle is designed (Codex-v1io7) we only allow pure consumers to
      // self-delete, so no orphaned/undesigned state reaches production.
      if (await this.hasAuthoredContent(userId)) {
        throw new AccountHasContentError();
      }

      // Soft-delete + PII scrub, and the creator's revenue-share agreements
      // ended in every organisation (owner decision AGR-09, "End them like a
      // removal"), in one transaction. Money earned before is still paid; no
      // email, since the address is scrubbed here.
      const {
        endedAgreements,
        withdrawnProposals,
        withdrawnOffers,
        droppedAvatarUrl,
        listingSlugs,
      } = await this.db.transaction(async (tx) => {
        const now = new Date();
        // LOCK ORDER (Codex-kk9nv.8). A member's rows are locked as: a
        // proposal, then an ownership offer, then the membership, then the
        // creator's agreements. Accepting or countering a proposal; accepting,
        // withdrawing or reassigning an offer; removing a member or changing
        // their role all keep that order. A row inserted naming the user
        // takes a KEY SHARE on the user's row, through its foreign key. Two
        // transactions taking the same rows in different orders wait on each
        // other until Postgres aborts one, so every lock here is taken in that
        // order before anything is written.
        //
        // The user's row first, as NO KEY UPDATE. It still makes an avatar
        // upload or removal wait for the scrub, so the URL read here is the
        // one the scrub drops (processUserAvatar then skips a deleted user).
        // And it lets another transaction's foreign-key check through, so a
        // transfer or an agreement already under way commits instead of
        // waiting on this one. The scrub's email change upgrades the lock to
        // FOR UPDATE; a transaction then still holding a KEY SHARE only delays
        // it. The one exception is the subscription webhook, which inserts a
        // subscription naming the user before it upserts their membership
        // (Codex-kk9nv.20).
        const [before] = await tx
          .select({ avatarUrl: users.avatarUrl })
          .from(users)
          .where(and(eq(users.id, userId), whereNotDeleted(users)))
          .for('no key update');
        await tx
          .select({ id: agreementProposals.id })
          .from(agreementProposals)
          .where(
            and(
              eq(agreementProposals.creatorId, userId),
              eq(agreementProposals.status, 'open')
            )
          )
          .for('update');
        await tx
          .select({ id: organizationOwnershipOffers.id })
          .from(organizationOwnershipOffers)
          .where(
            and(
              eq(organizationOwnershipOffers.recipientUserId, userId),
              eq(organizationOwnershipOffers.status, 'open')
            )
          )
          .for('update');
        // Every membership row, with no role filter: a transfer that took its
        // offer first has committed by now, and one that comes second finds
        // its offer withdrawn below, and refuses.
        await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.userId, userId))
          .for('update');
        // A creator ending their own agreement locks it, then takes a KEY
        // SHARE on their row (the agreement names them as who ended it), which
        // the scrub's lock would block. Locked here, under NO KEY UPDATE,
        // that ending commits first.
        await tx
          .select({ id: creatorOrganizationAgreements.id })
          .from(creatorOrganizationAgreements)
          .where(
            and(
              eq(creatorOrganizationAgreements.creatorId, userId),
              eq(creatorOrganizationAgreements.status, 'active')
            )
          )
          .for('update');
        // Read while they still list the user: once the account is deleted
        // and its memberships ended, no query finds which cached creators
        // lists still show the real name and avatar (Codex-kk9nv.8). Inside
        // the transaction, so a failed read aborts the deletion: Postgres
        // refuses every later statement in a transaction that hit an error,
        // and committing without the list would leave those caches showing
        // the person for their 4h TTL.
        const listing = this.cache
          ? await this.listingOrgSlugs(tx, userId)
          : [];
        const [deleted] = await tx
          .update(users)
          .set({
            deletedAt: now,
            email: `deleted-${userId}@deleted.invalid`,
            name: 'Deleted User',
            username: null,
            bio: null,
            avatarUrl: null,
            image: null,
            socialLinks: null,
          })
          .where(and(eq(users.id, userId), whereNotDeleted(users)))
          .returning();

        if (!deleted) {
          throw new UserNotFoundError(userId);
        }

        // The owner check above ran before this transaction. Asked again now
        // that the scrub holds the user's row exclusively. Whatever made them
        // an owner since inserted a row naming them: a transfer's ownership
        // period, or a new org's membership. Its KEY SHARE made the scrub
        // wait, so it has committed, and no new one can start until this
        // commits. A refusal rolls the scrub back.
        await this.refuseIfOwner(tx, userId);

        // Each write below reads afresh, so it also covers a proposal or an
        // offer whose creator held a membership row this transaction waited
        // on, and committed before it got the lock.
        const withdrawn = await withdrawProposalsOnDeparture(tx, {
          creatorId: userId,
          at: now,
          everyOrganisation: true,
        });
        const ended = await terminateAgreementsOnDeparture(tx, {
          creatorId: userId,
          at: now,
          everyOrganisation: true,
          reason: ACCOUNT_DELETED_TERMINATION_REASON,
        });
        // A deleted account belongs to no org, so every member list drops
        // it, not only the creators list (owner: "Both", Codex-kk9nv.8).
        // Never an owner's: refused above, and kept out here as well, so no
        // path can leave an org with no active owner.
        await tx
          .update(organizationMemberships)
          .set({ status: 'inactive', updatedAt: now })
          .where(
            and(
              eq(organizationMemberships.userId, userId),
              inArray(organizationMemberships.status, ['active', 'invited']),
              ne(organizationMemberships.role, 'owner')
            )
          );
        // An open ownership offer to the user can never be accepted now (it
        // needs a live membership), and it would block any new offer in its
        // org for its 7 days. The row is written as a member removal writes
        // it; unlike a removal, nobody is emailed yet (Codex-kk9nv.18).
        const offers = await tx
          .update(organizationOwnershipOffers)
          .set({
            status: 'withdrawn',
            withdrawnReason: 'recipient_ineligible',
            respondedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(organizationOwnershipOffers.recipientUserId, userId),
              eq(organizationOwnershipOffers.status, 'open')
            )
          )
          // Bare: the client union collapses the projected overload, as in
          // ownership-transfer.ts. Only the count is used.
          .returning();
        return {
          endedAgreements: ended,
          withdrawnProposals: withdrawn,
          withdrawnOffers: offers,
          droppedAvatarUrl: before?.avatarUrl ?? null,
          listingSlugs: listing,
        };
      });

      this.obs.info('User account soft-deleted', {
        userId,
        agreementsEnded: endedAgreements.length,
        proposalsWithdrawn: withdrawnProposals.length,
        ownershipOffersWithdrawn: withdrawnOffers.length,
      });

      // The scrubbed name, avatar, bio and links are still on the cached
      // creators list of every org that listed this user, which anyone can
      // read, until those are invalidated too (Codex-kk9nv.7). The user also
      // left each of those orgs, a change to who is in it, so its config and
      // stats go as well, as for any departure.
      if (this.cache) {
        const cache = this.cache;
        await Promise.all([
          cache.invalidate(userId),
          ...listingSlugs.map((slug) => invalidateOrgPublicCaches(cache, slug)),
        ]);
      }

      // The scrub nulls `avatarUrl`, but the files stayed public at a URL that
      // carries this user's id (Codex-kk9nv.14). After the commit and the
      // best-effort cache invalidation (which never throws), before the token
      // read below: if that read failed, a retry would find no live user, so
      // this would be the only chance to name the folder. Nothing here can
      // undo the deletion: a failed R2 delete is recorded for the sweep
      // inside, and anything else is logged.
      try {
        await this.imageService().deleteDroppedAvatar(
          userId,
          droppedAvatarUrl,
          'account-deleted'
        );
      } catch (error) {
        // `avatarUrl` is already null, so this log is the folder's only
        // record. A sized folder's own name holds no user id for production
        // redaction to hash; an avatar from before Codex-kk9nv.5 has its
        // files in the base, `avatars/{userId}`, so this is the id, hashed
        // like `userId` beside it, and the folder follows from the id.
        this.obs.error('Avatar files not deleted after account deletion', {
          userId,
          avatarFolder: droppedAvatarUrl?.split('/').at(-2),
          error: messageForLog(error),
          stack: stackForLog(error),
        });
      }

      // After the files are gone, or a request in between caches them again,
      // and off the response path: the route clears the cached sessions with
      // the tokens this returns, so a purge it waited on would hold the
      // sign-out of every device behind an external API, past the web's 10s
      // abort if that API stalled (Codex-na929). Bounded by the purger's
      // timeout, and it never rejects.
      const purged = this.purgeAvatarEdgeCache(userId);
      const handedOff = this.handOffPurge(purged, userId);
      try {
        // Every session this user holds, so the caller can clear the cached
        // copies. Read AFTER the tombstone lands: a session created between
        // the UPDATE and this SELECT would still be returned here, whereas
        // reading first could miss one. No `whereNotDeleted` — `sessions` has
        // no `deletedAt`, BetterAuth hard-deletes on sign-out.
        const rows = await this.db
          .select({ token: sessions.token })
          .from(sessions)
          .where(eq(sessions.userId, userId));

        this.obs.info('Session tokens collected for invalidation', {
          userId,
          sessionCount: rows.length,
        });

        return rows.map((r) => r.token);
      } finally {
        // Without a request to outlive (unit tests, scripts), or when the
        // hook refused it: awaited, still after the token read.
        if (!handedOff) await purged;
      }
    } catch (error) {
      throw this.handleError(error, 'IdentityService.deleteAccount');
    }
  }

  /**
   * Hand the purge to `waitUntil`. False when there is no hook, or the hook
   * throws (a spent ExecutionContext, say): the deletion has committed, so a
   * hook's failure must not report it failed, and the caller awaits the
   * purge itself.
   */
  private handOffPurge(purge: Promise<void>, userId: string): boolean {
    if (!this.waitUntil) return false;
    try {
      this.waitUntil(purge);
      return true;
    } catch (error) {
      this.obs.warn(
        'Avatar edge cache purge not handed to waitUntil; awaited',
        {
          userId,
          error: messageForLog(error),
        }
      );
      return false;
    }
  }

  /**
   * Returns true if the user authored any non-deleted content or media.
   * Used to gate account self-deletion (see deleteAccount / Codex-v1io7).
   */
  private async hasAuthoredContent(userId: string): Promise<boolean> {
    const [contentRow] = await this.db
      .select({ id: content.id })
      .from(content)
      .where(and(eq(content.creatorId, userId), whereNotDeleted(content)))
      .limit(1);
    if (contentRow) {
      return true;
    }

    const [mediaRow] = await this.db
      .select({ id: mediaItems.id })
      .from(mediaItems)
      .where(and(eq(mediaItems.creatorId, userId), whereNotDeleted(mediaItems)))
      .limit(1);
    return !!mediaRow;
  }

  /**
   * Get notification preferences for a user (upserts defaults on first access)
   *
   * Uses cache-aside pattern if cache is available.
   *
   * @param userId - User ID
   * @returns Notification preferences
   */
  async getNotificationPreferences(userId: string): Promise<{
    emailMarketing: boolean;
    emailTransactional: boolean;
    emailDigest: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    if (this.cache) {
      const result = await this.cache.getWithResult(
        userId,
        CacheType.USER_PREFERENCES,
        () => this.fetchNotificationPreferencesFromDB(userId),
        { ttl: 600 }
      );
      this.obs.debug('getNotificationPreferences', {
        userId,
        cacheHit: result.hit,
      });
      return result.data;
    }

    return this.fetchNotificationPreferencesFromDB(userId);
  }

  /**
   * Fetch notification preferences directly from database
   *
   * Internal method used by getNotificationPreferences as the cache fetcher.
   *
   * @param userId - User ID
   * @returns Notification preferences
   */
  private async fetchNotificationPreferencesFromDB(userId: string): Promise<{
    emailMarketing: boolean;
    emailTransactional: boolean;
    emailDigest: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      // Upsert: insert defaults if not exists, return existing if present
      const [prefs] = await this.db
        .insert(notificationPreferences)
        .values({ userId })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { userId }, // no-op update to return the row
        })
        .returning();

      return {
        emailMarketing: prefs.emailMarketing,
        emailTransactional: prefs.emailTransactional,
        emailDigest: prefs.emailDigest,
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
      };
    } catch (error) {
      throw this.handleError(
        error,
        'IdentityService.fetchNotificationPreferencesFromDB'
      );
    }
  }

  /**
   * Update notification preferences for a user
   *
   * Invalidates cache after successful update if cache is available.
   *
   * @param userId - User ID
   * @param input - Preference fields to update
   * @returns Updated notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    input: {
      emailMarketing?: boolean;
      emailTransactional?: boolean;
      emailDigest?: boolean;
    }
  ): Promise<{
    emailMarketing: boolean;
    emailTransactional: boolean;
    emailDigest: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      this.obs.debug('updateNotificationPreferences input', {
        userId,
        input,
      });

      // Upsert: insert with provided values or update existing
      const [prefs] = await this.db
        .insert(notificationPreferences)
        .values({
          userId,
          ...(input.emailMarketing !== undefined && {
            emailMarketing: input.emailMarketing,
          }),
          ...(input.emailTransactional !== undefined && {
            emailTransactional: input.emailTransactional,
          }),
          ...(input.emailDigest !== undefined && {
            emailDigest: input.emailDigest,
          }),
        })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: {
            ...(input.emailMarketing !== undefined && {
              emailMarketing: input.emailMarketing,
            }),
            ...(input.emailTransactional !== undefined && {
              emailTransactional: input.emailTransactional,
            }),
            ...(input.emailDigest !== undefined && {
              emailDigest: input.emailDigest,
            }),
            updatedAt: new Date(),
          },
        })
        .returning();

      // Invalidate cache after successful update
      if (this.cache) {
        await this.cache.invalidate(userId);
      }

      return {
        emailMarketing: prefs.emailMarketing,
        emailTransactional: prefs.emailTransactional,
        emailDigest: prefs.emailDigest,
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
      };
    } catch (error) {
      throw this.handleError(
        error,
        'IdentityService.updateNotificationPreferences'
      );
    }
  }

  /**
   * Get the creator's first-run onboarding state (upserts defaults on first
   * access, mirroring getNotificationPreferences).
   *
   * Deliberately uncached: the wizard patches this record several times per
   * flow, and it is read by a PK lookup (`user_id`) on the studio critical
   * path — a cheap indexed hit not worth the invalidation churn a cache would
   * add. Payouts completion is NOT tracked here; it stays derived from the
   * live Stripe Connect status.
   *
   * @param userId - User ID
   * @returns Creator onboarding state
   */
  async getCreatorOnboarding(userId: string): Promise<{
    currentStep: string;
    welcomeSeenAt: Date | null;
    dismissedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      // Upsert: insert defaults if not exists, return existing if present.
      const [row] = await this.db
        .insert(creatorOnboarding)
        .values({ userId })
        .onConflictDoUpdate({
          target: creatorOnboarding.userId,
          set: { userId }, // no-op update to return the row
        })
        .returning();

      return {
        currentStep: row.currentStep,
        welcomeSeenAt: row.welcomeSeenAt,
        dismissedAt: row.dismissedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.getCreatorOnboarding');
    }
  }

  /**
   * Patch the creator's onboarding state.
   *
   * Boolean *intents* from the client map to server-set timestamps (never a
   * client clock): `welcomeSeen` → `welcomeSeenAt`, `dismissed` →
   * `dismissedAt`, `completed` → `completedAt`. `currentStep` moves the resume
   * pointer. Upserts so it works before the row exists.
   *
   * @param userId - User ID
   * @param input - Already-validated patch (see updateCreatorOnboardingSchema)
   * @returns Updated creator onboarding state
   */
  async updateCreatorOnboarding(
    userId: string,
    input: UpdateCreatorOnboardingInput
  ): Promise<{
    currentStep: string;
    welcomeSeenAt: Date | null;
    dismissedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      const now = new Date();
      const patch = {
        ...(input.currentStep !== undefined && {
          currentStep: input.currentStep,
        }),
        ...(input.welcomeSeen === true && { welcomeSeenAt: now }),
        ...(input.dismissed === true && { dismissedAt: now }),
        ...(input.completed === true && { completedAt: now }),
      };

      const [row] = await this.db
        .insert(creatorOnboarding)
        .values({ userId, ...patch })
        .onConflictDoUpdate({
          target: creatorOnboarding.userId,
          set: { ...patch, updatedAt: now },
        })
        .returning();

      this.obs.debug('updateCreatorOnboarding', {
        userId,
        currentStep: row.currentStep,
      });

      return {
        currentStep: row.currentStep,
        welcomeSeenAt: row.welcomeSeenAt,
        dismissedAt: row.dismissedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.updateCreatorOnboarding');
    }
  }

  /**
   * Validate that a username is available (not taken by another active user).
   * Shared by updateProfile() and upgradeToCreator().
   */
  private async validateUsernameAvailability(
    username: string,
    excludeUserId: string
  ): Promise<void> {
    const existing = await this.db.query.users.findFirst({
      where: and(
        eq(users.username, username),
        ne(users.id, excludeUserId),
        whereNotDeleted(users)
      ),
    });

    if (existing) {
      throw new UsernameTakenError(username);
    }
  }
}
