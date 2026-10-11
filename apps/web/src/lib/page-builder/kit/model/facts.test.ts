import { describe, expect, it } from 'vitest';
import type { JourneySalesContext } from '../../render/types';
import { heroFacts } from './facts';
import { sampleContext } from './sample';

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
