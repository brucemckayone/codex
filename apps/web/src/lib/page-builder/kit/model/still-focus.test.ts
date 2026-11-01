/**
 * A focal point on a course still (Codex-61zsk.73): it belongs to the still
 * it was set on, the centre is never stored, and each section that draws a
 * still says which one, and where its layouts cut it.
 */
import { describe, expect, it } from 'vitest';
import type { SellPreview } from '../../render/types';
import { DEFINITIONS } from './catalog';
import { PAGE_STYLE_IDS, SECTION_LAYOUTS, type SectionTypeId } from './ids';
import { sampleContext } from './sample';
import {
  placeStillFocus,
  readStillFocus,
  stillCrops,
  stillFocusFor,
  stillKey,
} from './still-focus';

const STILL = 'https://cdn.example/org-1/media-thumbnails/m-1/lg.webp';
const KEY = 'org-1/media-thumbnails/m-1';

describe('stillKey: which still a point was set on', () => {
  it('is the media key: no CDN origin, no size file', () => {
    expect(stillKey(STILL)).toBe(KEY);
  });

  it('is the same for every size of one still, from any read', () => {
    for (const size of ['sm', 'md', 'lg', 'xl'])
      expect(stillKey(`https://cdn.example/${KEY}/${size}.webp`)).toBe(KEY);
    // The awaited view and the streamed preview may name another origin.
    expect(stillKey(`http://localhost:4100/${KEY}/md.webp`)).toBe(KEY);
    expect(stillKey(`//cdn.example/${KEY}/md.webp`)).toBe(KEY);
    expect(stillKey(`${STILL}?v=2#top`)).toBe(KEY);
  });

  it('keeps the file of a still that names no sizes', () => {
    expect(stillKey('/media/guide/portrait.jpg')).toBe(
      'media/guide/portrait.jpg'
    );
  });

  it('is null for no still', () => {
    expect(stillKey(null)).toBeNull();
    expect(stillKey(undefined)).toBeNull();
    expect(stillKey('')).toBeNull();
    expect(stillKey('https://cdn.example/')).toBeNull();
  });
});

describe('readStillFocus: the stored point, never trusted', () => {
  it('reads a point and the still it belongs to', () => {
    expect(readStillFocus({ x: 12, y: 8, of: KEY })).toEqual({
      x: 12,
      y: 8,
      of: KEY,
    });
  });

  it('rounds to whole percent and keeps it in the frame, as an upload’s', () => {
    expect(readStillFocus({ x: 12.4, y: 150, of: KEY })).toEqual({
      x: 12,
      y: 100,
      of: KEY,
    });
    expect(readStillFocus({ x: -4, y: 7.6, of: KEY })).toEqual({
      x: 0,
      y: 8,
      of: KEY,
    });
  });

  it('is absent for the centre, which a still with no point gets anyway', () => {
    expect(readStillFocus({ x: 50, y: 50, of: KEY })).toBeUndefined();
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'left'],
    ['an array', [10, 20]],
    ['no still', { x: 10, y: 20 }],
    ['an empty still', { x: 10, y: 20, of: '' }],
    ['a still that is not a key', { x: 10, y: 20, of: 42 }],
    ['a pasted document', { x: 10, y: 20, of: 'k'.repeat(501) }],
    ['a point that is not a number', { x: '10', y: 20, of: KEY }],
    ['a point at infinity', { x: Number.POSITIVE_INFINITY, y: 20, of: KEY }],
  ])('is absent for %s', (_label, raw) => {
    expect(readStillFocus(raw)).toBeUndefined();
  });
});

describe('stillFocusFor: a point steers only its own still', () => {
  const stored = { x: 12, y: 8, of: KEY };

  it('steers the still it was set on, at any size', () => {
    expect(stillFocusFor(stored, STILL)).toEqual({ x: 12, y: 8 });
    expect(stillFocusFor(stored, `https://cdn.example/${KEY}/sm.webp`)).toEqual(
      { x: 12, y: 8 }
    );
  });

  it('leaves another still at the centre', () => {
    expect(
      stillFocusFor(
        stored,
        'https://cdn.example/org-1/media-thumbnails/m-2/lg.webp'
      )
    ).toBeUndefined();
  });

  it('leaves the centre where there is no point or no still', () => {
    expect(stillFocusFor(undefined, STILL)).toBeUndefined();
    expect(stillFocusFor(stored, null)).toBeUndefined();
  });
});

describe('placeStillFocus: what the inspector stores', () => {
  it('stores the point with the still’s key', () => {
    expect(placeStillFocus(STILL, { x: 30, y: 70 })).toEqual({
      x: 30,
      y: 70,
      of: KEY,
    });
  });

  it('stores nothing for the centre, or with no still', () => {
    expect(placeStillFocus(STILL, undefined)).toBeUndefined();
    expect(placeStillFocus(null, { x: 30, y: 70 })).toBeUndefined();
  });

  it('round-trips through the reader', () => {
    expect(readStillFocus(placeStillFocus(STILL, { x: 30, y: 70 }))).toEqual({
      x: 30,
      y: 70,
      of: KEY,
    });
  });
});

describe('stillCrops: the shapes a layout cuts in a Style', () => {
  const layouts = {
    theatre: [
      { at: 'wide' as const, ratio: '21 / 9', styles: ['bold' as const] },
      { at: 'phone' as const, ratio: '16 / 9' },
    ],
  };

  it('keeps a crop every Style cuts, and one Style’s only in that Style', () => {
    expect(stillCrops(layouts, 'theatre', 'bold').map((c) => c.at)).toEqual([
      'wide',
      'phone',
    ]);
    expect(stillCrops(layouts, 'theatre', 'clean').map((c) => c.at)).toEqual([
      'phone',
    ]);
  });

  it('is none for a layout that never cuts it', () => {
    expect(stillCrops(layouts, 'split', 'bold')).toEqual([]);
  });
});

describe('the sections that draw a course still', () => {
  const drawing = Object.values(DEFINITIONS).flatMap((definition) =>
    definition.stillFocus ? [[definition.type, definition] as const] : []
  );

  it('are the hero, the guide and the film; practice thumbnails stay centred', () => {
    expect(drawing.map(([type]) => type).sort()).toEqual([
      'hero',
      'instructor',
      'video',
    ]);
  });

  it.each(
    drawing
  )('%s: each cut names a layout it has, once a screen', (type, definition) => {
    const cuts = Object.entries(definition.stillFocus?.focalLayouts ?? {});
    expect(cuts.length).toBeGreaterThan(0);
    for (const [layout, crops] of cuts) {
      expect(SECTION_LAYOUTS[type as SectionTypeId]).toContain(layout);
      expect(crops.length, layout).toBeGreaterThan(0);
      // A layout may cut differently by Style (the guide's centred portrait,
      // square only in Bold and Soft); each Style still sees one a screen.
      for (const style of PAGE_STYLE_IDS) {
        const seen = stillCrops({ [layout]: crops }, layout, style);
        expect(
          new Set(seen.map((crop) => crop.at)).size,
          `${layout} ${style}`
        ).toBe(seen.length);
      }
      for (const { ratio, styles } of crops) {
        expect(ratio, layout).toMatch(/^\d+(\.\d+)? \/ \d+(\.\d+)?$/);
        for (const style of styles ?? [])
          expect(PAGE_STYLE_IDS).toContain(style);
      }
    }
  });

  it.each(
    drawing
  )('%s: keeps its point through its own reader', (_type, definition) => {
    const props = definition.coerce({ stillFocus: { x: 12, y: 8, of: KEY } });
    expect((props as { stillFocus?: unknown }).stillFocus).toEqual({
      x: 12,
      y: 8,
      of: KEY,
    });
    expect(
      definition.coerce({ stillFocus: { x: 50, y: 50, of: KEY } }) as object
    ).not.toHaveProperty('stillFocus');
  });

  it('a field it is offered under is one of its own', () => {
    for (const [type, definition] of drawing) {
      const under = definition.stillFocus?.under;
      if (under)
        expect(
          definition.fields.map((field) => field.key),
          type
        ).toContain(under);
    }
  });
});

describe('which still each section draws', () => {
  const preview = (media: Partial<SellPreview>): SellPreview => ({
    intro: null,
    reel: null,
    ...media,
  });
  const CLIP = { playlistUrl: '/hero.m3u8', posterUrl: STILL };

  describe('the hero', () => {
    const still = (
      raw: Record<string, unknown>,
      media: Partial<SellPreview> | undefined,
      options: Parameters<typeof sampleContext>[0] = {}
    ) =>
      DEFINITIONS.hero.stillFocus?.still(
        raw,
        media === undefined ? undefined : preview(media),
        sampleContext(options)
      );

    it('is the journey’s still once the preview settles, else the awaited one', () => {
      expect(still({}, { heroImageUrl: STILL })).toBe(STILL);
      expect(still({}, undefined, { course: { heroImageUrl: STILL } })).toBe(
        STILL
      );
      expect(still({}, { heroImageUrl: null })).toBeNull();
    });

    // The hero draws the journey's still there, never the clip's own frame:
    // the poster reaches it only as the still the server fell back to.
    it('is the journey’s still, not the clip’s poster, where the hero shows the image only', () => {
      const clip = { ...CLIP, posterUrl: '/frame.jpg' };
      expect(
        still({ media: 'image' }, { heroImageUrl: STILL, heroClip: clip })
      ).toBe(STILL);
    });

    it('is none where the clip plays in the frame, which a point never crops', () => {
      expect(still({}, { heroImageUrl: STILL, heroClip: CLIP })).toBeNull();
      expect(
        still({ media: 'video' }, { heroImageUrl: STILL, heroClip: CLIP })
      ).toBeNull();
    });

    it('is none where the hero shows nothing, or the creator’s own image', () => {
      expect(still({ media: 'none' }, { heroImageUrl: STILL })).toBeNull();
      expect(
        still(
          { image: { key: 'landing-pages/p1/images/i1' } },
          { heroImageUrl: STILL },
          { mediaBaseUrl: 'https://cdn.example' }
        )
      ).toBeNull();
      // With nowhere to draw it from, the own image is not drawn either.
      expect(
        still(
          { image: { key: 'landing-pages/p1/images/i1' } },
          {
            heroImageUrl: STILL,
          }
        )
      ).toBe(STILL);
    });
  });

  it('the guide: the portrait, else the clip’s frame', () => {
    const still = (media: Partial<SellPreview>) =>
      DEFINITIONS.instructor.stillFocus?.still(
        {},
        preview(media),
        sampleContext()
      );
    expect(still({ guidePortraitUrl: STILL, guideClip: CLIP })).toBe(STILL);
    expect(still({ guideClip: { ...CLIP, posterUrl: '/frame.jpg' } })).toBe(
      '/frame.jpg'
    );
    expect(still({})).toBeNull();
  });

  it('the film: its poster', () => {
    const still = (media: Partial<SellPreview>) =>
      DEFINITIONS.video.stillFocus?.still({}, preview(media), sampleContext());
    expect(still({ intro: CLIP })).toBe(STILL);
    expect(still({ intro: { playlistUrl: '/intro.m3u8' } })).toBeNull();
    expect(still({})).toBeNull();
  });

  it('the film’s poster is cut only by Bold’s wide theatre', () => {
    const layouts = DEFINITIONS.video.stillFocus?.focalLayouts ?? {};
    for (const style of PAGE_STYLE_IDS) {
      expect(stillCrops(layouts, 'split', style), style).toEqual([]);
      expect(
        stillCrops(layouts, 'theatre', style).map((crop) => crop.ratio),
        style
      ).toEqual(style === 'bold' ? ['21 / 9'] : []);
    }
  });

  // InstructorBlock draws the centred portrait 4:5, and square in Bold and
  // Soft: the preview shows each Style the crop its page draws.
  it('the guide’s centred portrait is cut square only where Bold and Soft draw it so', () => {
    const layouts = DEFINITIONS.instructor.stillFocus?.focalLayouts ?? {};
    for (const style of PAGE_STYLE_IDS) {
      const square = style === 'bold' || style === 'soft';
      expect(
        stillCrops(layouts, 'centered', style).map((crop) => crop.ratio),
        style
      ).toEqual(square ? ['1 / 1', '1 / 1'] : ['4 / 5', '4 / 5']);
    }
  });
});
