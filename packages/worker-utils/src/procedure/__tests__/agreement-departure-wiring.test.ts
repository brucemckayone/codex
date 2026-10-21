/**
 * Codex-2hxff.18 — a removal's departure emails are connected.
 *
 * `OrganizationService.removeMember` ends the member's agreements and hands
 * them to an injected `onAgreementsEndedByDeparture` callback, which the
 * registry points at `AgreementService.notifyTerminatedOnDeparture`. The
 * service tests construct their own callback, so without this pin deleting the
 * registry wiring would leave every test green while no removed creator is
 * ever told their agreement ended.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as orphan-producer-wiring.test.ts).
 */
import type { DepartureTerminatedAgreement } from '@codex/agreements';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../service-registry';

function orgEnv(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
  } as unknown as Bindings;
}

/** Read a private field without widening the production type. */
function departureCallbackOf(
  service: object
): ((agreements: DepartureTerminatedAgreement[]) => Promise<void>) | undefined {
  return (
    service as {
      onAgreementsEndedByDeparture?: (
        agreements: DepartureTerminatedAgreement[]
      ) => Promise<void>;
    }
  ).onAgreementsEndedByDeparture;
}

describe('agreement departure wiring (Codex-2hxff.18)', () => {
  it('registry organization hands ended agreements to the agreements service', async () => {
    const { registry, cleanup } = await createServiceRegistry(orgEnv());
    try {
      const notify = vi
        .spyOn(registry.agreements, 'notifyTerminatedOnDeparture')
        .mockResolvedValue(undefined);
      const callback = departureCallbackOf(registry.organization);
      expect(callback).toBeTypeOf('function');

      const ended = [
        { id: 'agreement-1' },
      ] as unknown as DepartureTerminatedAgreement[];
      await callback?.(ended);

      expect(notify).toHaveBeenCalledWith(ended);
    } finally {
      await cleanup();
    }
  });
});
