/**
 * settings/branding → /studio/brand permanent redirect (Codex-cijzb WP-1.1).
 *
 * The old branding surface moved into the unified /studio/brand workspace.
 * The universal load throws a 301 redirect; assert the status + location.
 * (load() is synchronous, so we capture the thrown redirect via try/catch.)
 */
import { describe, expect, it } from 'vitest';
import { load } from '../+page';

type LoadInput = Parameters<typeof load>[0];

describe('studio/settings/branding — redirect', () => {
  it('permanently redirects (301) to /studio/brand', () => {
    let thrown: unknown;
    try {
      load({} as unknown as LoadInput);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 301, location: '/studio/brand' });
  });
});
