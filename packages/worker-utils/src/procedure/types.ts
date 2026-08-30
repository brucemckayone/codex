/**
 * tRPC-style Procedure Pattern - Type Definitions
 *
 * Provides compile-time type safety for:
 * - Authentication levels with conditional user types
 * - Input schema inference from Zod
 * - Service registry for lazy-loaded services
 * - Procedure context with full typing
 */

import type {
  ContentAccessService,
  CourseAccessService,
  CourseInsightsService,
  CourseJourneyService,
  EntitlementsService,
} from '@codex/access';
import type {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
import type { AgreementService } from '@codex/agreements';
import type { CachePresetName } from '@codex/constants';
// Service type imports (for typing only)
import type {
  CategoriesService,
  ContentService,
  MediaItemService,
} from '@codex/content';
import type { IdentityService } from '@codex/identity';
import type { ImageProcessingService } from '@codex/image-processing';
import type {
  NotificationPreferencesService,
  NotificationsService,
  TemplateService,
} from '@codex/notifications';
import type { ObservabilityClient } from '@codex/observability';
import type {
  DevDomainService,
  OrganizationService,
} from '@codex/organization';
import type { PlatformSettingsFacade } from '@codex/platform-settings';
import type { FeeConfigService, PurchaseService } from '@codex/purchase';
import type { RateLimitPresetName } from '@codex/security';
import type {
  Bindings,
  HonoEnv,
  SessionData,
  UserData,
} from '@codex/shared-types';
import type {
  ConnectAccountService,
  CourseSubscriptionService,
  SubscriptionService,
  TierService,
} from '@codex/subscription';
import type { TranscodingService } from '@codex/transcoding';
import type { ExecutionContext, MiddlewareHandler } from 'hono';
import type { ZodSchema, z } from 'zod';

// ============================================================================
// Auth Level Types
// ============================================================================

/**
 * Authentication level for procedure
 */
export type AuthLevel =
  | 'none'
  | 'optional'
  | 'required'
  | 'worker'
  | 'platform_owner';

/**
 * User type based on auth level - conditional typing
 * - 'required' | 'platform_owner' → UserData (guaranteed)
 * - 'optional' → UserData | undefined (may or may not exist)
 * - 'none' | 'worker' → undefined (no user context)
 */
export type UserForAuth<T extends AuthLevel> = T extends
  | 'required'
  | 'platform_owner'
  ? UserData
  : T extends 'optional'
    ? UserData | undefined
    : undefined;

/**
 * Session type based on auth level
 */
export type SessionForAuth<T extends AuthLevel> = T extends
  | 'required'
  | 'optional'
  | 'platform_owner'
  ? SessionData | undefined
  : undefined;

// ============================================================================
// Input Schema Types
// ============================================================================

/**
 * Input schema definition - supports params, query, body
 */
export interface InputSchema {
  params?: ZodSchema;
  query?: ZodSchema;
  body?: ZodSchema;
}

/**
 * Infer validated input types from schema
 * Maps each schema key to its inferred Zod type
 */
export type InferInput<T extends InputSchema | undefined> =
  T extends InputSchema
    ? {
        [K in keyof T]: T[K] extends ZodSchema ? z.infer<T[K]> : never;
      }
    : Record<string, never>;

// ============================================================================
// Service Registry
// ============================================================================

/**
 * All available services - lazy-loaded via getters
 *
 * Services are instantiated on first access to avoid creating unused instances.
 * Each service is typed to its actual implementation.
 */
export interface ServiceRegistry {
  // Content domain
  content: ContentService;
  media: MediaItemService;
  /**
   * Per-space topic taxonomy (org landing "Browse by topic"). Scoped CRUD +
   * reorder, mirroring `content` scoping (org space shared across creators;
   * personal space per-creator).
   */
  categories: CategoriesService;
  access: ContentAccessService;
  /**
   * Read-resolution of stored `entitlements` grants (Codex-2pryk.2.3 · WP-2).
   * READ-ONLY — the grant write path (purchase / course-subscription) is WP-6.
   * The access DECISION (`canView` / `canEnterCourse`) lives on `access`.
   */
  entitlements: EntitlementsService;
  imageProcessing: ImageProcessingService;

  // Organization domain
  organization: OrganizationService;
  settings: PlatformSettingsFacade;
  /**
   * Dev-only Cloudflare Custom Domain provisioner (Codex Phase 7).
   * No-op outside `ENVIRONMENT === 'dev'`. Creates per-org HTTPS bindings
   * for hostnames at two levels deep where Universal SSL doesn't reach.
   */
  devDomain: DevDomainService;

  // Commerce domain
  purchase: PurchaseService;
  /**
   * Fee configuration (Codex-m644n) — 3-tier DB-configurable fees with
   * version-cache invalidation. Lazily read by purchase + subscription.
   */
  feeConfig: FeeConfigService;
  /**
   * Revenue-share agreements (Codex-tnft0, WP-2 of Codex-nk4km). State
   * machine for propose / counter / accept / decline / withdraw +
   * agreement termination. Reads platform fee fresh from feeConfig at
   * propose/accept time (per epic decision #2).
   */
  agreements: AgreementService;

  // Subscription domain
  subscription: SubscriptionService;
  tier: TierService;
  connect: ConnectAccountService;
  /**
   * Course-specific subscriptions (Codex-2pryk WP-6 · SPEC §7): plan Stripe
   * sync, checkout, and the course-sub webhook lifecycle + payout fan-out.
   * Stripe-backed, so lazily constructed with the deferred Stripe client.
   */
  courseSubscription: CourseSubscriptionService;
  /**
   * Course monetization access surface (Codex-2pryk WP-6): tier→course grant
   * management (N1 guard) + the `getCourseOffer` read composing all three §7
   * paths. Pure DB — no Stripe.
   */
  courseAccess: CourseAccessService;
  /**
   * Course MEMBER-surface reads (Codex-2pryk Round-D): the dashboard curriculum
   * + progress rollup and the in-course practice/playlist projections (SPEC §11
   * / §14). Pure DB — the entitlement decision + stream signing stay on `access`.
   */
  courseJourney: CourseJourneyService;
  /**
   * Course STUDIO-reporting reads (Codex-2pryk Round-D · WP-7): course-scoped
   * financial (`live`) + engagement (`course`) aggregation for the owner/admin
   * insights surface. Pure DB — owner/admin gated at the route via
   * `requireOrgManagement`; the service re-scopes the course to the managed org.
   */
  courseInsights: CourseInsightsService;

  // Media & Processing domain
  transcoding: TranscodingService;
  images: ImageProcessingService;

  // Admin domain
  adminAnalytics: AdminAnalyticsService;
  adminContent: AdminContentManagementService;
  adminCustomer: AdminCustomerManagementService;

  // Notification domain
  templates: TemplateService;
  notifications: NotificationsService;
  preferences: NotificationPreferencesService;

  // Identity domain
  identity: IdentityService;
}

// ============================================================================
// Procedure Policy
// ============================================================================

/**
 * Policy configuration for procedure security
 */
export interface ProcedurePolicy {
  /**
   * Authentication requirement
   * - 'none': Public endpoint
   * - 'optional': Auth attempted but not required
   * - 'required': Must have valid session (default)
   * - 'worker': Worker-to-worker HMAC auth
   * - 'platform_owner': Must be platform owner role
   */
  auth?: AuthLevel;

  /**
   * Role-based access control
   */
  roles?: Array<'user' | 'creator' | 'admin' | 'system' | 'platform_owner'>;

  /**
   * Require organization membership
   */
  requireOrgMembership?: boolean;

  /**
   * Require organization management privileges (owner/admin)
   */
  requireOrgManagement?: boolean;

  /**
   * Rate limiting preset, enforced by `enforcePolicyInline`.
   *
   * Typed as `RateLimitPresetName` rather than a hand-written union so the two
   * cannot drift: the previous literals included 'public' (never a preset) and
   * 'webhook' (deleted — Stripe and RunPod are HMAC-authenticated), which the
   * type would have accepted on a route and the limiter could not honour.
   *
   * Omitted means 'api' (100/min per subject), not "unlimited". `auth:
   * 'worker'` routes are exempt whatever this says.
   */
  rateLimit?: RateLimitPresetName;

  /**
   * `Cache-Control` preset for the SUCCESS response, applied centrally by
   * `procedure()` — no route hand-writes the header.
   *
   * The names, and the exact header each emits, live in `CACHE_PRESETS`
   * (`@codex/constants`); the vocabulary is shared with apps/web so a route and
   * a page describe cacheability in one language. (No count of them here on
   * purpose — this file said "the four" while the constants module had grown to
   * six, and a number restated across a package boundary goes stale in silence.
   * `CachePresetName` is derived from that object, so the union is always
   * whatever it holds.)
   *
   * WHICH PRESET AN AUTH LEVEL MAY DECLARE IS A TYPE ERROR, NOT A REVIEW NOTE.
   * `CachePolicyRule` (below) rejects the illegal pairings at the `policy:`
   * property, because the failure mode is a data leak: a shared cache keys on
   * URL and NEVER on Cookie, so an `s-maxage` on a body that varies by viewer
   * hands one viewer's render to the next. That shipped here once already —
   * apps/web's `DYNAMIC_PUBLIC_REVALIDATE` (`public, max-age=0, s-maxage=300`)
   * was removed from the platform landing page for exactly this, and
   * `workers/content-api/src/routes/__tests__/journeys-cache.test.ts` guards
   * the same hazard on the journeys router.
   *
   * Omitted means `'private'` — the safe reading is the default.
   */
  cache?: CachePresetName;

  /**
   * Author's assertion that this route's response body does NOT branch on the
   * session. Only meaningful alongside `auth: 'optional'` + `cache: 'public'`,
   * which the type rule refuses without it.
   *
   * `auth: 'optional'` covers two different kinds of route and no type can tell
   * them apart. Some ignore the session entirely — content-api's journeys
   * portal reads are documented "Fully PUBLIC (NO `canView`)" and are safely
   * shared-cacheable. Others branch on it, and publicly caching those leaks one
   * member's data to the next visitor. The dangerous reading is therefore the
   * default, and safety has to be stated out loud: this flag is that statement.
   *
   * `true` and a non-literal `boolean` are both treated as "not asserted" —
   * the carve-out needs the literal `false`.
   */
  variesBySession?: boolean;

  /**
   * IP whitelist
   */
  allowedIPs?: string[];
}

// ============================================================================
// Cache Preset x Auth Level Rule
// ============================================================================

/**
 * The presets each auth level is allowed to declare.
 *
 *   'none'                                   -> any of the six
 *   'optional'                               -> per-viewer | private | fresh
 *                                               (+ `public` via the
 *                                               `variesBySession: false`
 *                                               carve-out in `CachePolicyRule`)
 *   'required' | 'worker' | 'platform_owner' -> private | fresh
 *
 * NON-DISTRIBUTIVE, AND THAT IS THE POINT — `[TAuth] extends ['none']`, not
 * `TAuth extends 'none'`. A previous version of this comment argued the
 * opposite ("distributive on purpose ... harmless: every one of the 200+ live
 * `procedure()` sites passes an inline literal"), and it was wrong twice over.
 *
 * Wrong on the mechanism: a naked `TAuth extends 'none'` DISTRIBUTES, so a
 * union auth level resolved to the union of the branches. `'none' | 'required'`
 * yielded every preset, and `'optional' | 'required'` yielded `'per-viewer' |
 * 'private' | 'fresh'` — licensing `per-viewer` on a route that may be `auth:
 * 'required'`. Union input WIDENED the permitted set, which is the wrong
 * direction for a leak guard.
 *
 * Wrong on the reasoning too: "the live sites all pass literals" argues that
 * the hole is never hit, not that it is closed, and a type rule exists to be
 * authoritative for the call site that does not exist yet. The tuple form takes
 * a union to the STRICTEST reading — anything not exactly `'none'` and not
 * exactly `'optional'` lands on `'private' | 'fresh'` — so an auth level the
 * compiler cannot pin down gets the safe answer instead of every answer.
 */
export type CachePresetForAuth<TAuth extends AuthLevel> = [TAuth] extends [
  'none',
]
  ? CachePresetName
  : [TAuth] extends ['optional']
    ? 'per-viewer' | 'private' | 'fresh'
    : 'private' | 'fresh';

/**
 * The auth level a policy resolves to. Written as `infer` rather than
 * `TPolicy['auth']` so a policy that omits the key resolves to the same
 * `'required'` default that `enforcePolicyInline` applies at runtime, instead
 * of to `AuthLevel | undefined`.
 *
 * DISTRIBUTIVE OVER `TPolicy`, AND SAFE BECAUSE ITS CONSUMER IS NOT. A union
 * policy (`FLAG ? {auth: 'none'} : {auth: 'required'}`) resolves to the union
 * `'none' | 'required'`, and `CachePresetForAuth` now reads a union as the
 * strictest member — so widening here narrows there. Do not "fix" this by
 * tuple-wrapping it without re-reading `CacheRuleFor`: the union is the honest
 * answer to "what auth level is this?", and the rule is what must fail closed
 * on it.
 */
type DeclaredAuth<TPolicy> = TPolicy extends {
  auth: infer TAuth extends AuthLevel;
}
  ? TAuth
  : 'required';

/**
 * The preset a policy declares, or `undefined` when it declares none.
 *
 * Also distributive over `TPolicy`, which is why `CacheRuleFor` reads it
 * through `Extract<…, CachePresetName>` rather than testing it whole. A union
 * policy where only ONE arm declares a preset resolves to `'public' |
 * undefined`; a whole-type test would see "not a preset name", conclude
 * nothing was declared, and skip the rule — while at runtime
 * `resolveCacheControl` reads `policy.cache ?? 'private'` off whichever arm was
 * actually built and emits `public`. `Extract` keeps the preset members and
 * discards the `undefined`, so the declared half is still judged.
 */
type DeclaredCache<TPolicy> = TPolicy extends {
  cache: infer TCache extends CachePresetName;
}
  ? TCache
  : undefined;

/**
 * Whether the policy carries the literal `variesBySession: false`. A widened
 * `boolean` (`variesBySession: someFlag`) deliberately fails this — the
 * carve-out is an assertion, and an assertion the compiler cannot read is not
 * one.
 *
 * Distributive over `TPolicy` as well: a union policy where only one arm
 * asserts resolves to `boolean`, and the carve-out test in `CacheRuleFor`
 * demands the literal `true`, so a half-asserted union is refused. Fail closed
 * by construction, not by luck.
 */
type AssertsSessionInvariant<TPolicy> = TPolicy extends {
  variesBySession: false;
}
  ? true
  : false;

/**
 * The shape a violating policy is required to have and cannot: intersecting it
 * with the declared policy makes the object literal unassignable, and TypeScript
 * prints `TMessage` in the error, so the message names the rule that was
 * broken.
 */
export interface CachePolicyViolation<TMessage extends string> {
  readonly __cachePolicyViolation: TMessage;
}

/**
 * Whether `T` is a union of more than one member. Used only to pick the error
 * MESSAGE — never to decide whether a policy is legal — so a mis-read here
 * costs wording, not enforcement.
 */
type IsUnion<T, TAll = T> = [T] extends [never]
  ? false
  : T extends TAll
    ? [TAll] extends [T]
      ? false
      : true
    : never;

/**
 * Every preset this policy may legally declare: the auth level's own set, plus
 * `public` when — and only when — `auth: 'optional'` is paired with the literal
 * `variesBySession: false`.
 *
 * The carve-out is a tuple test (`[TAuth, TInvariant] extends ['optional',
 * true]`) so neither half can be smuggled in by a union: `'optional' |
 * 'required'` is not `'optional'`, and `boolean` is not `true`.
 *
 * NOTE THAT THE CARVE-OUT IS `'public'` ALONE, not every viewer-invariant
 * preset. `static` and `asset` are for `auth: 'none'` bodies (crawler
 * documents, content-addressed R2 objects), and nothing in the repo needs them
 * on a session-aware route — a `stale-while-revalidate` window on a route that
 * even LOOKS at the session is a much longer leak than the one that shipped
 * here in 2026-05. If a real `auth: 'optional'` route ever needs a long
 * viewer-invariant window, this line is where it widens, deliberately.
 */
type AllowedCache<TAuth extends AuthLevel, TInvariant extends boolean> =
  | CachePresetForAuth<TAuth>
  | ([TAuth, TInvariant] extends ['optional', true] ? 'public' : never);

/** The message a violation prints, chosen to name the rule actually broken. */
type CacheViolationMessage<
  TAuth extends AuthLevel,
  TCache,
> = IsUnion<TCache> extends true
  ? "cache must be ONE preset name, not a union — declare the safe preset unconditionally (a conditional such as `cache: FLAG ? 'public' : 'private'` used to compile, because the illegal member hid inside the union)"
  : IsUnion<TAuth> extends true
    ? "auth must be ONE level, not a union — a union is judged by its strictest member, which may declare only cache: 'private' or 'fresh'"
    : [TAuth] extends ['optional']
      ? [TCache] extends ['public']
        ? "cache: 'public' on auth: 'optional' also requires variesBySession: false — assert the body ignores the session, or declare 'per-viewer'"
        : "auth: 'optional' may declare 'per-viewer' | 'private' | 'fresh', or 'public' with variesBySession: false — the long shared windows ('static', 'asset') are for auth: 'none' bodies only"
      : "this auth level may declare only cache: 'private' or 'fresh' — a shared cache keys on URL, never on Cookie";

/**
 * The rule proper: `unknown` (a no-op in an intersection) for a legal policy, a
 * `CachePolicyViolation` for an illegal one.
 *
 * EVERY TEST HERE IS TUPLE-WRAPPED, WHICH IS THE FIX FOR A REPRODUCED BYPASS.
 * The previous version tested the naked parameter (`TCache extends
 * CachePresetName ? …`), making the conditional distributive: for `TCache =
 * 'public' | 'private'` on `auth: 'required'` it evaluated each member
 * separately and returned `CachePolicyViolation<…> | unknown`, which COLLAPSES
 * TO `unknown` — so `policy: { auth: 'required', cache: FLAG ? 'public' :
 * 'private' }` compiled clean through the package typecheck, content-api's
 * typecheck and the CI contract gate, while the single-literal form errored
 * correctly. A rule that any union can switch off is not enforcement, and a
 * rule proven only against literals cannot see the difference — hence the union
 * cases in `__tests__/cache-policy-rule.type-check.ts`.
 *
 * `Extract<TCache, CachePresetName>` rather than `TCache` for the first test:
 * see `DeclaredCache` for the union-policy arm that would otherwise be skipped.
 * When nothing is declared the extraction is `never`, the rule is a no-op, and
 * the runtime default (`private`) stands.
 */
type CacheRuleFor<
  TAuth extends AuthLevel,
  TCache,
  TInvariant extends boolean,
> = [Extract<TCache, CachePresetName>] extends [never]
  ? unknown
  : [Extract<TCache, CachePresetName>] extends [AllowedCache<TAuth, TInvariant>]
    ? unknown
    : CachePolicyViolation<
        CacheViolationMessage<TAuth, Extract<TCache, CachePresetName>>
      >;

/**
 * Resolves to `unknown` (a no-op in an intersection) for a legal policy, and to
 * a `CachePolicyViolation` the declared object cannot satisfy for an illegal
 * one. Applied as `policy?: TPolicy & CachePolicyRule<TPolicy>` on every
 * procedure config, which reports the error on the `policy:` property itself.
 *
 * Not applied as a constraint on the type parameter (`TPolicy extends
 * ProcedurePolicy & CachePolicyRule<TPolicy>`): TypeScript rejects that with
 * TS2313 "Type parameter 'TPolicy' has a circular constraint". Verified, not
 * assumed. The intersection form leaves the existing inference intact —
 * `CachePolicyRule<TPolicy>` is a deferred conditional and contributes no
 * inference candidate, so `const TPolicy` still captures the literal shape that
 * `ProcedureContext.organizationId` narrows on.
 *
 * Every legal and illegal pairing is pinned by
 * `__tests__/cache-policy-rule.type-check.ts`, which the package typecheck
 * includes (tsconfig excludes only `*.test.ts` / `*.spec.ts`) — including the
 * UNION forms (`cache: FLAG ? 'public' : 'private'`, a union auth level), which
 * the literal-only cases could not distinguish from a working rule and which
 * were the actual bypass.
 */
export type CachePolicyRule<TPolicy extends ProcedurePolicy> = CacheRuleFor<
  DeclaredAuth<TPolicy>,
  DeclaredCache<TPolicy>,
  AssertsSessionInvariant<TPolicy>
>;

// ============================================================================
// Procedure Context
// ============================================================================

/**
 * Full context provided to procedure handlers
 * Types are conditional based on policy auth level
 */
export interface ProcedureContext<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
> {
  // Auth context - type depends on policy.auth
  user: UserForAuth<
    TPolicy['auth'] extends AuthLevel ? TPolicy['auth'] : 'required'
  >;
  session: SessionForAuth<
    TPolicy['auth'] extends AuthLevel ? TPolicy['auth'] : 'required'
  >;

  // Validated input from schema
  input: InferInput<TInput>;

  // Request metadata (always available)
  requestId: string;
  clientIP: string;
  userAgent: string;

  // Organization context
  // organizationId is guaranteed for:
  // - requireOrgMembership: true (extracted from subdomain/params + membership check)
  // - requireOrgManagement: true (gates the same `needsOrg` resolver as membership;
  //   enforcePolicy throws ValidationError if organizationId can't be resolved)
  // - auth: 'platform_owner' (automatically looked up from user's membership)
  organizationId: TPolicy['requireOrgMembership'] extends true
    ? string
    : TPolicy['requireOrgManagement'] extends true
      ? string
      : TPolicy['auth'] extends 'platform_owner'
        ? string
        : string | undefined;
  organizationRole: string | undefined;

  // Environment bindings
  env: Bindings;

  // Execution context for non-blocking operations
  executionCtx: ExecutionContext;

  /**
   * Register background work that must finish BEFORE the service registry's
   * DB clients are torn down.
   *
   * `ctx.executionCtx.waitUntil()` is NOT safe for background work that
   * touches the database. procedure() schedules its own
   * `waitUntil(cleanup())` when the handler returns, and cleanup calls
   * `pool.end()` on the shared per-request client — so the two race, and
   * cleanup (being near-instant) reliably wins. Any DB write attempted after
   * that fails with a bare "Failed query", and if it was an error-reporting
   * write the failure vanishes entirely.
   *
   * Use this instead whenever the background task reads or writes the DB;
   * cleanup is chained after everything registered here settles. Plain
   * `waitUntil` remains correct for work that never touches the DB.
   *
   * Returns the promise it was given, so it can be used inline.
   */
  background: <T>(promise: Promise<T>) => Promise<T>;

  /**
   * Hand a CACHE WRITE to the runtime so it survives the response.
   *
   * A Worker cancels every unawaited promise the moment the response is
   * returned, so a bare `kv.put(...)` fired after the value is computed is a
   * write that usually never happens. `org-helpers.ts` did exactly that for
   * both of its write-through caches — `kv.put(...).catch(() => {})` with no
   * `waitUntil` anywhere in the file — which is why a cache designed to remove
   * a Neon round trip per request never removed one.
   *
   * Uses `executionCtx.waitUntil`, NOT `ctx.background()`. The two are not
   * interchangeable: `background()` exists because `procedure()` chains
   * `waitUntil(cleanup())` and cleanup calls `pool.end()`, so a background task
   * that touches the DATABASE races a torn-down pool. A KV write has no pool to
   * lose, and routing it through `background()` would instead delay the
   * response's own cleanup behind it. Same reasoning as
   * `packages/cache/src/helpers/invalidate.ts`, which threads `waitUntil` for
   * KV invalidation.
   *
   * Rejections are swallowed: a cache write is best-effort by definition, and a
   * rejected promise handed to `waitUntil` would surface as an unhandled
   * rejection. Pass the bare promise — do not pre-`.catch()` it.
   *
   * FOR CACHE WRITES ONLY. Anything that reads or writes the database belongs
   * on `background()`.
   */
  cacheWrite: (promise: Promise<unknown>) => void;

  // Observability client
  obs: ObservabilityClient | undefined;

  // Service registry (lazy-loaded)
  services: ServiceRegistry;
}

// ============================================================================
// Procedure Configuration
// ============================================================================

/**
 * Main procedure configuration
 */
export interface ProcedureConfig<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
> {
  /**
   * Security policy configuration
   *
   * Intersected with `CachePolicyRule` so an illegal `cache` / `auth` pairing
   * is reported here rather than in review. See `CachePolicyRule`.
   *
   * @default { auth: 'required' }
   */
  policy?: TPolicy & CachePolicyRule<TPolicy>;

  /**
   * Input validation schemas
   */
  input?: TInput;

  /**
   * Handler function with fully typed context
   * Return value is automatically wrapped in { data: T }
   */
  handler: (ctx: ProcedureContext<TPolicy, TInput>) => Promise<TOutput>;

  /**
   * Success HTTP status code
   * @default 200
   */
  successStatus?: 200 | 201 | 204;
}

/**
 * Return type of procedure() function
 */
export type ProcedureHandler = MiddlewareHandler<HonoEnv>;
