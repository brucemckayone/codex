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

  it('POSITIVE SIDE EFFECT: org content version bump is surfaced as a stale `:content` key', () => {
    // The org layout's $effect (apps/web/src/routes/_org/[slug]/+layout.svelte)
    // matches on `key.includes(':content')` to invalidate `contentCollection`.
    // This test proves the manifest yields that shape of key after publish.
    localStorage.setItem(
      MANIFEST_KEY,
      JSON.stringify({ 'org:org-1:content': 'v100' })
    );

    const stale = getStaleKeys({ 'org:org-1:content': 'v101' });
    expect(stale).toHaveLength(1);
    expect(stale[0].includes(':content')).toBe(true);
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
