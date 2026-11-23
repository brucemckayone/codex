/**
 * The shader windows' frame hook: one host at a time, and its frames reach
 * only the listeners subscribed, only while a shader is live. ShaderHero's
 * side (when it emits, and what it says is live) is pinned in
 * ShaderHero.svelte.test.ts ("ShaderHero publishFrames").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

import {
  isShaderLive,
  onShaderFrame,
  registerShaderHost,
  requestShaderFrame,
} from '../shader-frame.svelte';

const cleanups: (() => void)[] = [];

function host() {
  const canvas = document.createElement('canvas');
  const requestFrame = vi.fn();
  const handle = registerShaderHost({ canvas, requestFrame });
  cleanups.push(() => handle.release());
  return { canvas, requestFrame, ...handle };
}

function listen(listener = vi.fn()) {
  cleanups.push(onShaderFrame(listener));
  return listener;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  logger.warn.mockClear();
});

describe('shader frames', () => {
  it('hands each frame to a listener, and none once it unsubscribes', () => {
    const source = host();
    source.setLive(true);
    const listener = vi.fn();
    const unsubscribe = onShaderFrame(listener);
    source.emit();
    source.emit();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(source.canvas);

    unsubscribe();
    source.emit();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands over no frame while no shader is live', () => {
    const source = host();
    const listener = listen();
    source.emit();
    expect(listener).not.toHaveBeenCalled();

    source.setLive(true);
    source.emit();
    expect(listener).toHaveBeenCalledTimes(1);

    source.setLive(false);
    source.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is live only while its host says so, and not once the host goes', () => {
    expect(isShaderLive()).toBe(false);
    const source = host();
    // Registered, but nothing drawn yet.
    expect(isShaderLive()).toBe(false);
    source.setLive(true);
    expect(isShaderLive()).toBe(true);
    source.setLive(false);
    expect(isShaderLive()).toBe(false);
    source.setLive(true);
    source.release();
    expect(isShaderLive()).toBe(false);
  });

  it('asks the host for a frame, and does nothing with no host', () => {
    expect(() => requestShaderFrame()).not.toThrow();
    const source = host();
    requestShaderFrame();
    expect(source.requestFrame).toHaveBeenCalledTimes(1);

    source.release();
    requestShaderFrame();
    expect(source.requestFrame).toHaveBeenCalledTimes(1);
  });

  it('hands over to a newer host, which the older one can no longer move', () => {
    const old = host();
    old.setLive(true);
    const listener = listen();
    const next = host();
    // The newer shader has not drawn yet: the old one's frame is not its.
    expect(isShaderLive()).toBe(false);
    old.setLive(true);
    expect(isShaderLive()).toBe(false);
    next.setLive(true);
    expect(isShaderLive()).toBe(true);

    old.emit();
    expect(listener).not.toHaveBeenCalled();
    next.emit();
    expect(listener).toHaveBeenCalledWith(next.canvas);

    requestShaderFrame();
    expect(next.requestFrame).toHaveBeenCalledTimes(1);
    expect(old.requestFrame).not.toHaveBeenCalled();

    // The old layout unmounting after the new one mounted resets nothing.
    old.release();
    expect(isShaderLive()).toBe(true);
    next.release();
    expect(isShaderLive()).toBe(false);
  });

  it('drops the frame of a listener that throws, hands it to the rest, and says so once', () => {
    const source = host();
    source.setLive(true);
    listen(
      vi.fn(() => {
        throw new Error('copy failed');
      })
    );
    const after = listen();
    expect(() => {
      source.emit();
      source.emit();
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'shader_hero.frame_listener_failed',
      expect.objectContaining({ error: 'copy failed' })
    );
  });
});
