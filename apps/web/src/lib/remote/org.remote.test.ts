/**
 * Organization Remote Functions Tests
 *
 * Tests for organization data remote functions.
 * Mocks are centralized in src/tests/mocks.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/org.remote', () => {
  // Pre-warm dynamic imports (slow on first load)
  beforeAll(async () => {
    await import('./org.remote');
  }, 30_000);

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
