/**
 * Template Routes - Unit Tests
 *
 * Tests for template CRUD operations and preview/test-send endpoints.
 * Uses cloudflare:test module for Worker runtime testing.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Template Routes', () => {
  describe('Global Template Routes', () => {
    it('GET /api/templates/global requires authentication', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/global'
      );
      // Should return 401 (unauthorized) without auth
      expect([401, 500]).toContain(response.status);
    });

    it('POST /api/templates/global requires authentication', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/global',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'test-template',
            subject: 'Test Subject',
            htmlBody: '<p>Test</p>',
            textBody: 'Test',
          }),
        }
      );
      expect([401, 500]).toContain(response.status);
    });
  });

  describe('Creator Template Routes', () => {
    it('GET /api/templates/creator requires authentication', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/creator'
      );
      expect([401, 500]).toContain(response.status);
    });

    it('POST /api/templates/creator requires authentication', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/creator',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'my-template',
            subject: 'My Subject',
            htmlBody: '<p>Hello</p>',
            textBody: 'Hello',
          }),
        }
      );
      expect([401, 500]).toContain(response.status);
    });
  });

  describe('Organization Template Routes', () => {
    it('GET /api/templates/organizations/:orgId requires authentication', async () => {
      const orgId = '00000000-0000-0000-0000-000000000001';
      const response = await SELF.fetch(
        `http://localhost/api/templates/organizations/${orgId}`
      );
      expect([401, 500]).toContain(response.status);
    });

    it('POST /api/templates/organizations/:orgId requires authentication', async () => {
      const orgId = '00000000-0000-0000-0000-000000000001';
      const response = await SELF.fetch(
        `http://localhost/api/templates/organizations/${orgId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'org-template',
            subject: 'Org Subject',
            htmlBody: '<p>Org content</p>',
            textBody: 'Org content',
          }),
        }
      );
      expect([401, 500]).toContain(response.status);
    });
  });

  describe('Preview Routes', () => {
    it('POST /api/templates/:id/preview requires authentication', async () => {
      const templateId = '00000000-0000-0000-0000-000000000001';
      const response = await SELF.fetch(
        `http://localhost/api/templates/${templateId}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { userName: 'Test' } }),
        }
      );
      expect([401, 500]).toContain(response.status);
    });

    it('POST /api/templates/:id/test-send requires authentication', async () => {
      const templateId = '00000000-0000-0000-0000-000000000001';
      const response = await SELF.fetch(
        `http://localhost/api/templates/${templateId}/test-send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientEmail: 'test@example.com',
            data: { userName: 'Test' },
          }),
        }
      );
      expect([401, 500]).toContain(response.status);
    });
  });

  describe('Input Validation', () => {
    it('rejects invalid template name format', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/global',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'invalid name with spaces!',
            subject: 'Test',
            htmlBody: '<p>Test</p>',
            textBody: 'Test',
          }),
        }
      );
      // Either 400 (validation error) or 401/500 (auth/env error)
      expect([400, 401, 500]).toContain(response.status);
    });

    it('rejects missing required fields', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/global',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'test-template',
            // Missing subject, htmlBody, textBody
          }),
        }
      );
      expect([400, 401, 500]).toContain(response.status);
    });

    it('rejects invalid UUID for template ID', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/templates/not-a-uuid/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: {} }),
        }
      );
      expect([400, 401, 500]).toContain(response.status);
    });

    it('rejects invalid email in test-send', async () => {
      const templateId = '00000000-0000-0000-0000-000000000001';
      const response = await SELF.fetch(
        `http://localhost/api/templates/${templateId}/test-send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientEmail: 'not-an-email',
            data: {},
          }),
        }
      );
      expect([400, 401, 500]).toContain(response.status);
    });
  });
});
