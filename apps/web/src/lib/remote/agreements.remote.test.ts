/**
 * Revenue-Share Agreements Remote Functions Tests
 *
 * Smoke tests for the remote-function bindings — verifies the module loads
 * cleanly and exports the documented surface. Wire-shape behaviour is
 * covered by the worker integration tests in WP-3.
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/agreements.remote', () => {
  beforeAll(async () => {
    await import('./agreements.remote');
  }, 30_000);

  it('exports listActiveAgreements query', async () => {
    const { listActiveAgreements } = await import('./agreements.remote');
    expect(listActiveAgreements).toBeDefined();
  });

  it('exports getAgreementThread query', async () => {
    const { getAgreementThread } = await import('./agreements.remote');
    expect(getAgreementThread).toBeDefined();
  });

  it('exports listMyAgreements query (for WP-8 creator surface)', async () => {
    const { listMyAgreements } = await import('./agreements.remote');
    expect(listMyAgreements).toBeDefined();
  });

  it('exports proposeAgreement command', async () => {
    const { proposeAgreement } = await import('./agreements.remote');
    expect(proposeAgreement).toBeDefined();
  });

  it('exports counterAgreement command', async () => {
    const { counterAgreement } = await import('./agreements.remote');
    expect(counterAgreement).toBeDefined();
  });

  it('exports acceptAgreement command', async () => {
    const { acceptAgreement } = await import('./agreements.remote');
    expect(acceptAgreement).toBeDefined();
  });

  it('exports declineAgreement command', async () => {
    const { declineAgreement } = await import('./agreements.remote');
    expect(declineAgreement).toBeDefined();
  });

  it('exports withdrawAgreement command', async () => {
    const { withdrawAgreement } = await import('./agreements.remote');
    expect(withdrawAgreement).toBeDefined();
  });

  it('exports terminateAgreement command', async () => {
    const { terminateAgreement } = await import('./agreements.remote');
    expect(terminateAgreement).toBeDefined();
  });
});
