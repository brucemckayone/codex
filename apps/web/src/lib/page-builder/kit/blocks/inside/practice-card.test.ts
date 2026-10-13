/**
 * What a practice card shows, worked out once for every layout that draws one
 * (03 X63, Codex-61zsk.52).
 */
import { describe, expect, it } from 'vitest';
import type { JourneyPracticeView, JourneyStageView } from '$lib/page-builder';
import { CURRICULUM_COPY } from '../curriculum/copy';
import { INSIDE_COPY } from './copy';
import { practiceCard, stagedPracticeCards } from './practice-card';

const CDN = 'https://cdn-assets.example.test/creator/media-thumbnails/m1';

function practice(
  over: Partial<JourneyPracticeView> & { contentId: string }
): JourneyPracticeView {
  return {
    slug: null,
    title: over.contentId,
    contentType: 'video',
    sortOrder: 0,
    ...over,
  };
}

describe('practiceCard', () => {
  it('names the kind and length in the curriculum’s own words', () => {
    const card = practiceCard(
      practice({ contentId: 'a', contentType: 'audio', durationSeconds: 540 })
    );
    expect(card.kind).toBe(CURRICULUM_COPY.kind('audio'));
    expect(card.kind).toBe('Audio');
    expect(card.length).toBe('9 min');
    const reading = practiceCard(
      practice({
        contentId: 'b',
        contentType: 'written',
        durationSeconds: null,
      })
    );
    expect([reading.kind, reading.length]).toEqual(['Reading', null]);
  });

  it('offers the picture’s stored sizes, and none for a URL without them', () => {
    const card = practiceCard(
      practice({ contentId: 'a', thumbnailUrl: `${CDN}/lg.webp` })
    );
    expect(card.picture).toBe(`${CDN}/lg.webp`);
    expect(card.srcset).toBe(
      `${CDN}/sm.webp 200w, ${CDN}/md.webp 400w, ${CDN}/lg.webp 800w`
    );
    const legacy = practiceCard(
      practice({ contentId: 'b', thumbnailUrl: `${CDN}/thumb.jpg` })
    );
    expect([legacy.picture, legacy.srcset]).toEqual([`${CDN}/thumb.jpg`, '']);
  });

  it('has no picture when the practice has none, from any worker', () => {
    // An older worker omits the field; a newer one sends null; never ''.
    for (const thumbnailUrl of [undefined, null, '']) {
      const card = practiceCard(practice({ contentId: 'a', thumbnailUrl }));
      expect([card.picture, card.srcset]).toEqual([null, '']);
    }
  });
});

describe('stagedPracticeCards', () => {
  // Given out of order, as the canvas's editor read may give them.
  const STAGES: JourneyStageView[] = [
    {
      id: 's2',
      name: 'Staying',
      gloss: null,
      sortOrder: 1,
      practices: [
        practice({ contentId: 'c4', sortOrder: 4 }),
        practice({ contentId: 'c3', sortOrder: 3 }),
      ],
    },
    {
      id: 's1',
      name: 'Arriving',
      gloss: null,
      sortOrder: 0,
      practices: [
        practice({ contentId: 'c2', sortOrder: 1 }),
        practice({ contentId: 'c1', sortOrder: 0 }),
      ],
    },
    {
      id: 's3',
      name: '   ',
      gloss: null,
      sortOrder: 2,
      practices: [practice({ contentId: 'c5', sortOrder: 5 })],
    },
  ];

  it('lays every practice out in the order a member meets them, each named with its stage', () => {
    expect(
      stagedPracticeCards(STAGES).map(({ card, stage }) => [card.id, stage])
    ).toEqual([
      ['c1', 'Stage 1 · Arriving'],
      ['c2', 'Stage 1 · Arriving'],
      ['c3', 'Stage 2 · Staying'],
      ['c4', 'Stage 2 · Staying'],
      // A stage with no name is still a stage.
      ['c5', 'Stage 3'],
    ]);
  });

  it('gives nothing for a course with no practices yet', () => {
    expect(stagedPracticeCards([])).toEqual([]);
    expect(
      stagedPracticeCards([
        { id: 's', name: 'Empty', gloss: null, sortOrder: 0, practices: [] },
      ])
    ).toEqual([]);
  });
});

describe('INSIDE_COPY.position', () => {
  it('says which practices are in view, as a range or as one', () => {
    expect(INSIDE_COPY.position(1, 3, 18)).toBe('1–3 of 18');
    expect(INSIDE_COPY.position(18, 18, 18)).toBe('18 of 18');
  });
});
