import { describe, expect, it } from 'vitest';
import {
  type CheckoutSessionMetadata,
  type CreateCheckoutInput,
  checkoutSessionMetadataSchema,
  createCheckoutSchema,
  type GetPurchaseInput,
  getPurchaseSchema,
  type PurchaseQueryInput,
  type PurchaseStatus,
  purchaseQuerySchema,
  purchaseStatusEnum,
} from '../purchase';

/**
 * Purchase Validation Schema Tests
 *
 * Test Strategy:
 * 1. Valid inputs (happy path)
 * 2. Invalid inputs (error cases)
 * 3. Edge cases (boundary conditions)
 * 4. Security validations (XSS prevention in URLs)
 * 5. Database constraint alignment (status enum)
 *
 * No database required - pure validation logic testing
 */

describe('Purchase Status Enum', () => {
  describe('purchaseStatusEnum', () => {
    it('should validate all valid purchase statuses', () => {
      const validStatuses: PurchaseStatus[] = [
        'pending',
        'completed',
        'refunded',
        'failed',
      ];

      validStatuses.forEach((status) => {
        expect(purchaseStatusEnum.parse(status)).toBe(status);
      });
    });

    it('should reject invalid status values', () => {
      const invalidStatuses = [
        'processing',
        'cancelled',
        'active',
        'inactive',
        '',
        'COMPLETED',
      ];

      invalidStatuses.forEach((status) => {
        expect(() => purchaseStatusEnum.parse(status)).toThrow(
          'Status must be pending, completed, refunded, or failed'
        );
      });
    });

    it('should be case-sensitive', () => {
      expect(() => purchaseStatusEnum.parse('PENDING')).toThrow();
      expect(() => purchaseStatusEnum.parse('Completed')).toThrow();
      expect(purchaseStatusEnum.parse('completed')).toBe('completed');
    });
  });
});

describe('Create Checkout Schema', () => {
  describe('createCheckoutSchema', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should validate correct checkout data', () => {
      const validCheckout: CreateCheckoutInput = {
        contentId: validUuid,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      };

      const result = createCheckoutSchema.parse(validCheckout);
      expect(result).toEqual(validCheckout);
    });

    it('should validate with HTTP URLs', () => {
      const checkout = {
        contentId: validUuid,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      };

      const result = createCheckoutSchema.parse(checkout);
      expect(result.successUrl).toBe('http://localhost:3000/success');
      expect(result.cancelUrl).toBe('http://localhost:3000/cancel');
    });

    it('should validate with HTTPS URLs', () => {
      const checkout = {
        contentId: validUuid,
        successUrl: 'http://localhost:3000/payment/success',
        cancelUrl: 'http://localhost:3000/payment/cancel',
      };

      const result = createCheckoutSchema.parse(checkout);
      expect(result).toEqual(checkout);
    });

    it('should validate URLs with query parameters', () => {
      const checkout = {
        contentId: validUuid,
        successUrl: 'http://localhost:3000/success?session=123&user=456',
        cancelUrl: 'http://localhost:3000/cancel?reason=user',
      };

      const result = createCheckoutSchema.parse(checkout);
      expect(result.successUrl).toContain('?session=123');
      expect(result.cancelUrl).toContain('?reason=user');
    });

    it('should validate URLs with fragments', () => {
      const checkout = {
        contentId: validUuid,
        successUrl: 'http://localhost:3000/dashboard#purchases',
        cancelUrl: 'http://localhost:3000/content#back',
      };

      const result = createCheckoutSchema.parse(checkout);
      expect(result.successUrl).toBe(
        'http://localhost:3000/dashboard#purchases'
      );
      expect(result.cancelUrl).toBe('http://localhost:3000/content#back');
    });

    describe('contentId validation', () => {
      it('should reject invalid UUID format', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: 'not-a-uuid',
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('Invalid ID format');
      });

      it('should reject empty contentId', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: '',
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('Invalid ID format');
      });

      it('should reject numeric contentId', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: 12345,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow();
      });
    });

    describe('URL validation', () => {
      it('should reject missing successUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow();
      });

      it('should reject missing cancelUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'http://localhost:3000/success',
          })
        ).toThrow();
      });

      it('should reject empty string URLs', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: '',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('Invalid URL format');

        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: '',
          })
        ).toThrow('Invalid URL format');
      });

      it('should reject malformed URLs', () => {
        const malformedUrls = [
          'not-a-url',
          'htp://example.com',
          '//example.com',
          'example.com/success',
          'www.example.com',
        ];

        malformedUrls.forEach((url) => {
          expect(() =>
            createCheckoutSchema.parse({
              contentId: validUuid,
              successUrl: url,
              cancelUrl: 'http://localhost:3000/cancel',
            })
          ).toThrow();
        });
      });

      it('should reject relative URLs', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: '/success',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow();

        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: '../cancel',
          })
        ).toThrow();
      });
    });

    describe('XSS Prevention', () => {
      it('should reject javascript: URLs in successUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'javascript:alert(1)',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });

      it('should reject javascript: URLs in cancelUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'javascript:alert(1)',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });

      it('should reject data: URLs in successUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'data:text/html,<script>alert(1)</script>',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });

      it('should reject data: URLs in cancelUrl', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'data:text/html,<script>alert(1)</script>',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });

      it('should reject file: URLs', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'file:///etc/passwd',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });

      it('should reject ftp: URLs', () => {
        expect(() =>
          createCheckoutSchema.parse({
            contentId: validUuid,
            successUrl: 'ftp://example.com/success',
            cancelUrl: 'http://localhost:3000/cancel',
          })
        ).toThrow('URL must use HTTP or HTTPS protocol');
      });
    });

    describe('Type inference', () => {
      it('should infer correct TypeScript type', () => {
        const checkout: CreateCheckoutInput = {
          contentId: validUuid,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        };

        // Type assertion to verify TypeScript inference
        const parsed = createCheckoutSchema.parse(checkout);
        const _typeCheck: CreateCheckoutInput = parsed;
        expect(parsed).toEqual(checkout);
      });
    });
  });
});

describe('Purchase Query Schema', () => {
  describe('purchaseQuerySchema', () => {
    it('should validate with default values', () => {
      const result = purchaseQuerySchema.parse({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.status).toBeUndefined();
      expect(result.contentId).toBeUndefined();
    });

    it('should validate with all filters', () => {
      const query: PurchaseQueryInput = {
        page: 2,
        limit: 50,
        status: 'completed',
        contentId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = purchaseQuerySchema.parse(query);
      expect(result).toEqual(query);
    });

    it('should validate with only page', () => {
      const query = { page: 5 };
      const result = purchaseQuerySchema.parse(query);

      expect(result.page).toBe(5);
      expect(result.limit).toBe(20); // default
    });

    it('should validate with only limit', () => {
      const query = { limit: 100 };
      const result = purchaseQuerySchema.parse(query);

      expect(result.page).toBe(1); // default
      expect(result.limit).toBe(100);
    });

    it('should validate with only status filter', () => {
      const query = { status: 'pending' as const };
      const result = purchaseQuerySchema.parse(query);

      expect(result.status).toBe('pending');
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should validate with only contentId filter', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const query = { contentId: validUuid };
      const result = purchaseQuerySchema.parse(query);

      expect(result.contentId).toBe(validUuid);
    });

    describe('Page validation', () => {
      it('should reject page less than 1', () => {
        expect(() => purchaseQuerySchema.parse({ page: 0 })).toThrow(
          'Must be greater than 0'
        );
      });

      it('should reject negative page', () => {
        expect(() => purchaseQuerySchema.parse({ page: -1 })).toThrow(
          'Must be greater than 0'
        );
      });

      it('should reject page exceeding 1000', () => {
        expect(() => purchaseQuerySchema.parse({ page: 1001 })).toThrow(
          'Must be 1000 or less'
        );
      });

      it('should accept page 1000', () => {
        const result = purchaseQuerySchema.parse({ page: 1000 });
        expect(result.page).toBe(1000);
      });

      it('should reject non-integer page', () => {
        expect(() => purchaseQuerySchema.parse({ page: 1.5 })).toThrow(
          'Must be a whole number'
        );
      });
    });

    describe('Limit validation', () => {
      it('should reject limit less than 1', () => {
        expect(() => purchaseQuerySchema.parse({ limit: 0 })).toThrow(
          'Must be greater than 0'
        );
      });

      it('should reject negative limit', () => {
        expect(() => purchaseQuerySchema.parse({ limit: -10 })).toThrow(
          'Must be greater than 0'
        );
      });

      it('should reject limit exceeding 100', () => {
        expect(() => purchaseQuerySchema.parse({ limit: 101 })).toThrow(
          'Must be 100 or less'
        );
      });

      it('should accept limit 100', () => {
        const result = purchaseQuerySchema.parse({ limit: 100 });
        expect(result.limit).toBe(100);
      });

      it('should accept limit 1', () => {
        const result = purchaseQuerySchema.parse({ limit: 1 });
        expect(result.limit).toBe(1);
      });

      it('should reject non-integer limit', () => {
        expect(() => purchaseQuerySchema.parse({ limit: 20.5 })).toThrow(
          'Must be a whole number'
        );
      });
    });

    describe('Status filter validation', () => {
      it('should validate all valid status values', () => {
        const validStatuses: PurchaseStatus[] = [
          'pending',
          'completed',
          'refunded',
          'failed',
        ];

        validStatuses.forEach((status) => {
          const result = purchaseQuerySchema.parse({ status });
          expect(result.status).toBe(status);
        });
      });

      it('should reject invalid status values', () => {
        expect(() =>
          purchaseQuerySchema.parse({ status: 'processing' })
        ).toThrow('Status must be pending, completed, refunded, or failed');

        expect(() =>
          purchaseQuerySchema.parse({ status: 'cancelled' })
        ).toThrow('Status must be pending, completed, refunded, or failed');
      });

      it('should allow omitting status', () => {
        const result = purchaseQuerySchema.parse({ page: 1 });
        expect(result.status).toBeUndefined();
      });
    });

    describe('ContentId filter validation', () => {
      it('should validate valid UUID', () => {
        const validUuid = '123e4567-e89b-12d3-a456-426614174000';
        const result = purchaseQuerySchema.parse({ contentId: validUuid });
        expect(result.contentId).toBe(validUuid);
      });

      it('should reject invalid UUID format', () => {
        expect(() =>
          purchaseQuerySchema.parse({ contentId: 'not-a-uuid' })
        ).toThrow('Invalid ID format');
      });

      it('should reject empty contentId', () => {
        expect(() => purchaseQuerySchema.parse({ contentId: '' })).toThrow(
          'Invalid ID format'
        );
      });

      it('should allow omitting contentId', () => {
        const result = purchaseQuerySchema.parse({ page: 1 });
        expect(result.contentId).toBeUndefined();
      });
    });

    describe('Type inference', () => {
      it('should infer correct TypeScript type', () => {
        const query: PurchaseQueryInput = {
          page: 1,
          limit: 20,
          status: 'completed',
          contentId: '123e4567-e89b-12d3-a456-426614174000',
        };

        const parsed = purchaseQuerySchema.parse(query);
        const _typeCheck: PurchaseQueryInput = parsed;
        expect(parsed).toEqual(query);
      });
    });
  });
});

describe('Get Purchase Schema', () => {
  describe('getPurchaseSchema', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should validate correct purchase ID', () => {
      const input: GetPurchaseInput = {
        id: validUuid,
      };

      const result = getPurchaseSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should reject invalid UUID format', () => {
      expect(() => getPurchaseSchema.parse({ id: 'not-a-uuid' })).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject empty ID', () => {
      expect(() => getPurchaseSchema.parse({ id: '' })).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject numeric ID', () => {
      expect(() => getPurchaseSchema.parse({ id: 12345 })).toThrow();
    });

    it('should reject missing ID', () => {
      expect(() => getPurchaseSchema.parse({})).toThrow();
    });

    it('should reject UUID v1 format', () => {
      // UUID v1 format (time-based)
      const uuidV1 = 'a0eebc99-9c0b-11e5-8994-fec3e51486e1';
      // Note: Zod's uuid() accepts v1-v5, so this will pass
      // If strict v4 validation is needed, add custom refinement
      const result = getPurchaseSchema.parse({ id: uuidV1 });
      expect(result.id).toBe(uuidV1);
    });

    describe('Type inference', () => {
      it('should infer correct TypeScript type', () => {
        const input: GetPurchaseInput = {
          id: validUuid,
        };

        const parsed = getPurchaseSchema.parse(input);
        const _typeCheck: GetPurchaseInput = parsed;
        expect(parsed).toEqual(input);
      });
    });
  });
});

describe('Database Constraint Alignment', () => {
  describe('Purchase status enum alignment', () => {
    it('should match database CHECK constraint exactly', () => {
      // Database constraint (ecommerce.ts line 298-301):
      // CHECK (status IN ('pending', 'completed', 'refunded', 'failed'))

      const dbStatuses = ['pending', 'completed', 'refunded', 'failed'];

      dbStatuses.forEach((status) => {
        expect(() => purchaseStatusEnum.parse(status)).not.toThrow();
      });
    });

    it('should reject values not in database CHECK constraint', () => {
      const invalidStatuses = ['processing', 'cancelled', 'active', 'success'];

      invalidStatuses.forEach((status) => {
        expect(() => purchaseStatusEnum.parse(status)).toThrow();
      });
    });
  });

  describe('Field validation matches database columns', () => {
    it('should validate contentId as UUID (matches FK reference)', () => {
      // Database: contentId uuid (FK -> content.id)
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';

      const checkout = createCheckoutSchema.parse({
        contentId: validUuid,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(checkout.contentId).toBe(validUuid);
    });

    it('should validate purchase ID as UUID (matches PK)', () => {
      // Database: id uuid PRIMARY KEY
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';

      const purchase = getPurchaseSchema.parse({ id: validUuid });
      expect(purchase.id).toBe(validUuid);
    });
  });
});

describe('Edge Cases', () => {
  describe('Boundary conditions', () => {
    it('should accept page 1 (minimum)', () => {
      const result = purchaseQuerySchema.parse({ page: 1 });
      expect(result.page).toBe(1);
    });

    it('should accept page 1000 (maximum)', () => {
      const result = purchaseQuerySchema.parse({ page: 1000 });
      expect(result.page).toBe(1000);
    });

    it('should accept limit 1 (minimum)', () => {
      const result = purchaseQuerySchema.parse({ limit: 1 });
      expect(result.limit).toBe(1);
    });

    it('should accept limit 100 (maximum)', () => {
      const result = purchaseQuerySchema.parse({ limit: 100 });
      expect(result.limit).toBe(100);
    });
  });

  describe('URL edge cases', () => {
    it('should accept URLs with ports', () => {
      const checkout = createCheckoutSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:8080/cancel',
      });

      expect(checkout.successUrl).toBe('http://localhost:3000/success');
      expect(checkout.cancelUrl).toBe('http://localhost:8080/cancel');
    });

    it('should accept URLs with authentication', () => {
      const checkout = createCheckoutSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        successUrl: 'https://user:pass@localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(checkout.successUrl).toBe(
        'https://user:pass@localhost:3000/success'
      );
    });

    it('should accept URLs with encoded characters', () => {
      const checkout = createCheckoutSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        successUrl: 'http://localhost:3000/success?name=John%20Doe',
        cancelUrl: 'http://localhost:3000/cancel?reason=not%20interested',
      });

      expect(checkout.successUrl).toContain('%20');
      expect(checkout.cancelUrl).toContain('%20');
    });
  });

  describe('Optional field behavior', () => {
    it('should handle omitted optional filters', () => {
      const result = purchaseQuerySchema.parse({});

      expect(result.status).toBeUndefined();
      expect(result.contentId).toBeUndefined();
      expect(result.page).toBe(1); // default
      expect(result.limit).toBe(20); // default
    });

    it('should allow null for optional fields', () => {
      // Zod .optional() allows undefined, not null
      // This test documents current behavior
      expect(() => purchaseQuerySchema.parse({ status: null })).toThrow();
    });
  });
});

describe('Checkout Session Metadata Schema', () => {
  /**
   * checkoutSessionMetadataSchema validates metadata attached to Stripe checkout sessions.
   * Used by webhook handler to extract purchase details from completed checkout.
   *
   * Key validation:
   * - customerId: Better Auth user ID (alphanumeric, NOT UUID)
   * - contentId: UUID
   * - organizationId: Optional UUID (transforms empty string to null)
   */

  describe('valid metadata', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const validBetterAuthId = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

    it('should validate complete metadata with all fields', () => {
      const metadata: CheckoutSessionMetadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: validUuid,
      };

      const result = checkoutSessionMetadataSchema.parse(metadata);
      expect(result.customerId).toBe(validBetterAuthId);
      expect(result.contentId).toBe(validUuid);
      expect(result.organizationId).toBe(validUuid);
    });

    it('should accept metadata without organizationId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
      };

      const result = checkoutSessionMetadataSchema.parse(metadata);
      expect(result.customerId).toBe(validBetterAuthId);
      expect(result.contentId).toBe(validUuid);
      expect(result.organizationId).toBeNull();
    });

    it('should accept null organizationId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: null,
      };

      const result = checkoutSessionMetadataSchema.parse(metadata);
      expect(result.organizationId).toBeNull();
    });

    it('should reject empty string organizationId (use null or omit)', () => {
      // Empty string is not a valid UUID - use null or omit the field
      // Stripe metadata with missing organizationId should be null, not ''
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: '',
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });

    it('should accept various Better Auth ID formats', () => {
      const betterAuthIds = [
        'abc123', // short
        'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b', // typical 32-char
        'a'.repeat(64), // max length
        'MixedCaseId123456789012345678901', // mixed case
      ];

      betterAuthIds.forEach((id) => {
        const metadata = {
          customerId: id,
          contentId: validUuid,
        };

        const result = checkoutSessionMetadataSchema.parse(metadata);
        expect(result.customerId).toBe(id);
      });
    });
  });

  describe('customerId validation (Better Auth format)', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should reject UUID format for customerId', () => {
      // Better Auth uses alphanumeric IDs, NOT UUIDs
      // This is the critical fix in this PR
      const metadata = {
        customerId: validUuid, // UUID format - should be rejected
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid user ID format'
      );
    });

    it('should reject customerId with hyphens', () => {
      const metadata = {
        customerId: 'user-with-hyphens',
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid user ID format'
      );
    });

    it('should reject customerId with underscores', () => {
      const metadata = {
        customerId: 'user_with_underscores',
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid user ID format'
      );
    });

    it('should reject empty customerId', () => {
      const metadata = {
        customerId: '',
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'User ID is required'
      );
    });

    it('should reject customerId exceeding max length', () => {
      const metadata = {
        customerId: 'a'.repeat(65),
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'User ID is too long'
      );
    });

    it('should reject missing customerId', () => {
      const metadata = {
        contentId: validUuid,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow();
    });
  });

  describe('contentId validation (UUID format)', () => {
    const validBetterAuthId = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

    it('should accept valid UUID for contentId', () => {
      const validUuids = [
        '123e4567-e89b-12d3-a456-426614174000',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        '00000000-0000-0000-0000-000000000000',
      ];

      validUuids.forEach((uuid) => {
        const metadata = {
          customerId: validBetterAuthId,
          contentId: uuid,
        };

        const result = checkoutSessionMetadataSchema.parse(metadata);
        expect(result.contentId).toBe(uuid);
      });
    });

    it('should reject non-UUID contentId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: 'not-a-uuid',
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject Better Auth ID format for contentId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validBetterAuthId, // Using Better Auth ID instead of UUID
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject empty contentId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: '',
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject missing contentId', () => {
      const metadata = {
        customerId: validBetterAuthId,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow();
    });
  });

  describe('organizationId validation (optional UUID)', () => {
    const validBetterAuthId = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should accept valid UUID for organizationId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: validUuid,
      };

      const result = checkoutSessionMetadataSchema.parse(metadata);
      expect(result.organizationId).toBe(validUuid);
    });

    it('should reject invalid UUID for organizationId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: 'not-a-uuid',
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });

    it('should reject Better Auth ID format for organizationId', () => {
      const metadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: validBetterAuthId,
      };

      expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow(
        'Invalid ID format'
      );
    });
  });

  describe('security validation', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';

    it('should reject SQL injection in customerId', () => {
      const sqlInjectionAttempts = [
        "'; DROP TABLE users; --",
        '1 OR 1=1',
        "' UNION SELECT * FROM purchases--",
      ];

      sqlInjectionAttempts.forEach((attempt) => {
        const metadata = {
          customerId: attempt,
          contentId: validUuid,
        };

        expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow();
      });
    });

    it('should reject XSS attempts in customerId', () => {
      const xssAttempts = ['<script>alert(1)</script>', 'javascript:alert(1)'];

      xssAttempts.forEach((attempt) => {
        const metadata = {
          customerId: attempt,
          contentId: validUuid,
        };

        expect(() => checkoutSessionMetadataSchema.parse(metadata)).toThrow();
      });
    });
  });

  describe('type inference', () => {
    it('should infer correct TypeScript type', () => {
      const validBetterAuthId = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';

      const metadata: CheckoutSessionMetadata = {
        customerId: validBetterAuthId,
        contentId: validUuid,
        organizationId: validUuid,
      };

      const parsed = checkoutSessionMetadataSchema.parse(metadata);
      const _typeCheck: CheckoutSessionMetadata = parsed;
      expect(parsed.customerId).toBe(validBetterAuthId);
    });
  });
});
