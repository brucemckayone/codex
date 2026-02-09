/**
 * Organization Remote Functions Tests
 *
 * Tests for organization data remote functions.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock SvelteKit server modules before importing
vi.mock('$app/server', () => ({
  query: vi.fn((_schema, fn) => fn),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn() },
  })),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: {
      getBySlug: vi.fn(),
      getSettings: vi.fn(),
    },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42075'),
}));

describe('remote/org.remote', () => {
  it('exports getOrganization query', async () => {
    const { getOrganization } = await import('./org.remote');
    expect(getOrganization).toBeDefined();
  });

  it('exports getPublicBranding query', async () => {
    const { getPublicBranding } = await import('./org.remote');
    expect(getPublicBranding).toBeDefined();
  });

  it('exports getOrgSettings query', async () => {
    const { getOrgSettings } = await import('./org.remote');
    expect(getOrgSettings).toBeDefined();
  });

  it('exports getOrganizationById query', async () => {
    const { getOrganizationById } = await import('./org.remote');
    expect(getOrganizationById).toBeDefined();
  });
});
