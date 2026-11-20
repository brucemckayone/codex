/**
 * The Showreel's channel to the window's shader (Codex-1yd58.4): it holds the
 * film before any compositor exists, and tells its one reader what changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showreelFeed } from '../showreel-feed';
import { stageBoxFrom } from '../stage';

afterEach(() => {
  showreelFeed.onChange(null);
  showreelFeed.setMedia(null);
  showreelFeed.setStage(null);
  showreelFeed.setNameMask(null);
});

describe('showreelFeed', () => {
  it('holds what the Showreel sets, and names what changed', () => {
    const changed = vi.fn();
    showreelFeed.onChange(changed);
    const video = {} as HTMLVideoElement;
    const box = stageBoxFrom(
      { left: 0, top: 10, width: 300, height: 500 },
      0,
      400
    );
    const mask = {} as TexImageSource;
    showreelFeed.setMedia(video);
    showreelFeed.setStage(box);
    showreelFeed.setNameMask(mask);
    expect(showreelFeed.media).toBe(video);
    expect(showreelFeed.stage).toBe(box);
    expect(showreelFeed.mask).toBe(mask);
    expect(changed.mock.calls).toEqual([['media'], ['stage'], ['mask']]);
  });

  it('ignores the film or the frame it already holds, but uploads every mask set', () => {
    const video = {} as HTMLVideoElement;
    const mask = {} as TexImageSource;
    showreelFeed.setMedia(video);
    showreelFeed.setNameMask(mask);
    const changed = vi.fn();
    showreelFeed.onChange(changed);
    showreelFeed.setMedia(video);
    showreelFeed.setStage(null);
    // The same canvas, redrawn on a resize: told again.
    showreelFeed.setNameMask(mask);
    expect(changed.mock.calls).toEqual([['mask']]);
  });

  it('tells no one once its reader has gone', () => {
    const changed = vi.fn();
    showreelFeed.onChange(changed);
    showreelFeed.onChange(null);
    showreelFeed.setMedia({} as HTMLVideoElement);
    expect(changed).not.toHaveBeenCalled();
  });
});
