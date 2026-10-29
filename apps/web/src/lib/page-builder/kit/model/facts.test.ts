import { describe, expect, it } from 'vitest';
import type { JourneySalesContext } from '../../render/types';
import { courseFacts, type FactStage, heroFacts } from './facts';
import { sampleContext, sampleStages } from './sample';

type Kind = FactStage['practices'][number]['contentType'];

/** One stage of practices, each a kind and a length in seconds (null = none). */
const stage = (...practices: [Kind, number | null][]): FactStage => ({
  practices: practices.map(([contentType, durationSeconds]) => ({
    contentType,
    durationSeconds,
  })),
});

describe('courseFacts — the one count of the course', () => {
  it('counts stages, practices and each kind', () => {
    const facts = courseFacts([
      stage(['video', 600], ['audio', 300]),
      stage(['video', 900]),
    ]);
    expect(facts).toEqual({
      stages: 2,
      practices: 3,
      seconds: 1800,
      kinds: { video: 2, audio: 1, written: 0 },
    });
  });

  it('times the video and audio, and never counts a reading', () => {
    // A reading is not played for a length, so it neither adds to the sum
    // nor keeps it from being told.
    expect(
      courseFacts([stage(['video', 600], ['written', null], ['audio', 300])])
        .seconds
    ).toBe(900);
    // Even a reading that somehow carries one is not timed.
    expect(
      courseFacts([stage(['video', 600], ['written', 1200])]).seconds
    ).toBe(600);
  });

  it('tells no length while a single video or audio practice has none', () => {
    // An unmeasured film would make the sum claim less than the course holds.
    expect(
      courseFacts([stage(['video', 600], ['audio', null])]).seconds
    ).toBeNull();
    expect(
      courseFacts([stage(['video', 600], ['audio', 0])]).seconds
    ).toBeNull();
    // An older worker leaves the key out altogether.
    expect(
      courseFacts([{ practices: [{ contentType: 'video' }] }]).seconds
    ).toBeNull();
  });

  it('tells no length for a course of readings alone', () => {
    expect(
      courseFacts([stage(['written', null], ['written', null])]).seconds
    ).toBeNull();
  });

  it('says a course with no practices has no length, however many stages', () => {
    expect(courseFacts([stage(), stage()])).toEqual({
      stages: 2,
      practices: 0,
      seconds: null,
      kinds: { video: 0, audio: 0, written: 0 },
    });
    expect(courseFacts([]).stages).toBe(0);
  });

  it('counts the sample course the curriculum draws', () => {
    const facts = courseFacts(sampleStages());
    expect(facts.stages).toBe(6);
    expect(facts.practices).toBe(24);
    expect(facts.kinds).toEqual({ video: 7, audio: 8, written: 9 });
    // Every film and recording is measured; the readings are not timed.
    expect(facts.seconds).toBe(9660);
  });
});

const shape = (context: JourneySalesContext) => {
  const practices = context.stages.reduce(
    (count, stage) => count + stage.practices.length,
    0
  );
  return [`${context.stages.length} stages`, `${practices} practices`];
};

describe('heroFacts — the course’s shape and its way in', () => {
  it('reads the one price of a single way in, with no "from"', () => {
    const context = sampleContext({ offer: 'buy' });
    expect(heroFacts(context)).toEqual([...shape(context), '£49 one-off']);
  });

  it('marks the lowest of several prices "from"', () => {
    const context = sampleContext({ offer: 'sub' });
    expect(heroFacts(context)).toEqual([
      ...shape(context),
      'from £12 per month',
    ]);
  });

  it('takes the lowest across every kind of way in, not the recommended one', () => {
    const context = sampleContext({ offer: 'tiers' });
    expect(heroFacts(context).at(-1)).toBe('from £15 per month');
  });

  it('gives an enrolled viewer, a course with no way in and an unread offer the shape alone', () => {
    for (const offer of ['enrolled', 'unavailable', 'unknown'] as const) {
      const context = sampleContext({ offer });
      expect(heroFacts(context), offer).toEqual(shape(context));
    }
  });

  it('counts one of each in the singular', () => {
    const base = sampleContext({ offer: 'unknown' });
    const [stage] = base.stages;
    if (!stage) throw new Error('the sample has no stage');
    const [practice] = stage.practices;
    if (!practice) throw new Error('the sample stage has no practice');
    const context = { ...base, stages: [{ ...stage, practices: [practice] }] };
    expect(heroFacts(context)).toEqual(['1 stage', '1 practice']);
  });

  it('leaves out a count of nothing, and says nothing about an empty course', () => {
    const base = sampleContext({ offer: 'unknown' });
    const [stage] = base.stages;
    if (!stage) throw new Error('the sample has no stage');
    expect(
      heroFacts({ ...base, stages: [{ ...stage, practices: [] }] })
    ).toEqual(['1 stage']);
    expect(heroFacts({ ...base, stages: [] })).toEqual([]);
  });
});
