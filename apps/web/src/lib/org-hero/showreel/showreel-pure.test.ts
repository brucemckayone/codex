/**
 * The Showreel's pure rules (Codex-1yd58.6): how it plays for a visitor, its
 * clock, its words, its media, the name and title sizes, and the contrast
 * floor's arithmetic.
 */

import type { IntroFilm } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import { bindingLuminance } from '$lib/brand-editor/ground';
import { TEXT_ON_BRAND_LUMINANCE_PIVOT } from '$lib/brand-editor/ink';
import type { OrgHeroPiece } from '../hero-config';
import type { ReelEntry } from '../reel';
import { fitTitle, nameInRoom, nameLines } from './name-lines';
import { prefersSavingData, reelMode } from './playback';
import { PIECE_MS, ReelClock, reelKey, reelKeys } from './reel-clock.svelte';
import { reelMedia } from './reel-media';
import {
  contrast,
  FIRST_PAINT,
  FLOOR_MARGIN,
  FOCUS_RATIO,
  FOOT_SHADE,
  focusInk,
  GLOW_SHARE,
  glowLeaves,
  groundPoles,
  growShades,
  HEADER_SHADE,
  halfSpan,
  haloAlpha,
  type Ink,
  inkPole,
  liftedNodes,
  liftInk,
  liftStep,
  MAX_SCRIM_ALPHA,
  outlineAlpha,
  over,
  ownPole,
  RAMP,
  type Rgb,
  RING_MARGIN,
  RING_TAKE_UP,
  rampAt,
  readsAsTwo,
  ringCarries,
  ringHalo,
  SHADE_PEAK_MAX,
  SHADE_REACH_MAX,
  SHADES,
  SHADES_CAP,
  type Shade,
  type Span,
  scrimAlpha,
  scrimTint,
  secondCarrier,
  shadeAt,
  shadeFloor,
  shadeProps,
  wordRoom,
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

  it('sets the name in its room as nameLines does when the room holds it (the owner floor, 2026-11-22)', () => {
    expect(
      nameInRoom('Of Blood & Bones', measure, 1000, 196, 1000, 72)
    ).toEqual({
      ...nameLines('Of Blood & Bones', measure, 1000, 196),
      grows: false,
    });
  });

  it('shrinks the name to its room, in whichever break sets it largest there', () => {
    // Two lines while two lines fit the room larger...
    expect(nameInRoom('Of Blood & Bones', measure, 1000, 196, 300, 72)).toEqual(
      {
        lines: ['Of Blood', '& Bones'],
        size: 150,
        grows: false,
      }
    );
    // ...then one line, as the room gets shorter.
    expect(nameInRoom('Of Blood & Bones', measure, 1000, 196, 200, 72)).toEqual(
      {
        lines: ['Of Blood & Bones'],
        size: 125,
        grows: false,
      }
    );
    expect(nameInRoom('Of Blood & Bones', measure, 1000, 196, 100, 72)).toEqual(
      {
        lines: ['Of Blood & Bones'],
        size: 100,
        grows: false,
      }
    );
  });

  it('never sets the name under the floor: it keeps the floor in its fewest lines across, and the hero grows', () => {
    expect(nameInRoom('Of Blood & Bones', measure, 1000, 196, 60, 72)).toEqual({
      lines: ['Of Blood & Bones'],
      size: 72,
      grows: true,
    });
    // One line is too wide at the floor here: two lines.
    expect(nameInRoom('Of Blood & Bones', measure, 500, 196, 60, 72)).toEqual({
      lines: ['Of Blood', '& Bones'],
      size: 72,
      grows: true,
    });
    // No break fits across at the floor: to the width, under it.
    expect(nameInRoom('Of Blood & Bones', measure, 200, 196, 60, 72)).toEqual({
      lines: ['Of Blood', '& Bones'],
      size: 50,
      grows: true,
    });
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
    // The page's own switch (org-brand.css's `--_gw`, which Showreel's
    // `--_light` turns round): light AT the pivot, where `bindingLuminance`
    // holds a light page whose darkest surface is mid grey (review R2).
    expect(groundPoles(TEXT_ON_BRAND_LUMINANCE_PIVOT).veil).toEqual(WHITE_VEIL);
    expect(groundPoles(TEXT_ON_BRAND_LUMINANCE_PIVOT - 0.0001).veil).toEqual(
      BLACK_VEIL
    );
  });

  it('solves a light page at the pivot for the black its light text is lifted to: room left for it (review R2)', () => {
    // A grey 120 page: held light AT the pivot, its text light (the page's
    // text turns at OKLCH l 0.6). No pale veil carries that text, and black
    // has almost no room on the grey itself: 4.76:1 solid.
    const grey: Rgb = [120, 120, 120];
    const text: Ink = { rgb: [222, 222, 222], alpha: 1 };
    const { veil, ink } = groundPoles(TEXT_ON_BRAND_LUMINANCE_PIVOT);
    expect(veil).toEqual(WHITE_VEIL);
    expect(ink).toEqual([0, 0, 0]);
    const inks = [{ ink: text, ratio: 4.5 }];
    expect(scrimAlpha(inks, veil)).toBeNull();
    const black = [{ ink: { rgb: ink, alpha: 1 }, ratio: 4.5 }];
    // On the mid grey itself, black needs more than any scrim may lay.
    expect(scrimAlpha(black, grey) ?? 1).toBeGreaterThan(MAX_SCRIM_ALPHA);
    // Solved as the black it becomes: a paler grey, where black is carried.
    const tint = scrimTint(grey, veil, inks, ink);
    expect(tint[0]).toBeGreaterThan(120);
    expect(scrimAlpha(black, tint) ?? 1).toBeLessThanOrEqual(MAX_SCRIM_ALPHA);
  });

  // OBB's words at 1440, by their glyphs: the kicker in the middle band, where
  // only the foot's left shade reaches, and an index row at the right.
  const KICKER = { left: 0.094, top: 0.329, right: 0.208, bottom: 0.349 };
  const ROW = { left: 0.677, top: 0.391, right: 0.943, bottom: 0.418 };
  // Those two, a corner word, and the header's facts line.
  const SPANS = [
    KICKER,
    ROW,
    { left: 0.02, top: 0.9, right: 0.2, bottom: 0.95 },
    { left: 0.6, top: 0.04, right: 0.88, bottom: 0.07 },
  ];
  const soft = (rgb: Rgb): Ink => ({ rgb, alpha: 0.8 });

  it("holds a mid grey to each word's room in Shadow: its film label no longer short mid-reel (review r3 n1)", () => {
    const grey: Rgb = [100, 100, 100];
    const kicker = { ink: soft([255, 255, 255]), ratio: 4.5 };
    const capped = scrimTint(grey, BLACK_VEIL, [kicker], WHITE_VEIL);
    const left = (tint: Rgb) =>
      glowLeaves(
        scrimAlpha([kicker], tint) ?? 1,
        scrimAlpha([kicker], tint) ?? 1
      );
    // To the cap alone: a need the shades cannot lay there.
    expect(left(capped)).toBeGreaterThan(shadeFloor(KICKER, SHADES_CAP));
    const room = wordRoom('shadow', KICKER);
    const roomy = scrimTint(
      grey,
      BLACK_VEIL,
      [{ ...kicker, room }],
      WHITE_VEIL
    );
    // Carried by what the fit DRAWS for it (review r4 M1): its carrier grown,
    // the rest as drawn, never every ellipse at its cap at once.
    const drawn = growShades([{ span: KICKER, need: left(roomy) }]);
    expect(drawn.short).toEqual([]);
    expect(shadeFloor(KICKER, drawn.shades)).toBeGreaterThanOrEqual(
      left(roomy)
    );
    // A deeper shade of the same grey, never the pole.
    expect(roomy[0]).toBeLessThan(capped[0]);
    expect(roomy[0]).toBeGreaterThan(0);
    expect(roomy[1]).toBe(roomy[0]);
  });

  it('keeps every Outline ring short of solid on a mid grey (review r3 n3)', () => {
    const grey: Rgb = [100, 100, 100];
    const row = { ink: { rgb: [255, 255, 255] as Rgb, alpha: 1 }, ratio: 4.5 };
    const ring = (tint: Rgb) =>
      haloAlpha(scrimAlpha([row], tint) ?? 1, shadeFloor(ROW, SHADES)) *
      RING_TAKE_UP;
    expect(
      ring(scrimTint(grey, BLACK_VEIL, [row], WHITE_VEIL))
    ).toBeGreaterThan(1);
    const room = wordRoom('outline', ROW);
    expect(
      ring(scrimTint(grey, BLACK_VEIL, [{ ...row, room }], WHITE_VEIL))
    ).toBeLessThanOrEqual(1);
  });

  it("leaves OBB's ground as it is with every word held to its room (owner, 2026-11-21)", () => {
    const words = [
      {
        ink: soft([255, 255, 255]),
        ratio: 4.5,
        room: wordRoom('shadow', KICKER),
      },
      {
        ink: { rgb: [255, 255, 255] as Rgb, alpha: 1 },
        ratio: 4.5,
        room: wordRoom('shadow', ROW),
      },
    ];
    expect(scrimTint(OBB, BLACK_VEIL, words, WHITE_VEIL)).toEqual(OBB);
  });

  it('is carried by the shades growShades grows for it, when it needs no more than its room (review r4 M1)', () => {
    const room = wordRoom('shadow', KICKER);
    expect(room).toBeGreaterThan(0);
    // What the shades must lay under it, its own glow counted at the least it
    // lays, as wordRoom counts it.
    const left = glowLeaves(room, room);
    const { shades, short } = growShades([{ span: KICKER, need: left }]);
    // Before: about 0.645 laid against 0.71 needed (the room counted all four
    // ellipses at their cap; the growth raises only the one that carries it).
    expect(shadeFloor(KICKER, shades)).toBeGreaterThanOrEqual(left);
    expect(short).toEqual([]);
  });

  it('is exactly what its carrier alone can lay at its glyphs: one hundredth more is not carried (review r4 M1)', () => {
    // The carrier at its cap (peak SHADE_PEAK_MAX, twice its reach), the other
    // three ellipses as drawn: the most the fit grows for this word alone.
    for (const span of SPANS) {
      const room = wordRoom('shadow', span);
      const more = Math.round((room + 0.01) * 100) / 100;
      expect(
        growShades([{ span, need: glowLeaves(more, more) }]).short
      ).toHaveLength(1);
    }
  });

  it("a word's room never rises above its all-caps room (review r4 M1)", () => {
    const allCaps = (span: typeof KICKER) => {
      let room = 0;
      for (let step = 1; step <= 100; step++) {
        const need = step / 100;
        if (glowLeaves(need, need) > shadeFloor(span, SHADES_CAP)) break;
        room = need;
      }
      return room;
    };
    for (const span of SPANS) {
      const alone = growShades([{ span, need: SHADE_PEAK_MAX }]).shades;
      expect(shadeFloor(span, alone)).toBeLessThanOrEqual(
        shadeFloor(span, SHADES_CAP) + 1e-9
      );
      expect(wordRoom('shadow', span)).toBeLessThanOrEqual(allCaps(span));
    }
  });

  it('gives a word more room where the shades lay more: the corner over the middle band', () => {
    const corner = { left: 0.02, top: 0.9, right: 0.2, bottom: 0.95 };
    expect(wordRoom('shadow', corner)).toBeGreaterThan(
      wordRoom('shadow', KICKER)
    );
    expect(wordRoom('shadow', KICKER)).toBeGreaterThan(0);
    expect(wordRoom('outline', KICKER)).toBeGreaterThan(0);
  });

  it('reads a grey-120 or grey-135 light page as light, as the page does (review R2)', () => {
    // Each a light page whose darkest surface is mid grey: bound at the pivot.
    const lum = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    for (const v of [120, 135]) {
      const page = lum(v);
      expect(page).toBeGreaterThan(TEXT_ON_BRAND_LUMINANCE_PIVOT);
      const gy = bindingLuminance(page, [lum(v - 18)]);
      expect(gy).toBe(TEXT_ON_BRAND_LUMINANCE_PIVOT);
      expect(groundPoles(gy)).toEqual({ veil: WHITE_VEIL, ink: BLACK_VEIL });
    }
    // A dark page binds below it, and stays dark.
    const dark = bindingLuminance(lum(100), [lum(110)]);
    expect(groundPoles(dark).veil).toEqual(BLACK_VEIL);
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
    // Read from the ground, it is the brand's own dark, exactly: solved as
    // the white each is lifted toward, which that dark already carries.
    expect(scrimTint(OBB, veil, reds, ink)).toEqual(OBB);
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
    expect(scrimTint(cream, veil, INKS, ink)).toEqual(cream);
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
    expect(scrimTint(OBB, BLACK_VEIL, INKS, WHITE_VEIL)).toEqual(OBB);
  });

  it('moves a ground toward its veil only as far as the inks need: the lightest shade of it that carries them', () => {
    // The solver's own rule, on a ground that has far to go for white ink.
    const ocean: Rgb = [240, 249, 255];
    const tint = scrimTint(ocean, BLACK_VEIL, INKS, WHITE_VEIL);
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
    expect(scrimTint([255, 255, 255], BLACK_VEIL, grey, WHITE_VEIL)).toEqual([
      0, 0, 0,
    ]);
    // A grey only a white veil past the cap would carry.
    const greyish = [
      { ink: { rgb: [110, 110, 110], alpha: 1 } as Ink, ratio: 4.5 },
    ];
    expect(scrimTint([0, 0, 0], WHITE_VEIL, greyish, BLACK_VEIL)).toEqual([
      255, 255, 255,
    ]);
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
    expect(scrimTint(ocean, WHITE_VEIL, DARK_INKS, BLACK_VEIL)).toEqual(ocean);
    expect(scrimAlpha(DARK_INKS, ocean) ?? 1).toBeLessThanOrEqual(
      MAX_SCRIM_ALPHA
    );
  });

  it('pales a mid ground toward white for dark text, only as far as it needs', () => {
    const mid: Rgb = [150, 160, 170];
    const tint = scrimTint(mid, WHITE_VEIL, DARK_INKS, BLACK_VEIL);
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

describe('the nodes a short role lifts, each round (WP-5a review r4 LOW)', () => {
  type Node = { name: string; ink: Ink };
  const a: Node = { name: 'a', ink: { rgb: [203, 33, 60], alpha: 1 } };
  const b: Node = { name: 'b', ink: { rgb: [255, 255, 255], alpha: 0.8 } };
  const c: Node = { name: 'c', ink: { rgb: [255, 255, 255], alpha: 1 } };

  it('takes the nodes that fail now, and keeps every node already lifted', () => {
    // Round 1: only a fails.
    const first = liftedNodes([a, b, c], [], (ink) => ink === a.ink);
    expect(first).toEqual([a]);
    // Round 2: the group's glow fell as a's lift lowered its need, and b,
    // which passed at entry, is short now: it joins, a stays (never forced
    // straight to the pole at step 20 for want of a lift).
    const second = liftedNodes([a, b, c], first, (ink) => ink === b.ink);
    expect(second).toEqual([a, b]);
  });

  it('keeps the nodes in their order, and lifts none when none fail', () => {
    expect(liftedNodes([a, b, c], [], () => false)).toEqual([]);
    expect(liftedNodes([a, b, c], [c], (ink) => ink === a.ink)).toEqual([a, c]);
  });
});

describe("the 'outline' ring: a margin over the solved halo (review r4, OBB's index \"02\")", () => {
  it('draws the solved halo and RING_MARGIN more, in hundredths', () => {
    for (let need = 0.05; need <= 0.95; need += 0.05) {
      for (let under = 0; under < need; under += 0.07) {
        const halo = haloAlpha(need, under);
        if (halo === 0) continue;
        const ring = ringHalo(need, under);
        expect(ring).toBe(
          Math.min(1, Math.round((halo + RING_MARGIN) * 100) / 100)
        );
        expect(Math.round(ring * 100)).toBeCloseTo(ring * 100, 9);
      }
    }
  });

  it('draws no ring where the shades already carry the word, and never past solid', () => {
    expect(ringHalo(0.4, 0.4)).toBe(0);
    expect(ringHalo(0.4, 0.55)).toBe(0);
    expect(ringHalo(1, 0)).toBe(1);
    expect(ringHalo(0.99, 0)).toBe(1);
  });

  it("OBB's index: the group solved 0.59 (need 0.62 where its least shade lays 0.09), drawn 0.61", () => {
    const soft: Ink = { rgb: [255, 255, 255], alpha: 0.8 };
    const need = scrimAlpha([{ ink: soft, ratio: 4.5 }], [1, 0, 0]);
    expect(need).toBe(0.62);
    expect(haloAlpha(0.62, 0.09)).toBe(0.59);
    expect(ringHalo(0.62, 0.09)).toBe(0.61);
    // The margin is two hundredths: measured on the ring probe (white frame,
    // 1440 Corner), "02" read 4.47 at the solved halo, 4.54 at +0.01, and
    // 4.60 at +0.02, the least that clears 4.5 x FLOOR_MARGIN (4.59).
    expect(RING_MARGIN).toBe(0.02);
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

describe("the 'shadow' edge: a word its carrier leaves short takes a second, bounded (WP-5a)", () => {
  // OBB's phone, 390x844, as the fit drew it (the probe's dumps, 2026-11-22):
  // the header's left corner at its most, its right as drawn, and the foot as
  // the words below grew it.
  const header = (rx = 0.64, ry = 0.24): Shade => ({
    peak: SHADE_PEAK_MAX,
    corners: [
      { cx: 0.02, cy: -0.06, rx: 0.72, ry: 0.44 },
      { cx: 1, cy: -0.06, rx, ry },
    ],
  });
  const foot = (rx: number, ry: number): Shade => ({
    peak: SHADE_PEAK_MAX,
    corners: [
      { cx: 0, cy: 1.08, rx, ry },
      { cx: 1.02, cy: 1.08, rx: 0.6, ry: 0.82 },
    ],
  });
  // What the name's group needs of the shades on OBB (its glow, 0.55).
  const obb = glowLeaves(0.55, 0.55);
  // The right header corner at `k` times its drawn radii.
  const reach = (shade: Shade, k: number): Shade => ({
    peak: shade.peak,
    corners: shade.corners.map((corner, i) =>
      i === 1 ? { ...corner, rx: 0.64 * k, ry: 0.24 * k } : corner
    ),
  });

  it("reads the phone's header as two shadows as drawn, 83 px apart at 390, and as a band once its corners' halves meet", () => {
    const drawn = header();
    const [left, right] = drawn.corners.map((c) => halfSpan(c, drawn.peak));
    if (!left || !right)
      throw new Error('both corners lay half on the top edge');
    expect((right[0] - left[1]) * 390).toBeCloseTo(83.5, 0);
    expect(readsAsTwo(drawn)).toBe(true);
    // (a) on grey135 (the board, 2026-11-22): 115% x 43%, 42 px of overlap.
    expect(readsAsTwo(header(1.15, 0.43))).toBe(false);
  });

  it('takes none where the carrier already carries the word (the wrapped name, OBB peek on)', () => {
    const wrapped = { left: 0.152, top: 0.065, right: 0.408, bottom: 0.14 };
    const grown = [header(), foot(1.2792, 1.3448)];
    expect(shadeFloor(wrapped, grown)).toBeGreaterThanOrEqual(obb);
    const { shades, short } = secondCarrier(
      [{ span: wrapped, need: obb }],
      grown
    );
    expect(shades).toEqual(grown);
    expect(short).toEqual([]);
  });

  it('takes none for any word growShades already carries (a desktop header and kicker)', () => {
    const facts = { left: 0.6, top: 0.04, right: 0.88, bottom: 0.07 };
    const kicker = { left: 0.04, top: 0.62, right: 0.3, bottom: 0.66 };
    const needs = [
      { span: facts, need: 0.63 },
      { span: kicker, need: 0.7 },
    ];
    const grown = growShades(needs);
    expect(grown.short).toEqual([]);
    expect(secondCarrier(needs, grown.shades)).toEqual(grown);
  });

  it("grows the header's right corner the least that carries the wrapped name (OBB peek off, Wide)", () => {
    // The wrapped name's glyphs with the peek off (the reel 844 high),
    // measured on OBB at 390x844, Wide, 2026-11-22.
    const wrapped = { left: 0.152, top: 0.056, right: 0.408, bottom: 0.121 };
    const grown = [header(), foot(1.1544, 1.2136)];
    expect(shadeFloor(wrapped, grown)).toBeLessThan(obb);
    const { shades, short } = secondCarrier(
      [{ span: wrapped, need: obb }],
      grown
    );
    expect(short).toEqual([]);
    const [top, under] = shades;
    if (!top) throw new Error('the header shade');
    const k = (top.corners[1]?.rx ?? 0) / 0.64;
    expect(k).toBeCloseTo(1.24, 6);
    // The least: one step less leaves it short.
    expect(
      shadeFloor(wrapped, [reach(top, k - 0.04), foot(1.1544, 1.2136)])
    ).toBeLessThan(obb);
    expect(readsAsTwo(top)).toBe(true);
    // Only that corner moves: the left and the foot stay as drawn.
    expect(top.corners[0]).toEqual(grown[0]?.corners[0]);
    expect(under).toEqual(grown[1]);
  });

  it('stops a step before the header would read as a band, and leaves the word short', () => {
    // One line at the greys' need, with the foot as drawn (no help from it).
    const word = {
      span: { left: 0.152, top: 0.069, right: 0.658, bottom: 0.106 },
      need: glowLeaves(0.69, 0.69),
    };
    const { shades, short } = secondCarrier(
      [word],
      [header(), foot(0.78, 0.82)]
    );
    expect(short).toEqual([word]);
    const [top] = shades;
    if (!top) throw new Error('the header shade');
    expect(readsAsTwo(top)).toBe(true);
    const k = (top.corners[1]?.rx ?? 0) / 0.64;
    expect(k).toBeGreaterThan(1);
    expect(readsAsTwo(reach(top, k + 0.04))).toBe(false);
  });

  it('takes none from a shade that already reads as one: the foot, as the words grew it', () => {
    const grown = [header(), foot(1.2792, 1.3448)];
    const [, under] = grown;
    if (!under) throw new Error('the foot shade');
    expect(readsAsTwo(under)).toBe(false);
    // A word at the foot's right the words' corner leaves short.
    const word = {
      span: { left: 0.55, top: 0.8, right: 0.95, bottom: 0.86 },
      need: 0.93,
    };
    expect(shadeFloor(word.span, grown)).toBeLessThan(word.need);
    const { shades, short } = secondCarrier([word], grown);
    expect(shades).toEqual(grown);
    expect(short).toEqual([word]);
  });

  // wp4-review r6 L2, pinned: the second carrier is not gated on a phone. On
  // a 1440 desktop, a name long enough that its one carrier at its cap leaves
  // it short (40 letters or more at OBB's need) takes the bounded second
  // carrier too: carried, never a band (S3 as restated, 2026-11-22). OBB's
  // own 16 letters are carried by the one, and nothing moves.
  it("carries a desktop name its one carrier leaves short, never as a band; OBB's 16 letters are byte-unchanged (wp4-review r6 L2)", () => {
    // The name's glyphs at 1440, the review's estimate from the CSS: after
    // the 96 px gutter, a 40 px logo and its 12 px gap, about 11 px a letter,
    // in a bar at y 0.03-0.07.
    const deskName = (letters: number) => ({
      left: 0.103,
      top: 0.03,
      right: 0.103 + (letters * 11) / 1440,
      bottom: 0.07,
    });
    const long = [{ span: deskName(48), need: obb }];
    const grown = growShades(long);
    // The one carrier at its cap leaves it short.
    expect(grown.short).toHaveLength(1);
    const second = secondCarrier(long, grown.shades);
    expect(second.short).toEqual([]);
    const [top] = second.shades;
    if (!top) throw new Error('the header shade');
    expect(top).not.toEqual(grown.shades[0]);
    expect(readsAsTwo(top)).toBe(true);
    // OBB's own name: carried by the one, so the second takes nothing.
    const own = [{ span: deskName(16), need: obb }];
    const drawn = growShades(own);
    expect(drawn.short).toEqual([]);
    expect(secondCarrier(own, drawn.shades)).toEqual(drawn);
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
    const { veil, ink: pole } = groundPoles(0.00097);
    expect(scrimAlpha([redInk], [0, 0, 0])).toBeNull();
    expect(scrimTint(tint, veil, [whiteInk, redInk], pole)).toEqual(tint);
    // The red alone stands further from white than from black, so a veil
    // read from the inks paled to white for it (until 2026-11-21). The
    // ground's dark holds instead, and the red is lifted to read on it.
    expect(ownPole([redInk])).toEqual(white);
    expect(scrimTint(tint, veil, [redInk], pole)).toEqual(tint);
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

  // The stylesheet's first-paint scrim, as CSS mixes it (oklab, `FIRST_PAINT`).
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const toOklab = (rgb: Rgb) => {
    const [r, g, b] = rgb.map(lin) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ] as const;
  };
  const fromOklab = ([L, A, B]: readonly number[]): Rgb => {
    const l =
      ((L ?? 0) + 0.3963377774 * (A ?? 0) + 0.2158037573 * (B ?? 0)) ** 3;
    const m =
      ((L ?? 0) - 0.1055613458 * (A ?? 0) - 0.0638541728 * (B ?? 0)) ** 3;
    const s =
      ((L ?? 0) - 0.0894841775 * (A ?? 0) - 1.291485548 * (B ?? 0)) ** 3;
    const out = (v: number) =>
      Math.max(
        0,
        Math.min(
          255,
          Math.round(
            (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255
          )
        )
      );
    return [
      out(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      out(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      out(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  };
  const mixToward = (pole: Rgb, share: number, ground: Rgb): Rgb => {
    const a = toOklab(pole);
    const g = toOklab(ground);
    return fromOklab(g.map((c, i) => c + ((a[i] ?? c) - c) * share));
  };
  const Y = ([r, g, b]: Rgb) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  /** The first paint before the fit: its scrim and the pole's ink, from the ground's side. */
  const firstPaint = (ground: Rgb) => {
    const { veil, ink } = groundPoles(Y(ground));
    const light = veil[0] === 255;
    const scrim = light
      ? mixToward([255, 255, 255], FIRST_PAINT.pale, ground)
      : mixToward([0, 0, 0], FIRST_PAINT.deepen, ground);
    return { scrim, ink };
  };
  // Every grey, and hues at every depth: the light side reaches down to the pivot.
  const grounds: Rgb[] = [];
  for (let v = 0; v <= 255; v++) grounds.push([v, v, v]);
  const hues: Rgb[] = [
    [255, 0, 0],
    [0, 160, 0],
    [0, 90, 255],
    [255, 200, 0],
    [200, 0, 200],
    [0, 200, 200],
    [240, 249, 255],
    [245, 240, 230],
  ];
  for (const hue of hues) {
    for (let k = 0.3; k <= 1.001; k += 0.02) {
      const [r, g, b] = hue;
      grounds.push([Math.round(r * k), Math.round(g * k), Math.round(b * k)]);
    }
  }
  // OBB's words at 1440, each with its floor.
  const words: readonly [
    string,
    { left: number; top: number; right: number; bottom: number },
    number,
  ][] = [
    ['name', { left: 0.03, top: 0.03, right: 0.3, bottom: 0.1 }, 4.5],
    ['facts', { left: 0.6, top: 0.04, right: 0.78, bottom: 0.07 }, 4.5],
    ['join', { left: 0.8, top: 0.03, right: 0.88, bottom: 0.08 }, 4.5],
    ['kicker', { left: 0.03, top: 0.5, right: 0.3, bottom: 0.53 }, 4.5],
    ['title', { left: 0.03, top: 0.55, right: 0.56, bottom: 0.7 }, 3],
    ['line', { left: 0.03, top: 0.72, right: 0.5, bottom: 0.8 }, 4.5],
    ['row', { left: 0.72, top: 0.4, right: 0.97, bottom: 0.43 }, 4.5],
    ['all', { left: 0.72, top: 0.86, right: 0.85, bottom: 0.89 }, 4.5],
  ];

  it("clears every word's floor WITH its margin before the fit, on every ground: a light one paled, a dark one deepened (review R5)", () => {
    let least = Number.POSITIVE_INFINITY;
    let at = '';
    for (const ground of grounds) {
      const { scrim, ink } = firstPaint(ground);
      for (const [name, span, ratio] of words) {
        // The cap's shades, with the glow at the first paint's pool.
        const cover =
          1 -
          (1 - shadeFloor(span, SHADES_CAP)) *
            (1 - GLOW_SHARE * FIRST_PAINT.pool);
        const margin =
          worstContrast({ rgb: ink, alpha: 1 }, scrim, cover) /
          (ratio * FLOOR_MARGIN);
        if (margin < least) {
          least = margin;
          at = `${name} on rgb(${ground.join(' ')})`;
        }
      }
    }
    expect(least, at).toBeGreaterThanOrEqual(1);
    // Unpaled, a light ground at the pivot fell short at the kicker.
    const pivotGrey: Rgb = [118, 118, 118];
    const [, kicker] = words[3] ?? [];
    if (!kicker) throw new Error('the kicker');
    const cover =
      1 -
      (1 - shadeFloor(kicker, SHADES_CAP)) *
        (1 - GLOW_SHARE * FIRST_PAINT.pool);
    expect(
      worstContrast({ rgb: [0, 0, 0], alpha: 1 }, pivotGrey, cover)
    ).toBeLessThan(4.5 * FLOOR_MARGIN);
  });

  it("rings focus in the pole's ink until the fit: 3:1 on every first paint, where a dark player text is not (review R3)", () => {
    for (const ground of grounds) {
      const { scrim, ink } = firstPaint(ground);
      expect(
        contrast(ink, scrim),
        `rgb(${ground.join(' ')})`
      ).toBeGreaterThanOrEqual(FOCUS_RATIO);
    }
    // A creator's dark player text on OBB's dark: the old ring, under 3:1.
    const { scrim } = firstPaint([15, 0, 0]);
    expect(contrast([139, 26, 43], scrim)).toBeLessThan(FOCUS_RATIO);
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

/**
 * The pin (WP-5a review r5, L1): no Outline room under what its word's ink
 * needs in its pole. A word whose room falls under that need has no tint
 * that carries it within the room, so the tint goes to the cap, and Outline's
 * check counts any solved need as met. At HEAD the kicker's and the index
 * row's rooms (0.62) EQUAL the soft ink's need in the black pole (0.62): no
 * slack. L1 as first written shrank those rooms by the ring's margin, and
 * grey 110's "02" read 4.48 on the ring probe.
 *
 * The spans: every fixture this file held, ten of them OBB's Corner at 1440
 * (its kicker and an index row by their glyphs, review r3; its eight words
 * by their boxes, the first paint's table, review R5) and two standing in for
 * a word in the foot's corner and the header's facts line; and every word's
 * box as Outline lays it (`MEASURED`, review r5), measured from local OBB on
 * every piece: Wide and Name at 1440 x 900, and all three layouts at
 * 390 x 844. The least headroom is Wide's kicker on piece 06: 0.62 for 0.62.
 */
describe("Outline's room never under its ink's need in the pole: the soft ink's knife edge (WP-5a review r5, L1)", () => {
  const ROLES: readonly [string, Span, 'ink' | 'soft', number][] = [
    [
      'kicker, by its glyphs',
      { left: 0.094, top: 0.329, right: 0.208, bottom: 0.349 },
      'soft',
      4.5,
    ],
    [
      'index row, by its glyphs',
      { left: 0.677, top: 0.391, right: 0.943, bottom: 0.418 },
      'soft',
      4.5,
    ],
    [
      'a word in the foot corner',
      { left: 0.02, top: 0.9, right: 0.2, bottom: 0.95 },
      'soft',
      4.5,
    ],
    [
      'the facts line',
      { left: 0.6, top: 0.04, right: 0.88, bottom: 0.07 },
      'soft',
      4.5,
    ],
    ['name', { left: 0.03, top: 0.03, right: 0.3, bottom: 0.1 }, 'ink', 4.5],
    ['facts', { left: 0.6, top: 0.04, right: 0.78, bottom: 0.07 }, 'soft', 4.5],
    ['join', { left: 0.8, top: 0.03, right: 0.88, bottom: 0.08 }, 'soft', 4.5],
    ['kicker', { left: 0.03, top: 0.5, right: 0.3, bottom: 0.53 }, 'soft', 4.5],
    ['title', { left: 0.03, top: 0.55, right: 0.56, bottom: 0.7 }, 'ink', 3],
    ['line', { left: 0.03, top: 0.72, right: 0.5, bottom: 0.8 }, 'soft', 4.5],
    ['row', { left: 0.72, top: 0.4, right: 0.97, bottom: 0.43 }, 'soft', 4.5],
    ['all', { left: 0.72, top: 0.86, right: 0.85, bottom: 0.89 }, 'ink', 4.5],
  ];
  /** Every word's box on local OBB, as fractions of the reel's (review r5). */
  const MEASURED: readonly [string, Span, 'ink' | 'soft', number][] = [
    [
      'Wide 1440, name (every piece)',
      { left: 0.0917, top: 0.045, right: 0.2584, bottom: 0.087 },
      'ink',
      4.5,
    ],
    [
      'Wide 1440, facts (every piece)',
      { left: 0.5991, top: 0.0503, right: 0.8629, bottom: 0.0817 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, kicker (01, 05)',
      { left: 0.0589, top: 0.5517, right: 0.9411, bottom: 0.5874 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, title (01, 05)',
      { left: 0.0589, top: 0.5874, right: 0.9411, bottom: 0.757 },
      'ink',
      3,
    ],
    [
      'Wide 1440, line (every piece)',
      { left: 0.0589, top: 0.779, right: 0.5709, bottom: 0.8768 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 01's number",
      { left: 0.0589, top: 0.924, right: 0.0706, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 01's title",
      { left: 0.0768, top: 0.9201, right: 0.1744, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 02's number",
      { left: 0.1867, top: 0.924, right: 0.2001, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 02's title",
      { left: 0.2063, top: 0.9201, right: 0.3022, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 03's number",
      { left: 0.3144, top: 0.924, right: 0.3279, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 03's title",
      { left: 0.3341, top: 0.9201, right: 0.43, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 04's number",
      { left: 0.4422, top: 0.924, right: 0.4554, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 04's title",
      { left: 0.4615, top: 0.9201, right: 0.5578, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 05's number",
      { left: 0.57, top: 0.924, right: 0.583, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 05's title",
      { left: 0.5891, top: 0.9201, right: 0.6855, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 06's number",
      { left: 0.6978, top: 0.9328, right: 0.7116, bottom: 0.9601 },
      'soft',
      4.5,
    ],
    [
      "Wide 1440, row 06's title",
      { left: 0.7177, top: 0.9289, right: 0.8133, bottom: 0.9604 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, kicker (02)',
      { left: 0.0589, top: 0.5841, right: 0.9411, bottom: 0.6197 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, title (02)',
      { left: 0.0589, top: 0.6197, right: 0.9411, bottom: 0.757 },
      'ink',
      3,
    ],
    [
      'Wide 1440, kicker (03)',
      { left: 0.0589, top: 0.5893, right: 0.9411, bottom: 0.6249 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, title (03)',
      { left: 0.0589, top: 0.6249, right: 0.9411, bottom: 0.757 },
      'ink',
      3,
    ],
    [
      'Wide 1440, kicker (04)',
      { left: 0.0589, top: 0.6152, right: 0.9411, bottom: 0.6508 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, title (04)',
      { left: 0.0589, top: 0.6508, right: 0.9411, bottom: 0.757 },
      'ink',
      3,
    ],
    [
      'Wide 1440, kicker (06)',
      { left: 0.0589, top: 0.5271, right: 0.9411, bottom: 0.5628 },
      'soft',
      4.5,
    ],
    [
      'Wide 1440, title (06)',
      { left: 0.0589, top: 0.5628, right: 0.9411, bottom: 0.757 },
      'ink',
      3,
    ],
    [
      'Name 1440, facts (every piece)',
      { left: 0.5991, top: 0.0503, right: 0.8629, bottom: 0.0817 },
      'soft',
      4.5,
    ],
    [
      'Name 1440, kicker (01)',
      { left: 0.0589, top: 0.6445, right: 0.9411, bottom: 0.6801 },
      'soft',
      4.5,
    ],
    [
      'Name 1440, title line (01)',
      { left: 0.0589, top: 0.6801, right: 0.7534, bottom: 0.7976 },
      'ink',
      4.5,
    ],
    [
      "Name 1440, row 01's number",
      { left: 0.0589, top: 0.924, right: 0.0706, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 01's title",
      { left: 0.0768, top: 0.9201, right: 0.1744, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 02's number",
      { left: 0.1867, top: 0.924, right: 0.2001, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 02's title",
      { left: 0.2063, top: 0.9201, right: 0.3022, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 03's number",
      { left: 0.3144, top: 0.924, right: 0.3279, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 03's title",
      { left: 0.3341, top: 0.9201, right: 0.43, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 04's number",
      { left: 0.4422, top: 0.924, right: 0.4554, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 04's title",
      { left: 0.4615, top: 0.9201, right: 0.5578, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 05's number",
      { left: 0.57, top: 0.924, right: 0.583, bottom: 0.9513 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 05's title",
      { left: 0.5891, top: 0.9201, right: 0.6855, bottom: 0.9516 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 06's number",
      { left: 0.6978, top: 0.9328, right: 0.7116, bottom: 0.9601 },
      'soft',
      4.5,
    ],
    [
      "Name 1440, row 06's title",
      { left: 0.7177, top: 0.9289, right: 0.8133, bottom: 0.9604 },
      'soft',
      4.5,
    ],
    [
      'Name 1440, kicker (02, 03, 04, 05, 06)',
      { left: 0.0589, top: 0.7004, right: 0.9411, bottom: 0.7361 },
      'soft',
      4.5,
    ],
    [
      'Name 1440, title (02, 03, 04, 05, 06)',
      { left: 0.0589, top: 0.7361, right: 0.9411, bottom: 0.7976 },
      'ink',
      3,
    ],
    [
      'Corner 390, name (every piece)',
      { left: 0.1516, top: 0.0693, right: 0.6578, bottom: 0.1072 },
      'ink',
      4.5,
    ],
    [
      'Corner 390, kicker (01, 05)',
      { left: 0.0349, top: 0.5159, right: 0.9651, bottom: 0.5521 },
      'soft',
      4.5,
    ],
    [
      'Corner 390, title (01, 05)',
      { left: 0.0349, top: 0.5521, right: 0.9651, bottom: 0.6689 },
      'ink',
      3,
    ],
    [
      'Corner 390, line (every piece)',
      { left: 0.0349, top: 0.6922, right: 0.9651, bottom: 0.8188 },
      'soft',
      4.5,
    ],
    [
      'Corner 390, kicker (02, 03, 04)',
      { left: 0.0349, top: 0.5315, right: 0.9651, bottom: 0.5677 },
      'soft',
      4.5,
    ],
    [
      'Corner 390, title (02, 03, 04)',
      { left: 0.0349, top: 0.5677, right: 0.9651, bottom: 0.6689 },
      'ink',
      3,
    ],
    [
      'Corner 390, kicker (06)',
      { left: 0.0349, top: 0.5743, right: 0.9651, bottom: 0.6105 },
      'soft',
      4.5,
    ],
    [
      'Corner 390, title (06)',
      { left: 0.0349, top: 0.6105, right: 0.9651, bottom: 0.6689 },
      'ink',
      3,
    ],
    [
      'Wide 390, name (every piece)',
      { left: 0.1516, top: 0.0693, right: 0.6578, bottom: 0.1072 },
      'ink',
      4.5,
    ],
    [
      'Wide 390, kicker (01, 05)',
      { left: 0.0349, top: 0.5514, right: 0.9651, bottom: 0.5876 },
      'soft',
      4.5,
    ],
    [
      'Wide 390, title (01, 05)',
      { left: 0.0349, top: 0.5876, right: 0.9651, bottom: 0.7344 },
      'ink',
      3,
    ],
    [
      'Wide 390, line (every piece)',
      { left: 0.0349, top: 0.7576, right: 0.9651, bottom: 0.842 },
      'soft',
      4.5,
    ],
    [
      'Wide 390, kicker (02, 03, 04)',
      { left: 0.0349, top: 0.478, right: 0.9651, bottom: 0.5142 },
      'soft',
      4.5,
    ],
    [
      'Wide 390, title (02, 03, 04)',
      { left: 0.0349, top: 0.5142, right: 0.9651, bottom: 0.7344 },
      'ink',
      3,
    ],
    [
      'Wide 390, kicker (06)',
      { left: 0.0349, top: 0.6248, right: 0.9651, bottom: 0.661 },
      'soft',
      4.5,
    ],
    [
      'Wide 390, title (06)',
      { left: 0.0349, top: 0.661, right: 0.9651, bottom: 0.7344 },
      'ink',
      3,
    ],
    [
      'Name 390, kicker (01)',
      { left: 0.0349, top: 0.6352, right: 0.9651, bottom: 0.6714 },
      'soft',
      4.5,
    ],
    [
      'Name 390, title line (01)',
      { left: 0.0349, top: 0.6714, right: 0.9651, bottom: 0.8142 },
      'ink',
      4.5,
    ],
    [
      'Name 390, kicker (02, 03, 05, 06)',
      { left: 0.0349, top: 0.739, right: 0.9651, bottom: 0.7752 },
      'soft',
      4.5,
    ],
    [
      'Name 390, title (02, 03, 05, 06)',
      { left: 0.0349, top: 0.7752, right: 0.9651, bottom: 0.8142 },
      'ink',
      3,
    ],
    [
      'Name 390, kicker (04)',
      { left: 0.0349, top: 0.7001, right: 0.9651, bottom: 0.7362 },
      'soft',
      4.5,
    ],
    [
      'Name 390, title (04)',
      { left: 0.0349, top: 0.7362, right: 0.9651, bottom: 0.8142 },
      'ink',
      3,
    ],
  ];
  /** A role's ink in its pole: the main ink solid, the soft one at 80%. */
  const needInPole = (groundY: number, kind: 'ink' | 'soft', ratio: number) => {
    const { veil, ink } = groundPoles(groundY);
    return scrimAlpha(
      [{ ink: { rgb: ink, alpha: kind === 'soft' ? 0.8 : 1 }, ratio }],
      veil
    );
  };

  it('holds every role at or above its ink in its pole, on a dark ground and a light one', () => {
    const short: string[] = [];
    // OBB's dark ground (a black veil) and the platform's light one (white).
    for (const groundY of [0.00097, 0.7835]) {
      for (const [role, span, kind, ratio] of [...ROLES, ...MEASURED]) {
        const need = needInPole(groundY, kind, ratio);
        const room = wordRoom('outline', span);
        if (need === null || room < need) {
          short.push(
            `${role} (${kind}, gy ${groundY}): room ${room}, need ${need}`
          );
        }
      }
    }
    expect(short).toEqual([]);
  });

  it("is what Outline's ring carries: at its room it carries the need, a hundredth over, it does not (review r5)", () => {
    for (const [role, span] of [...ROLES, ...MEASURED]) {
      const room = wordRoom('outline', span);
      const under = shadeFloor(span, SHADES);
      expect(ringCarries(room, under), role).toBe(true);
      expect(
        ringCarries(Math.round((room + 0.01) * 100) / 100, under),
        role
      ).toBe(false);
    }
  });
});
