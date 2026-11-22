/**
 * The org layout's shader state: one writer at a time, and back to `pending`
 * when that writer goes. The component's reports are pinned in
 * ShaderHero.svelte.test.ts ("ShaderHero live").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type ShaderLiveWriter, shaderLive } from '../shader-live.svelte';

const writers: ShaderLiveWriter[] = [];
const claim = () => {
  const writer = shaderLive.claim();
  writers.push(writer);
  return writer;
};

afterEach(() => {
  for (const writer of writers.splice(0)) writer.release();
});

describe('shaderLive', () => {
  it('is pending until its writer reports, and again once it releases', () => {
    expect(shaderLive.state).toBe('pending');
    const writer = claim();
    expect(shaderLive.state).toBe('pending');
    writer.report('live');
    expect(shaderLive.state).toBe('live');
    writer.report('failed');
    expect(shaderLive.state).toBe('failed');
    writer.release();
    expect(shaderLive.state).toBe('pending');
  });

  it('hands over to a newer claim, which the older writer can no longer move', () => {
    const old = claim();
    old.report('live');
    const next = claim();
    // A new shader has not settled yet: the old one's state is not its.
    expect(shaderLive.state).toBe('pending');
    next.report('none');
    old.report('live');
    expect(shaderLive.state).toBe('none');
    // The old layout unmounting after the new one mounted resets nothing.
    old.release();
    expect(shaderLive.state).toBe('none');
    next.release();
    expect(shaderLive.state).toBe('pending');
  });
});
