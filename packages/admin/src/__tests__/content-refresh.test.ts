/**
 * `refreshAfterChange` (Codex-a6ofh.6): what an org admin's delete or Keep,
 * or a platform admin's takedown, refreshes in the background. The route
 * hands it to `ctx.background`, and that promise settling is what lets the
 * request's DB cleanup run. So it must settle only once EVERY refresh has:
 * one failing first must not release the pool under another still reading.
 *
 * SHAPE. No database: the two shared refreshes are stubbed, the org counts
 * held open by hand, and the library refresh made to fail first.
 */

import { describe, expect, it, vi } from 'vitest';

const invalidateContentAccess = vi.hoisted(() => vi.fn());
const invalidateOrgPublicCounts = vi.hoisted(() => vi.fn());
vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return { ...actual, invalidateContentAccess, invalidateOrgPublicCounts };
});

// Below the mock on purpose: the service resolves the mocked module.
import { AdminContentManagementService } from '../services/content-management-service';

/** The service's own logger, as the access suites read theirs. */
const obsOf = (service: AdminContentManagementService) =>
  (
    service as unknown as {
      obs: { warn(message: string, meta?: Record<string, unknown>): void };
    }
  ).obs;

describe('AdminContentManagementService.refreshAfterChange', () => {
  it('settles only once every refresh has, logging each failure by name', async () => {
    invalidateContentAccess.mockRejectedValue(new Error('holders read failed'));
    let finishCounts = () => {};
    invalidateOrgPublicCounts.mockReturnValue(
      new Promise<void>((resolve) => {
        finishCounts = resolve;
      })
    );
    const service = new AdminContentManagementService({
      db: {} as never,
      environment: 'test',
    });
    service.setCache({ invalidate: vi.fn(async () => {}) } as never);
    const warn = vi.spyOn(obsOf(service), 'warn').mockImplementation(() => {});

    let settled = false;
    const run = service
      .refreshAfterChange(
        { contentId: 'c-1', organizationId: 'o-1' },
        'content_kept',
        () => {}
      )
      .then(() => {
        settled = true;
      });
    // Let the library refresh's rejection land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);
    finishCounts();
    await run;
    expect(settled).toBe(true);
    expect(
      warn.mock.calls.map(([, meta]) => [meta?.refresh, meta?.reason])
    ).toEqual([['library', 'content_kept']]);
  });
});
