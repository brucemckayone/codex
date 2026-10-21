/**
 * Codex-2hxff.18 / .64 — a removal's follow-up is connected.
 *
 * `OrganizationService.removeMember` hands what a removal ended to an injected
 * `onMemberRemoved` callback, which the registry points at
 * `followUpMemberDeparture` (course subscriptions cancelled at period end,
 * caches cleared, one email to the creator). The service tests construct
 * their own callback, so without this pin deleting the registry wiring would
 * leave every test green while no course subscription is ever cancelled.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as orphan-producer-wiring.test.ts). No CACHE_KV and no execution context,
 * so the follow-up skips its cache and email steps.
 */
import type { MemberDeparture } from '@codex/organization';
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
function removalCallbackOf(
  service: object
): ((departure: MemberDeparture) => Promise<void>) | undefined {
  return (
    service as {
      onMemberRemoved?: (departure: MemberDeparture) => Promise<void>;
    }
  ).onMemberRemoved;
}

describe('member removal wiring (Codex-2hxff.64)', () => {
  it("registry organization cancels the removed creator's course subscriptions, 50 at once", async () => {
    const { registry, cleanup } = await createServiceRegistry(orgEnv());
    try {
      const cancel = vi
        .spyOn(registry.courseSubscription, 'cancelForCoursesOffSale')
        .mockResolvedValue({ cancelled: 0, failed: 0, remaining: 0 });
      const callback = removalCallbackOf(registry.organization);
      expect(callback).toBeTypeOf('function');

      await callback?.({
        organizationId: 'org-1',
        creatorId: 'creator-1',
        at: new Date(),
        endedAgreements: [],
        catalogue: { contentIds: [], courseIds: ['course-1'] },
      });

      expect(cancel).toHaveBeenCalledWith({
        courseIds: ['course-1'],
        limit: 50,
      });
    } finally {
      await cleanup();
    }
  });
});
