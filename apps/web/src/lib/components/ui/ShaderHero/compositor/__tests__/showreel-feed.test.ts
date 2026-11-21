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
  showreelFeed.setLook(null);
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

  it('takes a look that says the same thing as no change (WP-5)', () => {
    const changed = vi.fn();
    showreelFeed.onChange(changed);
    showreelFeed.setLook({ frame: 'film-fill', band: 'none' });
    // A new object, the same frame and band: the Showreel re-renders often.
    showreelFeed.setLook({ frame: 'film-fill', band: 'none' });
    showreelFeed.setLook({ frame: 'film-name', band: 'none' });
    showreelFeed.setLook({ frame: 'film-name', band: 'fade' });
    showreelFeed.setLook(null);
    showreelFeed.setLook(null);
    expect(changed.mock.calls).toEqual([
      ['look'],
      ['look'],
      ['look'],
      ['look'],
    ]);
    expect(showreelFeed.look).toBeNull();
  });

  it('names a change of surface or push-in, and reads an absent one as none (5b)', () => {
    const changed = vi.fn();
    showreelFeed.onChange(changed);
    showreelFeed.setLook({ frame: 'film-fill', band: 'fade' });
    // absent is 'none' and no push: the same look
    showreelFeed.setLook({
      frame: 'film-fill',
      band: 'fade',
      surface: 'none',
      push: false,
    });
    showreelFeed.setLook({
      frame: 'film-fill',
      band: 'fade',
      surface: 'grain',
    });
    showreelFeed.setLook({
      frame: 'film-fill',
      band: 'fade',
      surface: 'grain',
    });
    showreelFeed.setLook({
      frame: 'film-fill',
      band: 'fade',
      surface: 'grain',
      push: true,
    });
    expect(changed.mock.calls).toEqual([['look'], ['look'], ['look']]);
    expect(showreelFeed.look).toMatchObject({ surface: 'grain', push: true });
  });
});
