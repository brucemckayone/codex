/**
 * Content-Specific Test Helpers
 *
 * Assertion helpers and utilities specifically for content management testing.
 *
 * Usage:
 * ```typescript
 * expectContentServiceError(error, 'NOT_FOUND');
 * expectContentEqual(actual, expected);
 * expectPaginationValid(response.pagination);
 * ```
 */

import { expect } from 'vitest';
import type { Content, MediaItem, Organization } from '@codex/database/schema';
import type { PaginationMetadata } from './types';

/**
 * Content Service Error Codes
 */
export type ContentServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'BUSINESS_LOGIC_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Assert that an error is a ContentServiceError with expected code
 *
 * @param error - Error to check
 * @param expectedCode - Expected error code
 */
export function expectContentServiceError(
  error: unknown,
  expectedCode: ContentServiceErrorCode
): void {
  expect(error).toBeInstanceOf(Error);

  const err = error as Error & {
    code?: string;
    statusCode?: number;
    message: string;
  };
  expect(err.code).toBe(expectedCode);
  expect(err.statusCode).toBeDefined();
  expect(err.message).toBeDefined();
}

/**
 * Deep equality check for content objects
 * Compares all fields except timestamps (which may vary slightly)
 *
 * @param actual - Actual content
 * @param expected - Expected content
 */
export function expectContentEqual(
  actual: Partial<Content>,
  expected: Partial<Content>
): void {
  // Check core fields
  if (expected.id) expect(actual.id).toBe(expected.id);
  if (expected.creatorId) expect(actual.creatorId).toBe(expected.creatorId);
  if (expected.organizationId !== undefined) {
    expect(actual.organizationId).toBe(expected.organizationId);
  }
  if (expected.mediaItemId !== undefined) {
    expect(actual.mediaItemId).toBe(expected.mediaItemId);
  }
  if (expected.title) expect(actual.title).toBe(expected.title);
  if (expected.slug) expect(actual.slug).toBe(expected.slug);
  if (expected.description !== undefined) {
    expect(actual.description).toBe(expected.description);
  }
  if (expected.contentType) {
    expect(actual.contentType).toBe(expected.contentType);
  }
  if (expected.status) expect(actual.status).toBe(expected.status);
  if (expected.visibility) expect(actual.visibility).toBe(expected.visibility);
  if (expected.priceCents !== undefined) {
    expect(actual.priceCents).toBe(expected.priceCents);
  }
  if (expected.category !== undefined) {
    expect(actual.category).toBe(expected.category);
  }
  if (expected.tags) {
    expect(actual.tags).toEqual(expected.tags);
  }
}

/**
 * Deep equality check for media item objects
 *
 * @param actual - Actual media item
 * @param expected - Expected media item
 */
export function expectMediaItemEqual(
  actual: Partial<MediaItem>,
  expected: Partial<MediaItem>
): void {
  if (expected.id) expect(actual.id).toBe(expected.id);
  if (expected.creatorId) expect(actual.creatorId).toBe(expected.creatorId);
  if (expected.title) expect(actual.title).toBe(expected.title);
  if (expected.mediaType) expect(actual.mediaType).toBe(expected.mediaType);
  if (expected.status) expect(actual.status).toBe(expected.status);
  if (expected.r2Key) expect(actual.r2Key).toBe(expected.r2Key);
  if (expected.mimeType) expect(actual.mimeType).toBe(expected.mimeType);
  if (expected.fileSizeBytes !== undefined) {
    expect(actual.fileSizeBytes).toBe(expected.fileSizeBytes);
  }
  if (expected.durationSeconds !== undefined) {
    expect(actual.durationSeconds).toBe(expected.durationSeconds);
  }
}

/**
 * Deep equality check for organization objects
 *
 * @param actual - Actual organization
 * @param expected - Expected organization
 */
export function expectOrganizationEqual(
  actual: Partial<Organization>,
  expected: Partial<Organization>
): void {
  if (expected.id) expect(actual.id).toBe(expected.id);
  if (expected.name) expect(actual.name).toBe(expected.name);
  if (expected.slug) expect(actual.slug).toBe(expected.slug);
  if (expected.description !== undefined) {
    expect(actual.description).toBe(expected.description);
  }
  if (expected.logoUrl !== undefined) {
    expect(actual.logoUrl).toBe(expected.logoUrl);
  }
  if (expected.websiteUrl !== undefined) {
    expect(actual.websiteUrl).toBe(expected.websiteUrl);
  }
}

/**
 * Validate pagination structure
 *
 * @param pagination - Pagination metadata to validate
 */
export function expectPaginationValid(pagination: PaginationMetadata): void {
  expect(pagination.page).toBeGreaterThanOrEqual(1);
  expect(pagination.limit).toBeGreaterThanOrEqual(1);
  expect(pagination.total).toBeGreaterThanOrEqual(0);
  expect(pagination.totalPages).toBeGreaterThanOrEqual(0);

  // Total pages should be ceiling(total / limit)
  const expectedPages = Math.ceil(pagination.total / pagination.limit);
  expect(pagination.totalPages).toBe(expectedPages);
}

/**
 * Assert that content has required relations populated
 *
 * @param content - Content with relations
 */
export function expectContentWithRelations(
  content: Partial<Content> & {
    mediaItem?: { id: string; [key: string]: unknown };
    organization?: { id: string; [key: string]: unknown };
    creator?: { id: string; email: string; [key: string]: unknown };
  },
  options: {
    expectMediaItem?: boolean;
    expectOrganization?: boolean;
    expectCreator?: boolean;
  } = {}
): void {
  if (options.expectMediaItem) {
    expect(content.mediaItem).toBeDefined();
    expect(content.mediaItem?.id).toBeDefined();
  }

  if (options.expectOrganization) {
    expect(content.organization).toBeDefined();
    expect(content.organization?.id).toBeDefined();
  }

  if (options.expectCreator) {
    expect(content.creator).toBeDefined();
    expect(content.creator?.id).toBeDefined();
    expect(content.creator?.email).toBeDefined();
  }
}

/**
 * Assert that media item has required relations populated
 *
 * @param mediaItem - Media item with relations
 */
export function expectMediaItemWithRelations(
  mediaItem: Partial<MediaItem> & {
    creator?: { id: string; email: string; [key: string]: unknown };
  },
  options: {
    expectCreator?: boolean;
  } = {}
): void {
  if (options.expectCreator) {
    expect(mediaItem.creator).toBeDefined();
    expect(mediaItem.creator?.id).toBeDefined();
    expect(mediaItem.creator?.email).toBeDefined();
  }
}

/**
 * Assert that an array is sorted by a specific field
 *
 * @param items - Array of items
 * @param field - Field to check sorting on
 * @param order - Expected sort order
 */
export function expectSorted<T>(
  items: T[],
  field: keyof T,
  order: 'asc' | 'desc'
): void {
  if (items.length <= 1) return;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1][field];
    const curr = items[i][field];

    if (order === 'asc') {
      expect(Number(curr)).toBeGreaterThanOrEqual(Number(prev));
    } else {
      expect(Number(curr)).toBeLessThanOrEqual(Number(prev));
    }
  }
}

/**
 * Assert that content is in draft status
 */
export function expectDraft(content: Partial<Content>): void {
  expect(content.status).toBe('draft');
  expect(content.publishedAt).toBeNull();
}

/**
 * Assert that content is published
 */
export function expectPublished(content: Partial<Content>): void {
  expect(content.status).toBe('published');
  expect(content.publishedAt).toBeDefined();
  expect(content.publishedAt).not.toBeNull();
}

/**
 * Assert that content is archived
 */
export function expectArchived(content: Partial<Content>): void {
  expect(content.status).toBe('archived');
}

/**
 * Assert that media item is in expected status
 */
export function expectMediaStatus(
  mediaItem: Partial<MediaItem>,
  expectedStatus: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
): void {
  expect(mediaItem.status).toBe(expectedStatus);

  if (expectedStatus === 'ready') {
    expect(mediaItem.hlsMasterPlaylistKey).toBeDefined();
    expect(mediaItem.thumbnailKey).toBeDefined();
    expect(mediaItem.durationSeconds).toBeDefined();
  }
}

/**
 * Assert that entity is not soft-deleted
 */
export function expectNotDeleted(entity: { deletedAt: Date | null }): void {
  expect(entity.deletedAt).toBeNull();
}

/**
 * Assert that entity is soft-deleted
 */
export function expectDeleted(entity: { deletedAt: Date | null }): void {
  expect(entity.deletedAt).toBeDefined();
  expect(entity.deletedAt).not.toBeNull();
}

/**
 * Generate a valid test slug
 * Ensures uniqueness and follows slug format rules
 */
export { createUniqueSlug } from './factories';

/**
 * Wait for a condition to be true (with timeout)
 * Useful for async operations
 */
export { waitFor } from './helpers';
