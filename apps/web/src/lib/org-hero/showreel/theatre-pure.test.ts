/**
 * The theatre's pure rules (Codex-1yd58.8): what offers a preview with
 * sound, how the film sits, the waveform's bars, and when a recording's
 * sound may be tapped at all.
 */

import type { IntroFilm } from '@codex/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgHeroPiece } from '../hero-config';
import type { ReelEntry } from '../reel';
import { barLevels, canTap, tapWaveform, WAVE_BARS } from './reel-waveform';
import { theatreFit, theatreFor } from './theatre';

const FILM: IntroFilm = {
  title: 'Our film',
  posterUrl: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
  previewUrl: 'http://localhost:4100/org/hls/film/preview/index.m3u8',
  durationSeconds: 754,
  fullFilm: false,
};
const piece = (
  kind: OrgHeroPiece['kind'],
  previewUrl: string | null
): ReelEntry => ({
  type: 'piece',
  show: 'still',
  piece: {
    kind,
    kicker: 'Featured',
    title: 'Drum Journey',
    meta: 'A recording',
    line: null,
    href: '/content/drum-journey',
    imageUrl: 'http://localhost:4100/org/thumbnails/drum/lg.webp',
    previewUrl,
    durationSeconds: 1200,
    cta: 'Listen',
  },
});
const PREVIEW = 'http://localhost:4100/org/hls/drum/preview/preview.m3u8';

describe('theatreFor', () => {
  it("plays the film's preview, titled as the reel words it", () => {
    expect(
      theatreFor(
        { type: 'film', film: FILM, show: 'footage' },
        'Of Blood & Bones'
      )
    ).toEqual({
      kind: 'video',
      src: FILM.previewUrl,
      title: 'Of Blood & Bones',
      still: FILM.posterUrl,
    });
  });

  it('plays a video or a recording that has a preview, its still as the cover', () => {
    expect(theatreFor(piece('audio', PREVIEW), 'Drum Journey')).toEqual({
      kind: 'audio',
      src: PREVIEW,
      title: 'Drum Journey',
      still: 'http://localhost:4100/org/thumbnails/drum/lg.webp',
    });
    expect(theatreFor(piece('video', PREVIEW), 'Drum Journey')?.kind).toBe(
      'video'
    );
  });

  it('offers nothing for a portal, an essay, or a piece or film with no preview', () => {
    expect(theatreFor(piece('portal', PREVIEW), 'x')).toBeNull();
    expect(theatreFor(piece('article', PREVIEW), 'x')).toBeNull();
    expect(theatreFor(piece('audio', null), 'x')).toBeNull();
    expect(
      theatreFor(
        { type: 'film', film: { ...FILM, previewUrl: null }, show: 'still' },
        'x'
      )
    ).toBeNull();
  });
});

describe('theatreFit', () => {
  const HD = { width: 1920, height: 1080 };

  it('fills a desktop hero with a landscape film', () => {
    expect(theatreFit({ width: 1440, height: 900 }, HD)).toBe('cover');
  });

  it('plays a landscape film whole on an upright phone: filling would crop three quarters', () => {
    expect(theatreFit({ width: 390, height: 844 }, HD)).toBe('contain');
  });

  it("fills an upright phone with an upright film, and fills when a size isn't known yet", () => {
    expect(
      theatreFit({ width: 390, height: 844 }, { width: 1080, height: 1920 })
    ).toBe('cover');
    expect(theatreFit({ width: 0, height: 0 }, HD)).toBe('cover');
    expect(
      theatreFit({ width: 390, height: 844 }, { width: 0, height: 0 })
    ).toBe('cover');
  });

  it('holds the line at 40% cropped', () => {
    // A 4:3 box shows 0.75 of a 16:9 film's width: 25% cropped, it fills.
    expect(theatreFit({ width: 1200, height: 900 }, HD)).toBe('cover');
    // A square box shows 0.5625 of it: 44% cropped, it plays whole.
    expect(theatreFit({ width: 900, height: 900 }, HD)).toBe('contain');
  });
});

describe('barLevels', () => {
  const bins = (fill: (bin: number) => number) =>
    Uint8Array.from({ length: 128 }, (_, bin) => fill(bin));

  it('rests at zero in silence, one level per bar', () => {
    for (const count of [WAVE_BARS.desk, WAVE_BARS.phone, 7]) {
      const levels = barLevels(
        bins(() => 0),
        count
      );
      expect(levels).toHaveLength(count);
      expect(levels.every((level) => level === 0)).toBe(true);
    }
  });

  it('mirrors about the middle, the lowest band at the centre', () => {
    // A low drone: loud in the first bins, quiet above.
    const levels = barLevels(
      bins((bin) => Math.max(0, 255 - bin * 6)),
      9
    );
    expect(levels).toEqual([...levels].reverse());
    expect(Math.max(...levels)).toBe(levels[4]);
    expect(levels[0]).toBeLessThan(levels[4] ?? 0);
  });

  it('never reads above full, and ignores the offset bin', () => {
    const loud = barLevels(
      bins((bin) => (bin === 0 ? 255 : 255)),
      30
    );
    expect(loud.every((level) => level <= 1 && level > 0.99)).toBe(true);
    const offsetOnly = barLevels(
      bins((bin) => (bin === 0 ? 255 : 0)),
      30
    );
    expect(offsetOnly.every((level) => level === 0)).toBe(true);
  });
});

describe('canTap', () => {
  const media = (currentSrc: string) =>
    ({ currentSrc, srcObject: null }) as unknown as HTMLMediaElement;
  const context = (state: AudioContextState) => ({ state }) as BaseAudioContext;

  it("taps hls.js's same-origin stream while the press's context runs", () => {
    expect(
      canTap(
        media('blob:http://of-blood-and-bones.lvh.me:3000/1f2e'),
        context('running')
      )
    ).toBe(true);
  });

  it('never taps a manifest the page may not read: the sound would go silent', () => {
    expect(canTap(media(PREVIEW), context('running'))).toBe(false);
    expect(canTap(media(''), context('running'))).toBe(false);
  });

  it('never taps through a context that is not running: it would hold the sound back', () => {
    expect(canTap(media('blob:http://x/1'), context('suspended'))).toBe(false);
    expect(canTap(media('blob:http://x/1'), context('closed'))).toBe(false);
  });
});

/**
 * The guard the theatre's sound depends on (owner-approved, 2026-11-20): a
 * MediaElementAudioSource takes the element's sound, so building one on a
 * stream the page may not read (no CORS) mutes the preview outright, and
 * nothing else would catch it. The analyser is built ONLY on hls.js's
 * same-origin MediaSource stream, and only through a running context.
 */
describe('tapWaveform: the graph is built only on a readable stream through a running context', () => {
  class Graph {
    readonly destination = {};
    readonly built = { sources: 0, analysers: 0 };
    constructor(readonly state: AudioContextState) {}
    createMediaElementSource() {
      this.built.sources += 1;
      return { connect: () => {}, disconnect: () => {} };
    }
    createAnalyser() {
      this.built.analysers += 1;
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        frequencyBinCount: 128,
        getByteFrequencyData: () => {},
        connect: () => {},
        disconnect: () => {},
      };
    }
  }
  const element = (currentSrc: string, srcObject: unknown = null) =>
    ({ currentSrc, srcObject }) as unknown as HTMLMediaElement;
  const tap = (media: HTMLMediaElement, state: AudioContextState) => {
    const graph = new Graph(state);
    return {
      made: tapWaveform(media, graph as unknown as AudioContext),
      graph,
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds nothing for a stream the page may not read, or through a context that is not running', () => {
    const refused: [string, AudioContextState][] = [
      [PREVIEW, 'running'],
      ['', 'running'],
      ['https://cdn.example.com/a/preview.m3u8', 'running'],
      ['blob:http://of-blood-and-bones.lvh.me:3000/1f2e', 'suspended'],
      ['blob:http://of-blood-and-bones.lvh.me:3000/1f2e', 'closed'],
      [PREVIEW, 'suspended'],
    ];
    for (const [src, state] of refused) {
      const { made, graph } = tap(element(src), state);
      expect(made, `${src} / ${state}`).toBeNull();
      expect(graph.built, `${src} / ${state}`).toEqual({
        sources: 0,
        analysers: 0,
      });
    }
  });

  it("builds the source and the analyser on hls.js's blob: stream while the context runs", () => {
    const { made, graph } = tap(
      element('blob:http://of-blood-and-bones.lvh.me:3000/1f2e'),
      'running'
    );
    expect(made).not.toBeNull();
    expect(graph.built).toEqual({ sources: 1, analysers: 1 });
  });

  it('takes a MediaSource attached as the source object, and nothing else attached there', () => {
    class FakeMediaSource {}
    vi.stubGlobal('MediaSource', FakeMediaSource);
    expect(
      tap(element('', new FakeMediaSource()), 'running').graph.built.sources
    ).toBe(1);
    // A camera's stream, a Blob: a source object that is no MediaSource.
    expect(
      tap(element('', { getTracks: () => [] }), 'running').graph.built.sources
    ).toBe(0);
    expect(
      tap(element('', new FakeMediaSource()), 'suspended').graph.built.sources
    ).toBe(0);
  });
});
