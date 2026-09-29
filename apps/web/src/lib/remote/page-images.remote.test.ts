/**
 * Page-image remote function — export smoke test (Codex-61zsk.10).
 *
 * Mocks are centralized in `src/tests/mocks.ts` ($app/server + $lib/server/api).
 * Behavioural forwarding (the actual upload round-trip) is exercised by the
 * integration path — the content-api route + `ImageProcessingService` tests
 * — not here: full remote-function runtime mocking is fragile (see
 * `content.remote.test.ts` and the same note in `categories.remote.test.ts`,
 * whose `uploadCategoryCoverForm` case this file mirrors).
 *
 * The structural rule this function has to obey — a `File` may only travel
 * through `form()`, never `command()`/`query()` — is asserted separately and
 * mechanically, over every `*.remote.ts` file's source, by
 * `remote-file-uploads.test.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

describe('remote/page-images.remote', () => {
  // Pre-warm dynamic imports (slow on first load).
  beforeAll(async () => {
    await import('./page-images.remote');
  }, 30_000);

  it('exports uploadPageImageForm form', async () => {
    const { uploadPageImageForm } = await import('./page-images.remote');
    expect(uploadPageImageForm).toBeDefined();
  });

  it('exports exactly one remote function — no delete/clear sibling', async () => {
    // Contract amendment A3: a page image has no column to clear, so unlike
    // every still-image remote in journeys.remote.ts (hero/cover/signature,
    // each with a delete command), this module intentionally has only the
    // upload. Removing an image is expressed by saving the page without its
    // reference. A future accidental "clear" export would silently invite a
    // client to build a delete UX around a slot this feature doesn't have.
    const moduleExports = await import('./page-images.remote');
    expect(Object.keys(moduleExports)).toEqual(['uploadPageImageForm']);
  });
});
