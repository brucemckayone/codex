/**
 * The Showreel's pure rules (Codex-1yd58.6): how it plays for a visitor, its
 * clock, its words, its media, the name and title sizes, and the contrast
 * floor's arithmetic.
 */

import type { IntroFilm } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import type { OrgHeroPiece } from '../hero-config';
import type { ReelEntry } from '../reel';
import { fitTitle, nameLines } from './name-lines';
import { prefersSavingData, reelMode } from './playback';
import { PIECE_MS, ReelClock, reelKey, reelKeys } from './reel-clock.svelte';
import { reelMedia } from './reel-media';
import {
  contrast,
  FLOOR_MARGIN,
  FOCUS_RATIO,
  FOOT_SHADE,
  focusInk,
  GLOW_SHARE,
  glowLeaves,
  groundPoles,
  growShades,
  HEADER_SHADE,
  haloAlpha,
  type Ink,
  inkPole,
  liftInk,
  liftStep,
  MAX_SCRIM_ALPHA,
  outlineAlpha,
  over,
  ownPole,
  RAMP,
  type Rgb,
  rampAt,
  SHADE_PEAK_MAX,
  SHADE_REACH_MAX,
  SHADES,
  SHADES_CAP,
  scrimAlpha,
  scrimTint,
  shadeAt,
  shadeFloor,
  shadeProps,
  worstContrast,
} from './reel-scrim';
import { filmButtonLabel, reelWords } from './reel-words';

const FILM: IntroFilm = {
  title: 'Our film',
  posterUrl: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
  previewUrl: 'http://localhost:4100/org/hls/film/preview/index.m3u8',
  durationSeconds: 754,
  fullFilm: false,
};
const PIECE: OrgHeroPiece = {
  kind: 'portal',
  kicker: 'Featured portal',
  title: 'Ancestral Threads',
  meta: 'A portal in 3 stages, with 4 practices',
  line: 'Every body is an inheritance.',
  href: '/journeys/ancestral-threads',
  imageUrl: 'http://localhost:4100/org/media-thumbnails/threads/lg.webp',
  previewUrl: null,
  durationSeconds: null,
  cta: 'Enter the portal',
};
const film = (over: Partial<IntroFilm> = {}): ReelEntry => ({
  type: 'film',
  film: { ...FILM, ...over },
  show: 'footage',
});
const ORG = {
  name: 'Of Blood & Bones',
  description: 'Ancestral healing.',
  filmDuration: '12 min',
};

describe('reelMode', () => {
  it('plays footage by default, stills under Save-Data, and holds still for reduced motion or loop off', () => {
    expect(
      reelMode({ reducedMotion: false, saveData: false, loop: true })
    ).toBe('footage');
    // Save-Data keeps the reel moving: what it saves is data, not motion.
    expect(reelMode({ reducedMotion: false, saveData: true, loop: true })).toBe(
      'stills'
    );
    expect(reelMode({ reducedMotion: true, saveData: false, loop: true })).toBe(
      'static'
    );
    expect(
      reelMode({ reducedMotion: false, saveData: false, loop: false })
    ).toBe('static');
    expect(reelMode({ reducedMotion: true, saveData: true, loop: true })).toBe(
      'static'
    );
  });

  it('reads Save-Data from the hint or prefers-reduced-data, never the connection type', () => {
    const win = (saveData: boolean | undefined, reducedData: boolean) =>
      ({
        navigator: {
          connection:
            saveData === undefined
              ? undefined
              : { saveData, effectiveType: '2g' },
        },
        matchMedia: (q: string) => ({
          matches: reducedData && q.includes('reduced-data'),
        }),
      }) as unknown as Window;
    expect(prefersSavingData(win(true, false))).toBe(true);
    expect(prefersSavingData(win(false, true))).toBe(true);
    // A slow connection is no request to save data.
    expect(prefersSavingData(win(false, false))).toBe(false);
    expect(prefersSavingData(win(undefined, false))).toBe(false);
  });
});

describe('ReelClock', () => {
  it('moves on after a piece, wraps, and goes back', () => {
    const clock = new ReelClock(3, true);
    expect(clock.tick(PIECE_MS - 1)).toBe(false);
    expect(clock.progress).toBeCloseTo((PIECE_MS - 1) / PIECE_MS);
    expect(clock.tick(1)).toBe(true);
    expect(clock.index).toBe(1);
    expect(clock.progress).toBe(0);
    clock.go(2);
    clock.next();
    expect(clock.index).toBe(0);
    clock.back();
    expect(clock.index).toBe(2);
  });

  it('stops while paused, and while any hold lasts', () => {
    const clock = new ReelClock(3, true);
    clock.togglePause();
    expect(clock.tick(PIECE_MS)).toBe(false);
    clock.togglePause();

    clock.hold('pointer', true);
    clock.hold('focus', true);
    expect(clock.tick(PIECE_MS)).toBe(false);
    clock.hold('pointer', false);
    // Focus still holds it.
    expect(clock.tick(PIECE_MS)).toBe(false);
    clock.hold('focus', false);
    expect(clock.tick(PIECE_MS)).toBe(true);
  });

  it('never moves on by itself on the static path, but the visitor can still change piece', () => {
    const clock = new ReelClock(3, false);
    expect(clock.running).toBe(false);
    expect(clock.tick(PIECE_MS * 10)).toBe(false);
    expect(clock.index).toBe(0);
    clock.next();
    expect(clock.index).toBe(1);
  });

  it('starts and stops moving on with the same piece, pause and holds', () => {
    const clock = new ReelClock(3, true);
    clock.go(2);
    clock.hold('focus', true);
    clock.moves = false;
    clock.moves = true;
    expect(clock.index).toBe(2);
    expect(clock.holding('focus')).toBe(true);
    expect(clock.holding('press')).toBe(false);
  });

  it('counts each start of a piece, a pick of the one on show included', () => {
    const clock = new ReelClock(3, true);
    const starts = clock.starts;
    clock.go(1);
    clock.go(1);
    clock.tick(PIECE_MS);
    expect(clock.starts).toBe(starts + 3);
  });
});

describe('ReelClock.follow: the reel handed over anew', () => {
  const KEYS = ['film:a', 'piece:/content/b', 'piece:/content/c'];

  it('changes nothing for the same entries in a new array', () => {
    const clock = new ReelClock(3, true);
    clock.follow(KEYS);
    clock.go(1);
    clock.tick(PIECE_MS / 2);
    clock.togglePause();
    clock.hold('pointer', true);
    clock.follow([...KEYS]);
    expect(clock.index).toBe(1);
    expect(clock.progress).toBeCloseTo(0.5);
    expect(clock.paused).toBe(true);
    expect(clock.held).toBe(true);
  });

  it('keeps the piece on show where it now is, mid-piece, when the entries change', () => {
    const clock = new ReelClock(3, true);
    clock.follow(KEYS);
    clock.go(1);
    clock.tick(PIECE_MS / 2);
    clock.follow(['piece:/content/new', ...KEYS]);
    expect(clock.index).toBe(2);
    expect(clock.tick(PIECE_MS / 2)).toBe(true);
    expect(clock.index).toBe(3);
  });

  it('starts the piece now in its place when the one on show has gone, within the new count', () => {
    const clock = new ReelClock(3, true);
    clock.follow(KEYS);
    clock.go(2);
    clock.togglePause();
    clock.follow(KEYS.slice(0, 2));
    expect(clock.index).toBe(1);
    expect(clock.count).toBe(2);
    expect(clock.paused).toBe(true);
  });

  it('keys an entry by the piece itself, never by how it shows', () => {
    const entry: ReelEntry = {
      type: 'piece',
      piece: {
        kind: 'video',
        kicker: 'New film',
        title: 'Bone Deep',
        meta: 'A film',
        href: '/content/bone-deep',
        imageUrl: null,
        previewUrl: null,
        durationSeconds: null,
        cta: 'Watch',
      },
      show: 'footage',
    };
    expect(reelKey(entry)).toBe(reelKey({ ...entry, show: 'still' }));
    expect(reelKey({ type: 'film', film: FILM, show: 'footage' })).toBe(
      `film:${FILM.previewUrl}`
    );
  });
});

describe('reelWords', () => {
  it("words the film as the org's own: its name, its line, its length", () => {
    const words = reelWords(film(), 0, ORG);
    expect(words).toMatchObject({
      number: '01',
      kicker: 'Our film, 12 min',
      kind: 'Film',
      title: 'Of Blood & Bones',
      line: 'Ancestral healing.',
    });
  });

  it('labels the film button by what a press plays (Codex-0hkkt)', () => {
    expect(reelWords(film({ fullFilm: false }), 0, ORG).action).toEqual({
      kind: 'film',
      label: 'Play the preview',
    });
    expect(reelWords(film({ fullFilm: true }), 0, ORG).action).toEqual({
      kind: 'film',
      label: 'Watch our film, 12 min',
    });
    expect(filmButtonLabel(true, null)).toBe('Watch our film');
    expect(filmButtonLabel(false, '12 min')).toBe('Play the preview');
  });

  it('words a piece by what it is, and links its button', () => {
    const words = reelWords(
      { type: 'piece', piece: PIECE, show: 'still' },
      4,
      ORG
    );
    expect(words).toEqual({
      number: '05',
      kicker: 'A portal in 3 stages, with 4 practices',
      kind: 'Portal',
      title: 'Ancestral Threads',
      line: 'Every body is an inheritance.',
      action: {
        kind: 'link',
        label: 'Enter the portal',
        href: '/journeys/ancestral-threads',
      },
    });
  });
});

describe('reelMedia', () => {
  it('plays footage only on the footage path, and keeps the still under it', () => {
    expect(reelMedia(film(), 'footage')).toEqual({
      still: 'http://localhost:4100/org/media-thumbnails/film/lg.webp',
      footage: FILM.previewUrl,
    });
    expect(reelMedia(film(), 'stills').footage).toBeNull();
    expect(reelMedia(film(), 'static').footage).toBeNull();
    expect(
      reelMedia({ type: 'piece', piece: PIECE, show: 'still' }, 'footage')
    ).toEqual({
      still: PIECE.imageUrl,
      footage: null,
    });
  });
});

describe('nameLines and fitTitle', () => {
  // Each character 50 px wide at 100 px.
  const measure = (text: string) => text.length * 50;

  it('breaks the name where it sets largest, at most two lines', () => {
    expect(nameLines('Of Blood & Bones', measure, 1000, 400)).toEqual({
      lines: ['Of Blood', '& Bones'],
      size: 250,
    });
    expect(nameLines('Revelations', measure, 1000, 228)).toEqual({
      lines: ['Revelations'],
      size: 181,
    });
    // Never above the largest size.
    expect(nameLines('Om', measure, 1000, 228).size).toBe(228);
  });

  it("fits the Wide title to the width, within the mock's range", () => {
    expect(fitTitle(1000, 1232, 72, 150)).toBe(123);
    expect(fitTitle(4000, 1232, 72, 150)).toBe(72);
    expect(fitTitle(100, 1232, 72, 150)).toBe(150);
    expect(fitTitle(0, 1232, 72, 150)).toBe(150);
  });
});

describe('reel-scrim: contrast by construction', () => {
  const WHITE: Ink = { rgb: [255, 255, 255], alpha: 1 };
  const SOFT: Ink = { rgb: [255, 255, 255], alpha: 0.8 };
  const SCRIM = [41, 14, 18] as const;

  it("computes WCAG's ratio", () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1);
    expect(over([255, 255, 255], 0.5, [0, 0, 0])).toEqual([
      127.5, 127.5, 127.5,
    ]);
  });

  it('finds the least scrim under which the ink holds over ANY frame, white frames included', () => {
    const alpha = scrimAlpha([{ ink: WHITE, ratio: 4.5 }], SCRIM);
    expect(alpha).not.toBeNull();
    const a = alpha ?? 1;
    expect(worstContrast(WHITE, SCRIM, a)).toBeGreaterThanOrEqual(4.5);
    // The least: one step less falls under the floor and its margin.
    expect(worstContrast(WHITE, SCRIM, a - 0.01)).toBeLessThan(
      4.5 * FLOOR_MARGIN
    );
    expect(
      contrast([255, 255, 255], over(SCRIM, a, [255, 255, 255]))
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('takes the hardest ink: the translucent body ink needs more scrim than large white text', () => {
    const large = scrimAlpha([{ ink: WHITE, ratio: 3 }], SCRIM) ?? 1;
    const body = scrimAlpha([{ ink: SOFT, ratio: 4.5 }], SCRIM) ?? 1;
    const both = scrimAlpha(
      [
        { ink: WHITE, ratio: 3 },
        { ink: SOFT, ratio: 4.5 },
      ],
      SCRIM
    );
    expect(body).toBeGreaterThan(large);
    expect(both).toBe(body);
  });

  it('says so when even a solid scrim cannot carry the ink', () => {
    // Grey ink on a grey scrim: 1:1, whatever the frame.
    expect(
      scrimAlpha(
        [{ ink: { rgb: [128, 128, 128], alpha: 1 }, ratio: 4.5 }],
        [128, 128, 128]
      )
    ).toBeNull();
  });
});

describe("reel-scrim: the scrim in the brand's own ground", () => {
  const WHITE: Ink = { rgb: [255, 255, 255], alpha: 1 };
  const SOFT: Ink = { rgb: [255, 255, 255], alpha: 0.8 };
  const INKS = [
    { ink: WHITE, ratio: 4.5 },
    { ink: SOFT, ratio: 4.5 },
  ];
  const OBB: Rgb = [15, 0, 0];
  /** #0F0000's relative luminance: OBB's dark ground as `--_gy` carries it. */
  const OBB_Y = 0.00097;
  const BLACK_VEIL: Rgb = [0, 0, 0];
  const WHITE_VEIL: Rgb = [255, 255, 255];
  /** The most a scrim of `scrim` may cover the film to carry `ink` at 4.5:1. */
  const carriedOn = (scrim: Rgb) => (ink: Ink) =>
    (scrimAlpha([{ ink, ratio: 4.5 }], scrim) ?? 1) <= MAX_SCRIM_ALPHA;

  it('takes the veil from the ground alone: dark with white lifts on a dark brand, the mirror on a light one (owner, 2026-11-21)', () => {
    expect(groundPoles(OBB_Y)).toEqual({ veil: BLACK_VEIL, ink: WHITE_VEIL });
    // The platform's light ground (org-brand.css's fallback `--_gy`).
    expect(groundPoles(0.7835)).toEqual({ veil: WHITE_VEIL, ink: BLACK_VEIL });
    // Showreel's `--_light`, clamp(0, (gy - 0.1791) * 1e12, 1): light only
    // above the pivot, so the fit and the first paint never disagree.
    expect(groundPoles(0.1791).veil).toEqual(BLACK_VEIL);
    expect(groundPoles(0.1792).veil).toEqual(WHITE_VEIL);
  });

  it('keeps a dark veil when every ink is #CB213C on #0F0000, and lifts each toward white', () => {
    const red: Ink = { rgb: [203, 33, 60], alpha: 1 };
    const reds = [
      { ink: red, ratio: 4.5 },
      { ink: { ...red, alpha: 0.8 }, ratio: 4.5 },
    ];
    const { veil, ink } = groundPoles(OBB_Y);
    // Read from the inks, the veil would pale: the red stands further from
    // white than from black (5.49:1 against 3.82:1).
    expect(ownPole(reds)).toEqual(WHITE_VEIL);
    // Read from the ground, it is the brand's own dark, exactly.
    expect(scrimTint(OBB, veil, reds)).toEqual(OBB);
    // Each red is lifted toward white until that dark carries it.
    expect(ink).toEqual(WHITE_VEIL);
    for (const { ink: each } of reds) {
      expect(carriedOn(OBB)(each)).toBe(false);
      const lifted = liftInk(each, ink, carriedOn(OBB));
      if (lifted === null) throw new Error('white carries a red on the dark');
      expect(lifted.rgb).not.toEqual(each.rgb);
      for (const i of [0, 1, 2] as const) {
        expect(lifted.rgb[i]).toBeGreaterThanOrEqual(each.rgb[i]);
      }
      expect(carriedOn(OBB)(lifted)).toBe(true);
    }
  });

  it('keeps a pale veil when every ink is white on a light brand, and lifts each toward black', () => {
    const cream: Rgb = [245, 240, 230];
    const { veil, ink } = groundPoles(0.87);
    expect(ownPole(INKS)).toEqual(BLACK_VEIL);
    expect(scrimTint(cream, veil, INKS)).toEqual(cream);
    expect(ink).toEqual(BLACK_VEIL);
    const lifted = liftInk(WHITE, ink, carriedOn(cream));
    if (lifted === null) throw new Error('black carries a white on the pale');
    expect(lifted.rgb).not.toEqual(WHITE.rgb);
    for (const i of [0, 1, 2] as const) {
      expect(lifted.rgb[i]).toBeLessThanOrEqual(WHITE.rgb[i]);
    }
    expect(carriedOn(cream)(lifted)).toBe(true);
  });

  it("keeps a dark brand's ground exactly as it is under white ink, never black", () => {
    expect(scrimTint(OBB, BLACK_VEIL, INKS)).toEqual(OBB);
  });

  it('moves a ground toward its veil only as far as the inks need: the lightest shade of it that carries them', () => {
    // The solver's own rule, on a ground that has far to go for white ink.
    const ocean: Rgb = [240, 249, 255];
    const tint = scrimTint(ocean, BLACK_VEIL, INKS);
    // A shade of the ground: every channel scaled by one factor (its hue kept).
    const k = tint[2] / ocean[2];
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
    for (const i of [0, 1, 2] as const) {
      expect(tint[i]).toBeCloseTo(ocean[i] * k, 6);
    }
    expect(scrimAlpha(INKS, tint) ?? 1).toBeLessThanOrEqual(MAX_SCRIM_ALPHA);
    // The lightest: one step (5%) lighter cannot carry them within the cap.
    const lighter = over([0, 0, 0], 1 - k - 0.05, ocean);
    const alpha = scrimAlpha(INKS, lighter);
    expect(alpha === null || alpha > MAX_SCRIM_ALPHA).toBe(true);
  });

  it("is the veil's pole itself when nothing nearer will do, either way", () => {
    const grey = [
      { ink: { rgb: [128, 128, 128], alpha: 1 } as Ink, ratio: 4.5 },
    ];
    expect(scrimTint([255, 255, 255], BLACK_VEIL, grey)).toEqual([0, 0, 0]);
    // A grey only a white veil past the cap would carry.
    const greyish = [
      { ink: { rgb: [110, 110, 110], alpha: 1 } as Ink, ratio: 4.5 },
    ];
    expect(scrimTint([0, 0, 0], WHITE_VEIL, greyish)).toEqual([255, 255, 255]);
  });

  // A light brand's reel reads in its own light theme (owner, 2026-11-20):
  // its dark text, near-black and the 62% secondary, over its own ground.
  const TEXT: Ink = { rgb: [17, 17, 17], alpha: 1 };
  const TEXT_SOFT: Ink = { rgb: [88, 92, 95], alpha: 1 };
  const DARK_INKS = [
    { ink: TEXT, ratio: 4.5 },
    { ink: TEXT_SOFT, ratio: 4.5 },
  ];

  it("rings a word in the pole its own inks stand furthest from: the outline's, never the veil's", () => {
    expect(ownPole(INKS)).toEqual([0, 0, 0]);
    expect(ownPole(DARK_INKS)).toEqual([255, 255, 255]);
    // Mixed, the worst ink decides; none at all keeps the dark default.
    expect(ownPole([...DARK_INKS, { ink: SOFT, ratio: 4.5 }])).toEqual([
      0, 0, 0,
    ]);
    expect(ownPole([])).toEqual([0, 0, 0]);
  });

  it("keeps a light brand's ground exactly as its veil under its dark text, never grey", () => {
    const ocean: Rgb = [240, 249, 255];
    expect(scrimTint(ocean, WHITE_VEIL, DARK_INKS)).toEqual(ocean);
    expect(scrimAlpha(DARK_INKS, ocean) ?? 1).toBeLessThanOrEqual(
      MAX_SCRIM_ALPHA
    );
  });

  it('pales a mid ground toward white for dark text, only as far as it needs', () => {
    const mid: Rgb = [150, 160, 170];
    const tint = scrimTint(mid, WHITE_VEIL, DARK_INKS);
    // Paler, never darker, in every channel.
    for (const i of [0, 1, 2] as const) {
      expect(tint[i]).toBeGreaterThanOrEqual(mid[i]);
    }
    expect(tint).not.toEqual(mid);
    expect(scrimAlpha(DARK_INKS, tint) ?? 1).toBeLessThanOrEqual(
      MAX_SCRIM_ALPHA
    );
    // The least: one step (5%) nearer the ground cannot carry them.
    const t = (tint[0] - mid[0]) / (255 - mid[0]);
    const nearer = over([255, 255, 255], t - 0.05, mid);
    const alpha = scrimAlpha(DARK_INKS, nearer);
    expect(alpha === null || alpha > MAX_SCRIM_ALPHA).toBe(true);
  });
});

describe('reel-scrim: the focus ring over film', () => {
  const WHITE: Rgb = [255, 255, 255];
  const OBB: Rgb = [15, 0, 0];
  const pool =
    scrimAlpha([{ ink: { rgb: WHITE, alpha: 1 }, ratio: 4.5 }], OBB) ?? 1;
  const ring = (rgb: Rgb) => worstContrast({ rgb, alpha: 1 }, OBB, pool);

  it("keeps the brand's focus colour when it already holds 3:1 over any frame", () => {
    const pale: Rgb = [255, 214, 222];
    expect(ring(pale)).toBeGreaterThanOrEqual(FOCUS_RATIO);
    expect(focusInk(pale, WHITE, OBB, pool)).toEqual(pale);
  });

  it('mixes a brand red that fails over film toward the ink, only as far as 3:1 needs', () => {
    // WCAG 1.4.11's floor, the scrim's cap, and the page kit's 2% margin,
    // as the solver holds them.
    expect([FOCUS_RATIO, MAX_SCRIM_ALPHA, FLOOR_MARGIN]).toEqual([
      3, 0.9, 1.02,
    ]);
    // OBB's --color-focus as the page resolves it: 2.36:1 measured on the reel.
    const red: Rgb = [203, 33, 60];
    expect(ring(red)).toBeLessThan(FOCUS_RATIO);
    const solved = focusInk(red, WHITE, OBB, pool);
    expect(ring(solved)).toBeGreaterThanOrEqual(FOCUS_RATIO);
    // Still the brand's hue, not the ink: red leads green.
    expect(solved[0]).toBeGreaterThan(solved[1]);
    // The least mix: the step before it fails.
    const step = Math.round(((solved[1] - red[1]) / (WHITE[1] - red[1])) * 20);
    expect(solved).toEqual(over(WHITE, step / 20, red));
    expect(ring(over(WHITE, (step - 1) / 20, red))).toBeLessThan(
      FOCUS_RATIO * FLOOR_MARGIN
    );
  });

  it('mixes toward the pole when no mix toward the ink holds, and checks what it returns', () => {
    // A near-grey ring and a grey ink on a solid grey scrim: no mix of the
    // two reaches 3:1. The ink itself fails too, so it is never the answer
    // (it was, unchecked, until 2026-11-21): the ring turns toward the pole.
    const grey: Rgb = [128, 128, 128];
    const ring = focusInk([140, 140, 140], grey, grey, 1);
    expect(ring).not.toEqual(grey);
    expect(
      worstContrast({ rgb: ring, alpha: 1 }, grey, 1)
    ).toBeGreaterThanOrEqual(FOCUS_RATIO * FLOOR_MARGIN);
    // The creator's red as the reel's own ink, on a navy: no mix of red and
    // red holds there (2.54:1), and the pole does.
    const navy: Rgb = [30, 40, 90];
    const red: Rgb = [203, 33, 60];
    const solved = focusInk(red, red, navy, 1);
    expect(
      worstContrast({ rgb: solved, alpha: 1 }, navy, 1)
    ).toBeGreaterThanOrEqual(FOCUS_RATIO * FLOOR_MARGIN);
  });

  it("follows a light brand's dark ink: its blue mixed toward the text until 3:1 over any frame", () => {
    const ocean: Rgb = [240, 249, 255];
    const text: Rgb = [17, 17, 17];
    const soft: Rgb = [88, 92, 95];
    const veil =
      scrimAlpha(
        [
          { ink: { rgb: text, alpha: 1 }, ratio: 4.5 },
          { ink: { rgb: soft, alpha: 1 }, ratio: 4.5 },
        ],
        ocean
      ) ?? 1;
    const over_ = (rgb: Rgb) => worstContrast({ rgb, alpha: 1 }, ocean, veil);
    // Ocean's focus blue, as the page nudges it against its light ground.
    const blue: Rgb = [2, 132, 199];
    expect(over_(blue)).toBeLessThan(FOCUS_RATIO);
    const solved = focusInk(blue, text, ocean, veil);
    expect(over_(solved)).toBeGreaterThanOrEqual(FOCUS_RATIO);
    // Darker than the blue (toward the text), still blue: blue leads red.
    expect(solved[2]).toBeLessThan(blue[2]);
    expect(solved[2]).toBeGreaterThan(solved[0]);
  });
});

describe('reelKeys', () => {
  it('keys each entry by what it is, telling apart two with one href', () => {
    const a: ReelEntry = {
      type: 'piece',
      piece: { ...PIECE, href: '/content/a' },
      show: 'still',
    };
    const b: ReelEntry = { ...a, piece: { ...PIECE, href: '/content/b' } };
    expect(reelKeys([a, b, a, a])).toEqual([
      'piece:/content/a',
      'piece:/content/b',
      'piece:/content/a#2',
      'piece:/content/a#3',
    ]);
    expect(reelKeys([a, b])).toEqual([reelKey(a), reelKey(b)]);
  });

  it('never repeats a key, even when a real href looks like a counted one', () => {
    // '/x' twice, then a piece whose own href is '/x#2': counting alone would
    // key the second '/x' and the third piece both 'piece:/x#2'.
    const x: ReelEntry = {
      type: 'piece',
      piece: { ...PIECE, href: '/x' },
      show: 'still',
    };
    const x2: ReelEntry = { ...x, piece: { ...PIECE, href: '/x#2' } };
    for (const reel of [
      [x, x, x2],
      [x2, x, x],
      [x, x2, x, x, x2],
    ]) {
      const keys = reelKeys(reel);
      expect(new Set(keys).size).toBe(reel.length);
      // Each first entry for a piece keeps the piece's own key.
      expect(keys[reel.indexOf(x)]).toBe(reelKey(x));
      expect(keys[reel.indexOf(x2)]).toBe(reelKey(x2));
    }
  });
});

describe('the header: soft corners, and a halo for what its words still need', () => {
  it('the ramp is the eased curve ((1 + cos πt) / 2) ^ 0.6 to 0.8, then lands with no slope', () => {
    const curve = (t: number) => ((1 + Math.cos(Math.PI * t)) / 2) ** 0.6;
    for (const [t, f] of RAMP) {
      if (t <= 0.8) expect(f).toBeCloseTo(curve(t), 3);
    }
    expect(RAMP[0]).toEqual([0, 1]);
    expect(RAMP.at(-1)).toEqual([1, 0]);
    const slopes: number[] = [];
    for (const [i, [t, f]] of RAMP.entries()) {
      if (i === 0) continue;
      const [tBefore, fBefore] = RAMP[i - 1] ?? [0, 1];
      expect(t).toBeGreaterThan(tBefore);
      expect(f).toBeLessThan(fBefore);
      slopes.push((fBefore - f) / (t - tBefore));
    }
    // The tail eases out: each of its last segments falls slower than the one
    // before, and the last almost flat, so the ellipse ends with no kink.
    const tail = slopes.slice(-5);
    for (const [i, slope] of tail.entries()) {
      if (i > 0)
        expect(slope).toBeLessThan(tail[i - 1] ?? Number.POSITIVE_INFINITY);
    }
    expect(tail.at(-1)).toBeLessThan(0.15);
  });

  it('reads the ramp between its stops as CSS does, and clear past its edge', () => {
    expect(rampAt(-0.5)).toBe(1);
    expect(rampAt(0)).toBe(1);
    expect(rampAt(0.45)).toBeCloseTo((0.7754 + 0.6598) / 2, 6);
    expect(rampAt(0.9625)).toBeCloseTo((0.0249 + 0.0066) / 2, 6);
    expect(rampAt(1)).toBe(0);
    expect(rampAt(1.4)).toBe(0);
  });

  it('lays the shades at the corners only: the middle and the top of the film stay clear', () => {
    const [left] = HEADER_SHADE.corners;
    if (!left) throw new Error('a header corner');
    // Under one ellipse alone: its peak along the ramp.
    const x = left.cx;
    const y = left.cy + left.ry * 0.5;
    expect(
      shadeAt(x, y, [{ corners: [left], peak: HEADER_SHADE.peak }])
    ).toBeCloseTo(HEADER_SHADE.peak * rampAt(0.5), 9);
    // Together the shades composite: 1 − Π(1 − each ellipse's alpha).
    let clear = 1;
    for (const shade of [HEADER_SHADE, FOOT_SHADE]) {
      for (const c of shade.corners) {
        clear *=
          1 -
          shade.peak * rampAt(Math.hypot((x - c.cx) / c.rx, (y - c.cy) / c.ry));
      }
    }
    expect(shadeAt(x, y)).toBeCloseTo(1 - clear, 9);
    // The film's middle, and its top centre: clear.
    expect(shadeAt(0.5, 0.35)).toBe(0);
    expect(shadeAt(0.55, 0.12)).toBe(0);
    // Deepest behind the words and the index, off the foot's corners.
    expect(shadeAt(0.05, 0.95)).toBeGreaterThan(0.85);
    expect(shadeAt(0.95, 0.95)).toBeGreaterThan(0.85);
  });

  it("a box's floor is the least the shades lay anywhere over it", () => {
    const span = { left: 0.6, top: 0.03, right: 0.98, bottom: 0.07 };
    const floor = shadeFloor(span);
    expect(floor).toBeGreaterThan(0);
    for (const [px, py] of [
      [span.left, span.top],
      [span.left, span.bottom],
      [span.right, span.top],
      [span.right, span.bottom],
    ] as const) {
      expect(floor).toBeLessThanOrEqual(shadeAt(px, py));
    }
    expect(shadeFloor({ left: 0.4, top: 0.25, right: 0.6, bottom: 0.4 })).toBe(
      0
    );
  });

  it('the halo is the least, in hundredths, that brings a word to its need over the shades', () => {
    for (let need = 0.05; need <= 0.95; need += 0.05) {
      for (let under = 0; under < need; under += 0.07) {
        const halo = haloAlpha(need, under);
        const laid = (h: number) => 1 - (1 - under) * (1 - h);
        expect(laid(halo)).toBeGreaterThanOrEqual(need - 1e-9);
        // One hundredth less falls short: the least, not merely enough.
        expect(laid(halo - 0.01)).toBeLessThan(need);
      }
    }
    // The shades already do: no halo at all.
    expect(haloAlpha(0.4, 0.4)).toBe(0);
    expect(haloAlpha(0.4, 0.55)).toBe(0);
  });

  it("OBB's facts line: the 80% white ink needs 0.63 of its dark, and the halo makes up the shades' shortfall", () => {
    const tint: Rgb = [15, 0, 0];
    const facts: Ink = { rgb: [255, 255, 255], alpha: 0.8 };
    const need = scrimAlpha([{ ink: facts, ratio: 4.5 }], tint);
    expect(need).toBe(0.63);
    // Where the shades lay 0.3, the halo adds 1 − 0.37/0.7, up to a hundredth.
    expect(haloAlpha(0.63, 0.3)).toBe(0.48);
  });
});

describe("the 'shadow' edge: the shades grow as far as each word needs", () => {
  // OBB's facts line at 1440: the right of the header, far from its corner.
  const facts = { left: 0.6, top: 0.04, right: 0.88, bottom: 0.07 };

  it('leaves the shades as drawn when they already carry every word', () => {
    const near = { left: 0.02, top: 0.9, right: 0.1, bottom: 0.93 };
    const need = shadeFloor(near) - 0.01;
    const { shades, short } = growShades([{ span: near, need }]);
    expect(shades).toEqual(
      SHADES.map((s) => ({
        peak: s.peak,
        corners: s.corners.map((c) => ({ ...c })),
      }))
    );
    expect(short).toEqual([]);
  });

  it('raises the peak first, then the reach, until the word has its need, anchored where it was', () => {
    expect(shadeFloor(facts)).toBeLessThan(0.63);
    const { shades, short } = growShades([{ span: facts, need: 0.63 }]);
    expect(short).toEqual([]);
    expect(shadeFloor(facts, shades)).toBeGreaterThanOrEqual(0.63);
    const [header] = shades;
    if (!header) throw new Error('the header shade');
    expect(header.peak).toBe(SHADE_PEAK_MAX);
    for (const [i, corner] of header.corners.entries()) {
      const drawn = HEADER_SHADE.corners[i];
      if (!drawn) throw new Error('a drawn corner');
      // Anchored: the centre never moves, so it stays a radial with no edge.
      expect([corner.cx, corner.cy]).toEqual([drawn.cx, drawn.cy]);
      expect(corner.rx / drawn.rx).toBeCloseTo(corner.ry / drawn.ry, 9);
      expect(corner.rx / drawn.rx).toBeLessThanOrEqual(SHADE_REACH_MAX);
    }
    // The foot carries nothing here: it stays as drawn.
    expect(shades[1]).toEqual({
      peak: FOOT_SHADE.peak,
      corners: FOOT_SHADE.corners.map((c) => ({ ...c })),
    });
  });

  it('grows no shade for a word no shade can carry, and reports it', () => {
    const word = { span: facts, need: SHADE_PEAK_MAX + 0.01 };
    const { shades, short } = growShades([word]);
    expect(shades[0]?.peak).toBe(HEADER_SHADE.peak);
    expect(short).toEqual([word]);
  });
});

describe("the 'shadow' edge's soft glow, and a brand colour over footage", () => {
  // OBB: its own dark, its white ink, and its primary red (3.75:1 on that dark).
  const tint: Rgb = [15, 0, 0];
  const white: Rgb = [255, 255, 255];
  const red: Ink = { rgb: [203, 33, 60], alpha: 1 };
  // The frames 'over any frame' means: 18 greys, black to white, and 6 hues.
  const frames: Rgb[] = [
    ...Array.from({ length: 18 }, (_, i): Rgb => {
      const v = Math.min(255, i * 15);
      return [v, v, v];
    }),
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
  ];
  /** As the reel judges a word: some scrim of the tint carries it, and what its glow leaves the shades can lay. */
  const carried = (ratio: number) => (ink: Ink) => {
    const need = scrimAlpha([{ ink, ratio }], tint);
    return need !== null && glowLeaves(need, need) <= SHADE_PEAK_MAX;
  };

  it('the glow lays its measured share, and the shades lay the least of the rest', () => {
    // The 1 px ring probe's 5th percentile at full glow (0.255), rounded down.
    expect(GLOW_SHARE).toBe(0.25);
    for (let need = 0.05; need <= 0.95; need += 0.05) {
      for (let glow = 0; glow <= 1; glow += 0.1) {
        const left = glowLeaves(need, glow);
        const laid = (shade: number) =>
          1 - (1 - shade) * (1 - GLOW_SHARE * glow);
        expect(laid(left)).toBeGreaterThanOrEqual(need - 1e-9);
        // One hundredth less falls short: the least, not merely enough.
        if (left > 0) expect(laid(left - 0.01)).toBeLessThan(need);
      }
    }
    // No glow: the shades lay the whole need. OBB's facts line glowing at its
    // need of 0.63 leaves them 0.57 (0.561, in hundredths rounded up).
    expect(glowLeaves(0.63, 0)).toBe(0.63);
    expect(glowLeaves(0.63, 0.63)).toBe(0.57);
    // The glow alone does: no shade at all.
    expect(glowLeaves(0.2, 1)).toBe(0);
  });

  it("lifts OBB's red toward the reel's white just far enough, and leaves a colour that passes", () => {
    const body = carried(4.5);
    expect(body(red)).toBe(false);
    const step = liftStep(red, white, body);
    if (step === null) throw new Error('white carries the red');
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(20);
    const lifted = liftInk(red, white, body);
    if (lifted === null) throw new Error('a lift that passes');
    expect(lifted).toEqual({ rgb: over(white, step / 20, red.rgb), alpha: 1 });
    expect(body(lifted)).toBe(true);
    // The least: a twentieth nearer the red is still short.
    expect(body({ rgb: over(white, (step - 1) / 20, red.rgb), alpha: 1 })).toBe(
      false
    );
    // White passes as it is: no lift.
    expect(liftStep({ rgb: white, alpha: 1 }, white, body)).toBe(0);
    // Nothing passes, not even the pole: null, so a caller never takes an
    // unchecked last step (it took 20, unchecked, until 2026-11-21).
    expect(liftStep(red, white, () => false)).toBeNull();
    expect(liftInk(red, white, () => false)).toBeNull();
    // Toward itself (the creator's red as the reel's own ink): nothing.
    expect(liftStep(red, red.rgb, body)).toBeNull();
    // Only the pole itself passes: step 20, checked.
    const onlyWhite = (ink: Ink) => ink.rgb.every((c) => c > 254.5);
    expect(liftStep(red, white, onlyWhite)).toBe(20);
  });

  it('lifts toward the ink that stands furthest from the veil: white over a dark one, black over a light one', () => {
    expect(inkPole([15, 0, 0])).toEqual(white);
    expect(inkPole([30, 40, 90])).toEqual(white);
    expect(inkPole([240, 249, 255])).toEqual([0, 0, 0]);
    // The split falls where white and black stand equally far.
    expect(inkPole([118, 118, 118])).toEqual([0, 0, 0]);
    expect(inkPole([116, 116, 116])).toEqual(white);
  });

  it('outlines a colour in its own pole: the least pale ring that keeps it over any frame', () => {
    const pole = ownPole([{ ink: red, ratio: 4.5 }]);
    expect(pole).toEqual(white);
    const under = 0.3;
    const worst = (alpha: number) =>
      Math.min(
        ...frames.map((frame) => {
          const ground = over(pole, alpha, over(tint, under, frame));
          return contrast(red.rgb, ground);
        })
      );
    const alpha = outlineAlpha({ ink: red, ratio: 4.5 }, under, tint, pole);
    if (alpha === null) throw new Error('a pale ring carries the red');
    expect(worst(alpha)).toBeGreaterThanOrEqual(4.5 * FLOOR_MARGIN);
    expect(worst(alpha - 0.01)).toBeLessThan(4.5 * FLOOR_MARGIN);
    // A ring in the ink's own colour carries nothing: no ring will do.
    expect(
      outlineAlpha(
        { ink: { rgb: white, alpha: 1 }, ratio: 4.5 },
        0,
        tint,
        white
      )
    ).toBeNull();
  });

  it("tints from the inks a scrim can carry, and keeps the dark veil for OBB's red alone (owner, 2026-11-21)", () => {
    const whiteInk = { ink: { rgb: white, alpha: 1 }, ratio: 4.5 };
    const redInk = { ink: red, ratio: 4.5 };
    const { veil } = groundPoles(0.00097);
    expect(scrimAlpha([redInk], [0, 0, 0])).toBeNull();
    expect(scrimTint(tint, veil, [whiteInk, redInk])).toEqual(tint);
    // The red alone stands further from white than from black, so a veil
    // read from the inks paled to white for it (until 2026-11-21). The
    // ground's dark holds instead, and the red is lifted to read on it.
    expect(ownPole([redInk])).toEqual(white);
    expect(scrimTint(tint, veil, [redInk])).toEqual(tint);
  });
});

describe('the first paint, in both edges: the cap, until the fit runs', () => {
  it('is every shade at its peak cap and twice its reach, anchored where it was, as CSS draws it', () => {
    expect(shadeProps(SHADES_CAP)).toEqual({
      '--_peak-top': '0.94',
      '--_top-0': 'ellipse 72% 44% at 2% -6%',
      '--_top-1': 'ellipse 128% 48% at 100% -6%',
      '--_peak-foot': '0.94',
      '--_foot-0': 'ellipse 156% 164% at 0% 108%',
      '--_foot-1': 'ellipse 120% 164% at 102% 108%',
    });
    // As drawn: what 'outline' eases back to, and the stylesheet's fallbacks.
    expect(shadeProps(SHADES)).toEqual({
      '--_peak-top': '0.6',
      '--_top-0': 'ellipse 36% 22% at 2% -6%',
      '--_top-1': 'ellipse 64% 24% at 100% -6%',
      '--_peak-foot': '0.94',
      '--_foot-0': 'ellipse 78% 82% at 0% 108%',
      '--_foot-1': 'ellipse 60% 82% at 102% 108%',
    });
  });

  it('lays at least what any fit grows to, everywhere: every word passes before the fit runs', () => {
    // OBB's words at 1440: the name, the facts, the kicker and its lines, the index.
    const spans = [
      { left: 0.03, top: 0.03, right: 0.3, bottom: 0.1 },
      { left: 0.6, top: 0.04, right: 0.88, bottom: 0.07 },
      { left: 0.03, top: 0.48, right: 0.56, bottom: 0.9 },
      { left: 0.72, top: 0.3, right: 0.97, bottom: 0.92 },
    ];
    let least = Number.POSITIVE_INFINITY;
    for (const span of spans) {
      for (const need of [0.3, 0.6, 0.8, SHADE_PEAK_MAX]) {
        const { shades } = growShades([{ span, need }]);
        for (let x = 0; x <= 1; x += 0.05) {
          for (let y = 0; y <= 1; y += 0.05) {
            least = Math.min(
              least,
              shadeAt(x, y, SHADES_CAP) - shadeAt(x, y, shades)
            );
          }
        }
      }
    }
    expect(least).toBeGreaterThanOrEqual(-1e-12);
  });
});
