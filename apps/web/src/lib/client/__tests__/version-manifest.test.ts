/**
 * Client version manifest tests.
 *
 * Locks the staleness-detection contract that turns server-side cache
 * version bumps into client-side collection invalidation:
 *
 *   server publishes → KV bumps `cache:version:org:{orgId}:content`
 *     → next SSR streams the new version string to the client
 *     → getStaleKeys() diffs it against localStorage
 *     → $effect in +layout.svelte invalidates `contentCollection`
 *
 * The FIX (public.ts + explore id/type swap) lets step 1 actually happen.
 * Without this staleness chain working, the fix silently falls back to
 * per-navigation SSR, which is fine but misses the cross-tab path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import {
  clearClientState,
  getStaleKeys,
  resolveStaleCacheTargets,
  updateStoredVersions,
} from '../version-manifest';

const MANIFEST_KEY = 'codex-versions';

describe('getStaleKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty on first visit (stored manifest is empty)', () => {
    const result = getStaleKeys({
      'org:org-1:content': 'v1',
      'user:u-1:library': 'v2',
    });
    // No prior version = trust SSR data, don't invalidate.
    expect(result).toEqual([]);
  });

  it('returns empty when all stored versions match server versions', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({
        'org:org-1:content': 'v1',
        'user:u-1:library': 'v2',
      })
    );

    const result = getStaleKeys({
      'org:org-1:content': 'v1',
      'user:u-1:library': 'v2',
    });
    expect(result).toEqual([]);
  });

  it('returns the key when the server version has advanced (the publish → invalidate path)', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v1' })
    );

    // Publish on server bumped the version to v2.
    const result = getStaleKeys({ 'org:org-1:content': 'v2' });
    expect(result).toEqual(['org:org-1:content']);
  });

  it('POSITIVE SIDE EFFECT: org content version bump is surfaced as the exact content key', () => {
    // The org layout's $effect (apps/web/src/routes/_org/[slug]/+layout.svelte)
    // feeds this key into resolveStaleCacheTargets (exact-key match) to
    // invalidate `contentCollection`. This test proves the manifest yields the
    // exact key that resolver maps; the resolver's own dispatch is covered in
    // the resolveStaleCacheTargets suite below.
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v100' })
    );

    const stale = getStaleKeys({ 'org:org-1:content': 'v101' });
    expect(stale).toEqual(['org:org-1:content']);
  });

  it('skips null server versions (no KV entry, nothing to track yet)', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v1' })
    );

    const result = getStaleKeys({ 'org:org-1:content': null });
    expect(result).toEqual([]);
  });

  it('reports only changed keys when some match and some differ', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({
        'org:org-1:content': 'v1',
        'user:u-1:library': 'v2',
        'org:org-1:config': 'v3',
      })
    );

    const result = getStaleKeys({
      'org:org-1:content': 'v1', // unchanged
      'user:u-1:library': 'v99', // changed
      'org:org-1:config': 'v3', // unchanged
    });
    expect(result).toEqual(['user:u-1:library']);
  });

  it('returns empty when localStorage contains garbage (parse error is swallowed)', () => {
    localStorage.setItem(MANIFEST_KEY, 'not valid json{');

    const result = getStaleKeys({ 'org:org-1:content': 'v1' });
    // Stored treated as empty → no prior versions → no stale keys.
    expect(result).toEqual([]);
  });
});

describe('updateStoredVersions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes non-null versions to the manifest', () => {
    updateStoredVersions({ 'org:org-1:content': 'v1' });

    const stored = JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? '{}');
    expect(stored).toEqual({ 'org:org-1:content': 'v1' });
  });

  it('skips null versions (no KV entry yet — nothing to track)', () => {
    updateStoredVersions({
      'org:org-1:content': 'v1',
      'user:u-1:library': null,
    });

    const stored = JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? '{}');
    expect(stored).toEqual({ 'org:org-1:content': 'v1' });
  });

  it('merges new versions with existing stored versions', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v1', 'user:u-1:library': 'v10' })
    );

    updateStoredVersions({ 'org:org-1:content': 'v2' });

    const stored = JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? '{}');
    expect(stored).toEqual({
      'org:org-1:content': 'v2',
      'user:u-1:library': 'v10',
    });
  });

  it('updates a key when the stored version is older (post-publish scenario)', () => {
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v1' })
    );

    // Round-trip: after seeing a stale key, the client calls updateStoredVersions
    // to record the new version so subsequent visibility-change checks don't
    // re-fire on the same bump.
    updateStoredVersions({ 'org:org-1:content': 'v2' });

    const stored = JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? '{}');
    expect(stored['org:org-1:content']).toBe('v2');

    // And the next getStaleKeys call with the same SSR payload returns [].
    expect(getStaleKeys({ 'org:org-1:content': 'v2' })).toEqual([]);
  });
});

describe('clearClientState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes the version manifest', () => {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify({ foo: 'bar' }));
    clearClientState();
    expect(localStorage.getItem(MANIFEST_KEY)).toBeNull();
  });

  it('removes all Codex-owned keys (library, progress, following, subscription)', () => {
    localStorage.setItem(MANIFEST_KEY, '{}');
    localStorage.setItem('codex-library', '[]');
    localStorage.setItem('codex-playback-progress', '[]');
    localStorage.setItem('codex-following', '[]');
    localStorage.setItem('codex-subscription', '[]');
    localStorage.setItem('other-app-key', 'keep-me');

    clearClientState();

    expect(localStorage.getItem(MANIFEST_KEY)).toBeNull();
    expect(localStorage.getItem('codex-library')).toBeNull();
    expect(localStorage.getItem('codex-playback-progress')).toBeNull();
    expect(localStorage.getItem('codex-following')).toBeNull();
    expect(localStorage.getItem('codex-subscription')).toBeNull();
    // Non-Codex keys are untouched.
    expect(localStorage.getItem('other-app-key')).toBe('keep-me');
  });
});

describe('publish → stale → refresh round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('detects a version bump and records the new version after refresh', () => {
    // 1. First visit: SSR streams v1, client records it.
    updateStoredVersions({ 'org:org-1:content': 'v1' });
    expect(getStaleKeys({ 'org:org-1:content': 'v1' })).toEqual([]);

    // 2. Creator publishes on server → KV bumps version to v2.

    // 3. Next SSR (new navigation or visibilitychange → invalidate) streams v2.
    //    Client sees mismatch with stored v1.
    const stale = getStaleKeys({ 'org:org-1:content': 'v2' });
    expect(stale).toEqual(['org:org-1:content']);

    // 4. Client invalidates the content collection, then records v2 so
    //    subsequent visibility-change checks don't re-fire.
    updateStoredVersions({ 'org:org-1:content': 'v2' });
    expect(getStaleKeys({ 'org:org-1:content': 'v2' })).toEqual([]);
  });
});

describe('resolveStaleCacheTargets (exact-key dispatch)', () => {
  const IDS = { orgId: 'org-1', userId: 'u-1' };

  // Exact keys mirroring readOrgVersions in _org/[slug]/+layout.server.ts.
  const CONTENT_KEY = 'org:org-1:content';
  const LIBRARY_KEY = 'user:u-1:library';
  const SUBSCRIPTION_KEY = 'user:u-1:subscription:org-1';
  const ORG_CONFIG_KEY = 'org:config:org-1';

  it('maps a stale content key to exactly the content target', () => {
    expect(resolveStaleCacheTargets([CONTENT_KEY], IDS)).toEqual(
      new Set(['content'])
    );
  });

  it('maps a stale library key to exactly the library target', () => {
    expect(resolveStaleCacheTargets([LIBRARY_KEY], IDS)).toEqual(
      new Set(['library'])
    );
  });

  it('maps a stale subscription key to exactly the subscription target', () => {
    expect(resolveStaleCacheTargets([SUBSCRIPTION_KEY], IDS)).toEqual(
      new Set(['subscription'])
    );
  });

  it('changing one key invalidates only that target — the others stay untouched', () => {
    // Contract: "a changed version for key X invalidates exactly X's cache".
    const targets = resolveStaleCacheTargets([LIBRARY_KEY], IDS);
    expect(targets.has('library')).toBe(true);
    expect(targets.has('content')).toBe(false);
    expect(targets.has('subscription')).toBe(false);
  });

  it('leaves the ORG_CONFIG key unmapped (SSR-served — behaviour preserved)', () => {
    // Under the old substring dispatch, org:config:{orgId} matched none of
    // :content / :library / :subscription and fired no client invalidation.
    // Exact-key mapping preserves that: no target for org config.
    expect(resolveStaleCacheTargets([ORG_CONFIG_KEY], IDS)).toEqual(new Set());
  });

  it('does NOT fire content for a key that merely contains ":content" as a substring', () => {
    // Regression for the latent bug: the old `key.includes(':content')` test
    // would have wrongly invalidated the content collection for a sibling key
    // like this. Exact matching rejects it.
    expect(resolveStaleCacheTargets(['org:org-1:content:draft'], IDS)).toEqual(
      new Set()
    );
    expect(
      resolveStaleCacheTargets(['org:org-1:content-archive'], IDS)
    ).toEqual(new Set());
  });

  it('routes a brand-new key by its own exact entry, not a substring branch', () => {
    // The bug this WP closes: a future `org:{id}:pages` / `:courses` key
    // contains none of the old magic substrings, so substring dispatch dropped
    // it silently. Exact-key dispatch makes each key's routing explicit — an
    // unmapped future key yields no target (and never bleeds into an existing
    // one), so adding pages/courses later is a single visible map entry that
    // dispatches deterministically.
    const future = ['org:org-1:pages', 'org:org-1:courses'];
    expect(resolveStaleCacheTargets(future, IDS)).toEqual(new Set());
    // A mapped key alongside future keys still dispatches — proving per-key
    // exact lookup, not an all-or-nothing substring scan.
    expect(resolveStaleCacheTargets([...future, CONTENT_KEY], IDS)).toEqual(
      new Set(['content'])
    );
  });

  it('unions targets when multiple distinct keys are stale', () => {
    const targets = resolveStaleCacheTargets(
      [CONTENT_KEY, LIBRARY_KEY, SUBSCRIPTION_KEY],
      IDS
    );
    expect(targets).toEqual(new Set(['content', 'library', 'subscription']));
  });

  it("scopes keys by orgId — a different org's content key does not match", () => {
    expect(resolveStaleCacheTargets(['org:other:content'], IDS)).toEqual(
      new Set()
    );
  });

  it('cannot dispatch user-scoped targets for an anonymous visitor (no userId)', () => {
    // Anonymous: only the org content key is dispatchable; user library /
    // subscription keys are never produced server-side, and if seen, ignored.
    const anon = { orgId: 'org-1' };
    expect(resolveStaleCacheTargets([CONTENT_KEY], anon)).toEqual(
      new Set(['content'])
    );
    expect(
      resolveStaleCacheTargets([LIBRARY_KEY, SUBSCRIPTION_KEY], anon)
    ).toEqual(new Set());
  });

  it('returns an empty set when nothing is stale', () => {
    expect(resolveStaleCacheTargets([], IDS)).toEqual(new Set());
  });
});
