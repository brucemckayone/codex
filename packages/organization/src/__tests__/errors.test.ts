/**
 * Identity Service Error Tests
 *
 * Tests for identity-specific error classes
 */

import { NotFoundError } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { OrganizationNotFoundError } from '../errors';

describe('Identity Service Errors', () => {
  describe('OrganizationNotFoundError', () => {
    it('should extend NotFoundError', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should have correct HTTP status code', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.statusCode).toBe(404);
    });

    it('should have correct message', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.message).toBe('Organization not found');
    });

    it('should include organizationId in context', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.context).toEqual({ organizationId: 'org-123' });
    });

    it('should be catchable as Error', () => {
      try {
        throw new OrganizationNotFoundError('org-123');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as OrganizationNotFoundError).context?.organizationId).toBe(
          'org-123'
        );
      }
    });

    it('should maintain correct inheritance chain', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error).toBeInstanceOf(OrganizationNotFoundError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should serialize custom properties to JSON', () => {
      const error = new OrganizationNotFoundError('org-123');
      const serialized = JSON.parse(JSON.stringify(error));

      // Only custom properties are serialized (not message/stack)
      expect(serialized).toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
        context: { organizationId: 'org-123' },
      });

      // Message is accessible on the object but not serialized
      expect(error.message).toBe('Organization not found');
    });

    it('should have proper name property', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.name).toBe('OrganizationNotFoundError');
    });

    it('should capture stack trace', () => {
      const error = new OrganizationNotFoundError('org-123');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('OrganizationNotFoundError');
    });
  });
});
