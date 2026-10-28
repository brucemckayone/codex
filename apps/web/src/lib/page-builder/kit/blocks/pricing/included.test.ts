import { describe, expect, it } from 'vitest';
import { deriveOfferPaths } from '../../../offer-paths';
import { type CourseFacts, courseFacts } from '../../model/facts';
import { SAMPLE_COURSE, sampleOffer, sampleStages } from '../../model/sample';
import { pricingDefinition } from './definition';
import {
  courseRows,
  drawsIncluded,
  factLine,
  INCLUDED_LINE_MAX,
  INCLUDED_MAX,
  includedLines,
  OWNED_POINTS_MAX,
  ownedPoints,
} from './included';

/** 6 stages, 24 practices, 18 videos and 6 audio, 5 hr 40 min of them. */
const COURSE: CourseFacts = {
  stages: 6,
  practices: 24,
  seconds: (5 * 60 + 40) * 60,
  kinds: { video: 18, audio: 6, written: 0 },
};

const coerce = (included: unknown) =>
  pricingDefinition.coerce({ heading: 'Join', included }).included;

describe('included — the course’s own lines', () => {
  it('says each fact the way a visitor reads it', () => {
    expect(includedLines(undefined, COURSE)).toEqual([
      '6 stages',
      '24 practices',
      '5 hr 40 min of video and audio',
      '18 videos · 6 audio',
    ]);
  });

  it('counts one of each in the singular, and names every kind it has', () => {
    const one: CourseFacts = {
      stages: 1,
      practices: 3,
      seconds: null,
      kinds: { video: 1, audio: 1, written: 1 },
    };
    expect(includedLines(undefined, one)).toEqual([
      '1 stage',
      '3 practices',
      '1 video · 1 audio · 1 reading',
    ]);
  });

  it('times the video and audio beside the readings, and says that is what it timed', () => {
    // The sample course: every film and recording measured, and readings.
    const facts = courseFacts(sampleStages());
    expect(includedLines(undefined, facts)).toEqual([
      '6 stages',
      '24 practices',
      '2 hr 41 min of video and audio',
      '7 videos · 8 audio · 9 readings',
    ]);
  });

  it('names only the kinds it timed', () => {
    const only = (video: number, audio: number) =>
      factLine('length', {
        ...COURSE,
        kinds: { video, audio, written: 3 },
      });
    expect(only(18, 0)).toBe('5 hr 40 min of video');
    expect(only(0, 6)).toBe('5 hr 40 min of audio');
  });

  it('leaves the length out with nothing timed, or anything unmeasured', () => {
    // `courseFacts` gives no length for a course of readings alone, nor for
    // one with a film nobody measured.
    const readings = courseFacts([
      { practices: [{ contentType: 'written', durationSeconds: null }] },
    ]);
    expect(factLine('length', readings)).toBeNull();
    const unmeasured = courseFacts([
      {
        practices: [
          { contentType: 'video', durationSeconds: 600 },
          { contentType: 'audio', durationSeconds: null },
        ],
      },
    ]);
    expect(factLine('length', unmeasured)).toBeNull();
    expect(includedLines(undefined, unmeasured)).toEqual([
      '1 stage',
      '2 practices',
      '1 video · 1 audio',
    ]);
  });

  it('says nothing about a course with no practices, not even its stages', () => {
    const empty = courseFacts([{ practices: [] }, { practices: [] }]);
    expect(courseRows(empty)).toEqual([]);
    expect(includedLines(undefined, empty)).toEqual([]);
  });

  it('keeps a live line live: the count follows the curriculum', () => {
    const rows = [{ fact: 'practices' as const }];
    expect(includedLines(rows, COURSE)).toEqual(['24 practices']);
    expect(includedLines(rows, { ...COURSE, practices: 25 })).toEqual([
      '25 practices',
    ]);
  });
});

describe('included — what the creator stored', () => {
  it('draws the rows in the creator’s order: live, rewritten and their own', () => {
    expect(
      includedLines(
        [
          { text: 'Printable workbook' },
          { fact: 'length', text: 'Nearly six hours of guided practice' },
          { fact: 'stages' },
        ],
        COURSE
      )
    ).toEqual([
      'Printable workbook',
      'Nearly six hours of guided practice',
      '6 stages',
    ]);
  });

  it('draws no list for an empty one: the creator switched it off', () => {
    expect(includedLines([], COURSE)).toEqual([]);
  });

  it('drops a live line with nothing to say, and keeps the creator’s words for it', () => {
    const unmeasured = { ...COURSE, seconds: null };
    expect(includedLines([{ fact: 'length' }], unmeasured)).toEqual([]);
    expect(
      includedLines([{ fact: 'length', text: 'About six hours' }], unmeasured)
    ).toEqual(['About six hours']);
  });
});

describe('pricingDefinition.coerce — reading `included`', () => {
  it('reads an absent or wrongly typed key as absent: the course’s own lines', () => {
    expect(coerce(undefined)).toBeUndefined();
    expect('included' in pricingDefinition.coerce({ heading: 'Join' })).toBe(
      false
    );
    for (const junk of ['6 stages', 6, { fact: 'stages' }, null]) {
      expect(coerce(junk), JSON.stringify(junk)).toBeUndefined();
    }
  });

  it('keeps an empty list: that is the list switched off, not absent', () => {
    expect(coerce([])).toEqual([]);
  });

  it('reads each kind of row', () => {
    expect(
      coerce([
        { fact: 'stages' },
        { fact: 'length', text: '  Nearly six hours  ' },
        { text: 'Printable workbook' },
      ])
    ).toEqual([
      { fact: 'stages' },
      { fact: 'length', text: 'Nearly six hours' },
      { text: 'Printable workbook' },
    ]);
  });

  it('drops junk rows and keys, and keeps the words of a row naming an unknown fact', () => {
    expect(
      coerce([
        'not a row',
        null,
        ['nested'],
        {},
        { fact: 'downloads' },
        { fact: 'price', text: 'Printable workbook' },
        { text: '   ' },
        { fact: 'mix', text: 42, priceCents: 0 },
      ])
    ).toEqual([{ text: 'Printable workbook' }, { fact: 'mix' }]);
  });

  it('reads an array of nothing but junk as an empty list', () => {
    expect(coerce([{}, 'x', { text: '' }])).toEqual([]);
  });

  it('draws a fact once, by the first row naming it', () => {
    expect(
      coerce([
        { fact: 'practices', text: 'Two dozen practices' },
        { fact: 'practices' },
      ])
    ).toEqual([{ fact: 'practices', text: 'Two dozen practices' }]);
  });

  it('caps the list and each line, well inside the 16 KB props cap', () => {
    const long = 'x'.repeat(500);
    const rows = coerce(
      Array.from({ length: 40 }, (_, index) => ({ text: `${index} ${long}` }))
    );
    expect(rows).toHaveLength(INCLUDED_MAX);
    for (const row of rows ?? []) {
      expect(row.text?.length).toBe(INCLUDED_LINE_MAX);
    }
    const stored = JSON.stringify({ included: rows });
    expect(stored.length).toBeLessThan(16 * 1024);
  });

  it('survives its own reader', () => {
    const rows = coerce([
      { fact: 'stages' },
      { fact: 'mix', text: 'Mostly films' },
      { text: 'Printable workbook' },
    ]);
    expect(coerce(rows)).toEqual(rows);
  });
});

describe('ownedPoints — the one-off’s card beside other cards', () => {
  const LINES = includedLines(undefined, COURSE);
  const paths = (props?: Record<string, unknown>) =>
    deriveOfferPaths(sampleOffer('tiers'), SAMPLE_COURSE, props);

  it('gives the one-off the course’s first lines, so its card says what a buyer would own', () => {
    const [purchase, ...tiers] = paths();
    if (purchase?.kind !== 'purchase')
      throw new Error('the sample has a one-off');
    expect(ownedPoints(purchase, LINES, 3).bullets).toEqual([
      '6 stages',
      '24 practices',
      '5 hr 40 min of video and audio',
    ]);
    expect(OWNED_POINTS_MAX).toBe(3);
    // The memberships keep their own points.
    for (const tier of tiers) expect(ownedPoints(tier, LINES, 3)).toBe(tier);
  });

  it('gives a lone card none: the list stands beside it', () => {
    const [purchase] = paths();
    if (!purchase) throw new Error('the sample has a one-off');
    expect(ownedPoints(purchase, LINES, 1).bullets).toEqual([]);
  });

  it('follows the list: none when it is switched off, the creator’s rows when they wrote them', () => {
    const [purchase] = paths();
    if (!purchase) throw new Error('the sample has a one-off');
    expect(ownedPoints(purchase, includedLines([], COURSE), 3).bullets).toEqual(
      []
    );
    const theirs = includedLines(
      [{ text: 'Printable workbook' }, { fact: 'stages' }],
      COURSE
    );
    expect(ownedPoints(purchase, theirs, 3).bullets).toEqual([
      'Printable workbook',
      '6 stages',
    ]);
  });

  it('keeps points the creator wrote for the one-off', () => {
    const [purchase] = paths({
      offers: [{ id: 'purchase', bullets: ['Yours to keep'] }],
    });
    if (!purchase) throw new Error('the sample has a one-off');
    expect(ownedPoints(purchase, LINES, 3).bullets).toEqual(['Yours to keep']);
  });
});

describe('drawsIncluded — when the list stands beside the offer', () => {
  it('draws it beside a single way in', () => {
    expect(drawsIncluded(1)).toBe(true);
  });

  it('leaves two or more ways in, and none, as they are', () => {
    expect(drawsIncluded(0)).toBe(false);
    expect(drawsIncluded(2)).toBe(false);
    expect(drawsIncluded(4)).toBe(false);
  });
});
