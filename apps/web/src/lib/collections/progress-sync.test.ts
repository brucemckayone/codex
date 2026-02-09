/**
 * Progress Sync Manager Tests
 *
 * Tests for the background sync manager.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock $app/environment
vi.mock('$app/environment', () => ({
  browser: false, // Default to server-side for safe testing
}));

// Mock the progress module
vi.mock('./progress', () => ({
  syncProgressToServer: vi.fn(() => Promise.resolve()),
}));

describe('collections/progress-sync', () => {
  it('exports initProgressSync', async () => {
    const { initProgressSync } = await import('./progress-sync');
    expect(initProgressSync).toBeDefined();
    expect(typeof initProgressSync).toBe('function');
  });

  it('exports cleanupProgressSync', async () => {
    const { cleanupProgressSync } = await import('./progress-sync');
    expect(cleanupProgressSync).toBeDefined();
    expect(typeof cleanupProgressSync).toBe('function');
  });

  it('exports forceSync', async () => {
    const { forceSync } = await import('./progress-sync');
    expect(forceSync).toBeDefined();
    expect(typeof forceSync).toBe('function');
  });

  it('forceSync returns a Promise', async () => {
    const { forceSync } = await import('./progress-sync');
    const result = forceSync();
    expect(result).toBeInstanceOf(Promise);
  });

  it('initProgressSync is safe to call on server (no-op)', async () => {
    const { initProgressSync } = await import('./progress-sync');
    // Should not throw even when browser is false
    expect(() => initProgressSync()).not.toThrow();
  });

  it('cleanupProgressSync is safe to call on server (no-op)', async () => {
    const { cleanupProgressSync } = await import('./progress-sync');
    // Should not throw even when browser is false
    expect(() => cleanupProgressSync()).not.toThrow();
  });
});
