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
import type {
  Content,
  MediaItem,
  NewContent,
  NewMediaItem,
  NewOrganization,
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
  const mediaType = overrides.mediaType || 'video';
  const tempId = randomUUID(); // For generating R2 key
  const status = overrides.status || 'uploading';

  // If status is 'ready', automatically populate required fields to satisfy DB constraint
  const isReady = status === 'ready';

  return {
    creatorId,
    title: `Test ${mediaType} ${Date.now()}`,
    description: `Test ${mediaType} for automated testing`,
    mediaType,
    status,
    r2Key: `originals/${tempId}/${mediaType}.mp4`,
    fileSizeBytes: 1024 * 1024 * 10, // 10MB
    mimeType: mediaType === 'video' ? 'video/mp4' : 'audio/mpeg',
    durationSeconds: isReady ? 120 : null, // Required for status='ready'
    width: isReady && mediaType === 'video' ? 1920 : null,
    height: isReady && mediaType === 'video' ? 1080 : null,
    hlsMasterPlaylistKey: isReady ? `hls/${tempId}/master.m3u8` : null, // Required for status='ready'
    thumbnailKey: isReady ? `thumbnails/${tempId}/thumb.jpg` : null, // Required for status='ready'
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
  const mediaType = overrides.mediaType || 'video';

  return {
    id,
    creatorId,
    title: `Test ${mediaType} ${Date.now()}`,
    description: `Test ${mediaType} for automated testing`,
    mediaType,
    status: 'ready',
    r2Key: `originals/${id}/${mediaType}.mp4`,
    fileSizeBytes: 1024 * 1024 * 10, // 10MB
    mimeType: mediaType === 'video' ? 'video/mp4' : 'audio/mpeg',
    durationSeconds: 120, // 2 minutes
    width: mediaType === 'video' ? 1920 : null,
    height: mediaType === 'video' ? 1080 : null,
    hlsMasterPlaylistKey: `hls/${id}/master.m3u8`,
    thumbnailKey: `thumbnails/${id}/thumb.jpg`,
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
  const contentType = overrides.contentType || 'video';

  return {
    creatorId,
    organizationId: null,
    mediaItemId: null,
    title: `Test Content ${Date.now()}`,
    slug,
    description: 'Test content for automated testing',
    contentType,
    thumbnailUrl: null,
    contentBody: contentType === 'written' ? 'Test content body' : null,
    category: 'test-category',
    tags: ['test', 'automation'],
    visibility: 'public',
    priceCents: 0,
    status: 'draft',
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
  const contentType = overrides.contentType || 'video';

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
    contentBody: contentType === 'written' ? 'Test content body' : null,
    category: 'test-category',
    tags: ['test', 'automation'],
    visibility: 'public',
    priceCents: 0,
    status: 'draft',
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
    contentType?: 'video' | 'audio';
    status?: 'draft' | 'published' | 'archived';
  } = {}
): {
  creatorId: string;
  organization?: Organization;
  mediaItem: MediaItem;
  content: Content;
} {
  const creatorId = options.creatorId || createTestUserId();
  const contentType = options.contentType || 'video';
  const status = options.status || 'draft';

  const organization = options.withOrganization
    ? createTestOrganization()
    : undefined;

  const mediaItem = createTestMediaItem({
    creatorId,
    mediaType: contentType,
    status: 'ready',
  });

  const content = createTestContent({
    creatorId,
    organizationId: organization?.id || null,
    mediaItemId: mediaItem.id,
    contentType,
    status,
    publishedAt: status === 'published' ? new Date() : null,
  });

  return {
    creatorId,
    organization,
    mediaItem,
    content,
  };
}
