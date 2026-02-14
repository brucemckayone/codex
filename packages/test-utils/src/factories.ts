/**
 * Test Data Factories
 *
 * Factory functions for generating realistic test data for Content Management Service.
 * All factories support partial overrides via optional parameters.
 *
 * Key Points:
 * - Uses types from @codex/database/schema (no type recreation)
 * - Returns NewX types for insertion or full types with IDs
 * - Generates unique slugs and UUIDs for test isolation
 * - Provides realistic defaults that match database constraints
 *
 * Usage:
 * ```typescript
 * import { createTestOrganizationInput, createTestContentInput } from '@codex/test-utils';
 *
 * // For database insertion (uses NewX types)
 * const orgInput = createTestOrganizationInput({ name: 'Custom Name' });
 * const [org] = await db.insert(organizations).values(orgInput).returning();
 *
 * // For mocking existing entities (includes id and timestamps)
 * const mockOrg = createTestOrganization({ name: 'Existing Org' });
 * ```
 */

import { randomUUID } from 'node:crypto';
import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  VISIBILITY,
} from '@codex/constants';
import type {
  Content,
  MediaItem,
  NewContent,
  NewMediaItem,
  NewOrganization,
  NewOrganizationMembership,
  Organization,
} from '@codex/database/schema';

/**
 * Generate unique slug with timestamp
 * Ensures slug uniqueness across test runs
 */
export function createUniqueSlug(prefix = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate unique organization name
 */
function createUniqueName(prefix = 'Test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix} ${random}${timestamp}`;
}

/**
 * Create test organization INPUT (NewOrganization type - for database insertion)
 *
 * @param overrides - Partial organization data to override defaults
 * @returns NewOrganization object ready for database insertion
 */
export function createTestOrganizationInput(
  overrides: Partial<NewOrganization> = {}
): NewOrganization {
  const slug = createUniqueSlug('org');

  return {
    name: createUniqueName('Test Organization'),
    slug,
    description: 'A test organization for automated testing',
    logoUrl: null,
    websiteUrl: null,
    ...overrides,
  };
}

/**
 * Create test organization with realistic defaults (full entity with ID)
 *
 * @param overrides - Partial organization data to override defaults
 * @returns Organization object (mock entity with all fields)
 */
export function createTestOrganization(
  overrides: Partial<Organization> = {}
): Organization {
  const now = new Date();
  const slug = createUniqueSlug('org');

  return {
    id: randomUUID(),
    name: createUniqueName('Test Organization'),
    slug,
    description: 'A test organization for automated testing',
    logoUrl: null,
    websiteUrl: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Create test organization membership INPUT (NewOrganizationMembership type - for database insertion)
 *
 * @param organizationId - Organization ID (required)
 * @param userId - User ID (required)
 * @param overrides - Partial membership data to override defaults
 * @returns NewOrganizationMembership object ready for database insertion
 *
 * @example
 * ```typescript
 * // For basic member
 * const membership = createTestMembershipInput(orgId, userId);
 * await db.insert(organizationMemberships).values(membership);
 *
 * // For admin with specific inviter
 * const adminMembership = createTestMembershipInput(orgId, userId, {
 *   role: 'admin',
 *   invitedBy: inviterId
 * });
 * ```
 */
export function createTestMembershipInput(
  organizationId: string,
  userId: string,
  overrides: Partial<NewOrganizationMembership> = {}
): NewOrganizationMembership {
  return {
    organizationId,
    userId,
    role: 'member',
    status: 'active',
    invitedBy: null,
    ...overrides,
  };
}

/**
 * Create test media item INPUT (NewMediaItem type - for database insertion)
 *
 * @param creatorId - Creator user ID (required)
 * @param overrides - Partial media item data to override defaults
 * @returns NewMediaItem object ready for database insertion
 */
export function createTestMediaItemInput(
  creatorId: string,
  overrides: Partial<NewMediaItem> = {}
): NewMediaItem {
  const mediaType = overrides.mediaType || MEDIA_TYPES.VIDEO;
  const tempId = randomUUID(); // For generating R2 key
  const status = overrides.status || MEDIA_STATUS.UPLOADING;

  // If status is 'ready', automatically populate required fields to satisfy DB constraint
  const isReady = status === MEDIA_STATUS.READY;

  return {
    creatorId,
    title: `Test ${mediaType} ${Date.now()}`,
    description: `Test ${mediaType} for automated testing`,
    mediaType,
    status,
    r2Key: `originals/${tempId}/${mediaType}.mp4`,
    fileSizeBytes: 1024 * 1024 * 10, // 10MB
    mimeType: mediaType === MEDIA_TYPES.VIDEO ? 'video/mp4' : 'audio/mpeg',
    durationSeconds: isReady ? 120 : null, // Required for status='ready'
    width: isReady && mediaType === MEDIA_TYPES.VIDEO ? 1920 : null,
    height: isReady && mediaType === MEDIA_TYPES.VIDEO ? 1080 : null,
    hlsMasterPlaylistKey: isReady ? `hls/${tempId}/master.m3u8` : null, // Required for status='ready'
    thumbnailKey: isReady ? `thumbnails/${tempId}/thumb.jpg` : null, // Required for video
    waveformKey:
      isReady && mediaType === MEDIA_TYPES.AUDIO
        ? `waveforms/${tempId}.json`
        : null, // Required for audio
    uploadedAt: isReady ? new Date() : null,
    ...overrides,
  };
}

/**
 * Create test media item with realistic defaults (full entity with ID)
 *
 * @param overrides - Partial media item data to override defaults
 * @returns MediaItem object (mock entity with all fields)
 */
export function createTestMediaItem(
  overrides: Partial<MediaItem> = {}
): MediaItem {
  const now = new Date();
  const id = randomUUID();
  const creatorId = overrides.creatorId || randomUUID();
  const mediaType = overrides.mediaType || MEDIA_TYPES.VIDEO;

  return {
    id,
    creatorId,
    title: `Test ${mediaType} ${Date.now()}`,
    description: `Test ${mediaType} for automated testing`,
    mediaType,
    status: MEDIA_STATUS.READY,
    r2Key: `originals/${id}/${mediaType}.mp4`,
    fileSizeBytes: 1024 * 1024 * 10, // 10MB
    mimeType: mediaType === MEDIA_TYPES.VIDEO ? 'video/mp4' : 'audio/mpeg',
    durationSeconds: 120, // 2 minutes
    width: mediaType === MEDIA_TYPES.VIDEO ? 1920 : null,
    height: mediaType === MEDIA_TYPES.VIDEO ? 1080 : null,
    hlsMasterPlaylistKey: `hls/${id}/master.m3u8`,
    hlsPreviewKey: null, // Transcoding Phase 1 field
    thumbnailKey:
      mediaType === MEDIA_TYPES.VIDEO ? `thumbnails/${id}/thumb.jpg` : null,
    waveformKey:
      mediaType === MEDIA_TYPES.AUDIO ? `waveforms/${id}/waveform.json` : null,
    waveformImageKey:
      mediaType === MEDIA_TYPES.AUDIO ? `waveforms/${id}/waveform.png` : null,
    runpodJobId: null, // Transcoding Phase 1 field
    transcodingError: null, // Transcoding Phase 1 field
    transcodingAttempts: 0, // Transcoding Phase 1 field
    transcodingPriority: 2, // Transcoding Phase 1 field (normal priority)
    mezzanineKey: null, // Transcoding Phase 1 field
    mezzanineStatus: null, // Transcoding Phase 1 field
    readyVariants: null, // Transcoding Phase 1 field
    loudnessIntegrated: null, // Transcoding Phase 1 field
    loudnessPeak: null, // Transcoding Phase 1 field
    loudnessRange: null, // Transcoding Phase 1 field
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Create test content INPUT (NewContent type - for database insertion)
 *
 * @param creatorId - Creator user ID (required)
 * @param overrides - Partial content data to override defaults
 * @returns NewContent object ready for database insertion
 */
export function createTestContentInput(
  creatorId: string,
  overrides: Partial<NewContent> = {}
): NewContent {
  const slug = createUniqueSlug('content');
  const contentType = overrides.contentType || CONTENT_TYPES.VIDEO;

  return {
    creatorId,
    organizationId: null,
    mediaItemId: null,
    title: `Test Content ${Date.now()}`,
    slug,
    description: 'Test content for automated testing',
    contentType,
    thumbnailUrl: null,
    contentBody:
      contentType === CONTENT_TYPES.WRITTEN ? 'Test content body' : null,
    category: 'test-category',
    tags: ['test', 'automation'],
    visibility: VISIBILITY.PUBLIC,
    priceCents: 0,
    status: CONTENT_STATUS.DRAFT,
    publishedAt: null,
    viewCount: 0,
    purchaseCount: 0,
    ...overrides,
  };
}

/**
 * Create test content with realistic defaults (full entity with ID)
 *
 * @param overrides - Partial content data to override defaults
 * @returns Content object (mock entity with all fields)
 */
export function createTestContent(overrides: Partial<Content> = {}): Content {
  const now = new Date();
  const slug = createUniqueSlug('content');
  const contentType = overrides.contentType || CONTENT_TYPES.VIDEO;

  return {
    id: randomUUID(),
    creatorId: overrides.creatorId || randomUUID(),
    organizationId: overrides.organizationId || null,
    mediaItemId: overrides.mediaItemId || null,
    title: `Test Content ${Date.now()}`,
    slug,
    description: 'Test content for automated testing',
    contentType,
    thumbnailUrl: null,
    contentBody:
      contentType === CONTENT_TYPES.WRITTEN ? 'Test content body' : null,
    category: 'test-category',
    tags: ['test', 'automation'],
    visibility: VISIBILITY.PUBLIC,
    priceCents: 0,
    status: CONTENT_STATUS.DRAFT,
    publishedAt: null,
    viewCount: 0,
    purchaseCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Create a complete test user ID
 * Uses UUID format to match auth service
 */
export function createTestUserId(): string {
  return randomUUID();
}

/**
 * Batch create multiple organizations
 *
 * @param count - Number of organizations to create
 * @param baseOverrides - Base overrides applied to all organizations
 * @returns Array of organization objects
 */
export function createTestOrganizations(
  count: number,
  baseOverrides: Partial<Organization> = {}
): Organization[] {
  return Array.from({ length: count }, () =>
    createTestOrganization(baseOverrides)
  );
}

/**
 * Batch create multiple media items
 *
 * @param count - Number of media items to create
 * @param baseOverrides - Base overrides applied to all media items
 * @returns Array of media item objects
 */
export function createTestMediaItems(
  count: number,
  baseOverrides: Partial<MediaItem> = {}
): MediaItem[] {
  return Array.from({ length: count }, () =>
    createTestMediaItem(baseOverrides)
  );
}

/**
 * Batch create multiple content items
 *
 * @param count - Number of content items to create
 * @param baseOverrides - Base overrides applied to all content items
 * @returns Array of content objects
 */
export function createTestContentItems(
  count: number,
  baseOverrides: Partial<Content> = {}
): Content[] {
  return Array.from({ length: count }, () => createTestContent(baseOverrides));
}

/**
 * Create a full content workflow:
 * - Organization (optional)
 * - Media item (ready status)
 * - Content (referencing media)
 *
 * @param options - Configuration options
 * @returns Object containing all related entities
 */
export function createTestContentWorkflow(
  options: {
    creatorId?: string;
    withOrganization?: boolean;
    contentType?: typeof CONTENT_TYPES.VIDEO | typeof CONTENT_TYPES.AUDIO;
    status?:
      | typeof CONTENT_STATUS.DRAFT
      | typeof CONTENT_STATUS.PUBLISHED
      | typeof CONTENT_STATUS.ARCHIVED;
  } = {}
): {
  creatorId: string;
  organization?: Organization;
  mediaItem: MediaItem;
  content: Content;
} {
  const creatorId = options.creatorId || createTestUserId();
  const contentType = options.contentType || CONTENT_TYPES.VIDEO;
  const status = options.status || CONTENT_STATUS.DRAFT;

  const organization = options.withOrganization
    ? createTestOrganization()
    : undefined;

  const mediaItem = createTestMediaItem({
    creatorId,
    mediaType: contentType,
    status: MEDIA_STATUS.READY,
  });

  const content = createTestContent({
    creatorId,
    organizationId: organization?.id || null,
    mediaItemId: mediaItem.id,
    contentType,
    status,
    publishedAt: status === CONTENT_STATUS.PUBLISHED ? new Date() : null,
  });

  return {
    creatorId,
    organization,
    mediaItem,
    content,
  };
}

// =============================================================================
// Auth Entity Factories
// =============================================================================

/**
 * User data for authentication testing
 */
export interface MockUserData {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session data for authentication testing
 */
export interface MockSessionData {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a mock user for authentication testing.
 *
 * @param overrides - Partial user data to override defaults
 * @returns MockUserData with realistic defaults
 *
 * @example
 * ```typescript
 * const user = createMockUser({ email: 'admin@example.com', role: 'admin' });
 * ```
 */
export function createMockUser(
  overrides: Partial<MockUserData> = {}
): MockUserData {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    email: `test-${Date.now()}@example.com`,
    name: 'Test User',
    emailVerified: true,
    image: null,
    role: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock session for authentication testing.
 *
 * @param userId - User ID to associate with session (defaults to random UUID)
 * @param overrides - Partial session data to override defaults
 * @returns MockSessionData with realistic defaults
 *
 * @example
 * ```typescript
 * const user = createMockUser();
 * const session = createMockSession(user.id);
 * ```
 */
export function createMockSession(
  userId?: string,
  overrides: Partial<MockSessionData> = {}
): MockSessionData {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  return {
    id: randomUUID(),
    userId: userId || randomUUID(),
    token: `session_${randomUUID().replace(/-/g, '')}`,
    expiresAt: expiresAt.toISOString(),
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Test Agent)',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

/**
 * Cached session data format (as stored in KV)
 */
export interface MockCachedSessionData {
  session: MockSessionData;
  user: MockUserData;
}

/**
 * Create a complete cached session data object for KV testing.
 *
 * @param overrides - Optional overrides for user and session
 * @returns Object with session and user data ready for KV storage
 *
 * @example
 * ```typescript
 * const cached = createMockCachedSession({
 *   user: { role: 'admin' }
 * });
 * mockKV._storage.set(`session:${cached.session.token}`, cached);
 * ```
 */
export function createMockCachedSession(overrides?: {
  user?: Partial<MockUserData>;
  session?: Partial<MockSessionData>;
}): MockCachedSessionData {
  const user = createMockUser(overrides?.user);
  const session = createMockSession(user.id, overrides?.session);

  return { session, user };
}

// =============================================================================
// Stripe Event Factories
// =============================================================================

/**
 * Stripe checkout session event options
 */
export interface MockStripeCheckoutEventOptions {
  eventId?: string;
  sessionId?: string;
  paymentIntentId?: string;
  paymentStatus?: string;
  amountTotal?: number;
  currency?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a mock Stripe checkout.session.completed event.
 *
 * Use this factory to generate realistic Stripe webhook events for testing
 * checkout completion handlers.
 *
 * @param overrides - Partial event data to override defaults
 * @returns Stripe.Event object matching checkout.session.completed type
 *
 * @example
 * ```typescript
 * const event = createMockStripeCheckoutEvent({
 *   metadata: {
 *     customerId: 'user_123',
 *     contentId: 'content_456',
 *   },
 *   amountTotal: 2999, // $29.99 in cents
 * });
 *
 * await handleCheckoutCompleted(event, mockStripe, context);
 * ```
 */
export function createMockStripeCheckoutEvent(
  overrides: MockStripeCheckoutEventOptions = {}
): {
  id: string;
  object: 'event';
  type: 'checkout.session.completed';
  api_version: string;
  created: number;
  data: {
    object: {
      id: string;
      object: 'checkout.session';
      payment_intent: string | null;
      payment_status: string;
      amount_total: number;
      currency: string;
      metadata: Record<string, string>;
    };
  };
  livemode: boolean;
  pending_webhooks: number;
  request: null;
} {
  const {
    eventId = `evt_test_${randomUUID().slice(0, 8)}`,
    sessionId = `cs_test_${randomUUID().slice(0, 8)}`,
    paymentIntentId = `pi_test_${randomUUID().slice(0, 8)}`,
    paymentStatus = 'paid',
    amountTotal = 2999,
    currency = 'usd',
    metadata = {
      customerId: randomUUID(),
      contentId: randomUUID(),
      organizationId: randomUUID(),
    },
  } = overrides;

  return {
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2025-10-29.clover',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: paymentIntentId,
        payment_status: paymentStatus,
        amount_total: amountTotal,
        currency,
        metadata,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
  };
}

/**
 * Stripe payment intent event options
 */
export interface MockStripePaymentIntentEventOptions {
  eventId?: string;
  paymentIntentId?: string;
  status?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a mock Stripe payment_intent.succeeded event.
 *
 * @param overrides - Partial event data to override defaults
 * @returns Stripe.Event object matching payment_intent.succeeded type
 *
 * @example
 * ```typescript
 * const event = createMockStripePaymentIntentEvent({
 *   amount: 5000, // $50.00
 *   metadata: { orderId: 'order_123' }
 * });
 * ```
 */
export function createMockStripePaymentIntentEvent(
  overrides: MockStripePaymentIntentEventOptions = {}
): {
  id: string;
  object: 'event';
  type: 'payment_intent.succeeded';
  api_version: string;
  created: number;
  data: {
    object: {
      id: string;
      object: 'payment_intent';
      status: string;
      amount: number;
      currency: string;
      metadata: Record<string, string>;
    };
  };
  livemode: boolean;
  pending_webhooks: number;
  request: null;
} {
  const {
    eventId = `evt_test_${randomUUID().slice(0, 8)}`,
    paymentIntentId = `pi_test_${randomUUID().slice(0, 8)}`,
    status = 'succeeded',
    amount = 2999,
    currency = 'usd',
    metadata = {},
  } = overrides;

  return {
    id: eventId,
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: '2025-10-29.clover',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        status,
        amount,
        currency,
        metadata,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
  };
}
