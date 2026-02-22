/**
 * Library Remote Functions Tests
 *
 * Tests for user library and playback remote functions.
 * Mocks are centralized in src/tests/mocks.ts
 */

import { describe, expect, it } from 'vitest';

describe('remote/library.remote', () => {
  it('exports getUserLibrary query', async () => {
    const { getUserLibrary } = await import('./library.remote');
    expect(getUserLibrary).toBeDefined();
  });

  it('exports getStreamingUrl query', async () => {
    const { getStreamingUrl } = await import('./library.remote');
    expect(getStreamingUrl).toBeDefined();
  });

  it('exports getPlaybackProgress query', async () => {
    const { getPlaybackProgress } = await import('./library.remote');
    expect(getPlaybackProgress).toBeDefined();
  });

  it('exports savePlaybackProgress command', async () => {
    const { savePlaybackProgress } = await import('./library.remote');
    expect(savePlaybackProgress).toBeDefined();
  });

  it('exports getPlaybackProgressBatch batched query', async () => {
    const { getPlaybackProgressBatch } = await import('./library.remote');
    expect(getPlaybackProgressBatch).toBeDefined();
  });

  it('exports NormalizedProgress type', async () => {
    // Type-only export, just verify the module loads
    const module = await import('./library.remote');
    expect(module).toBeDefined();
  });
});
