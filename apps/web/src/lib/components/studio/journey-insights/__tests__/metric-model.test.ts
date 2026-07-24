import { describe, expect, it } from 'vitest';
import {
  buildCourseMetrics,
  buildJourneyMetricGroups,
  buildLiveMetrics,
  completionRate,
  type JourneyInsightsData,
  METRIC_TIERS,
  type MetricSample,
  UNTRACKED_TIER,
} from '../metric-model';

const s = (
  value: number,
  previousValue: number | null = null
): MetricSample => ({
  value,
  previousValue,
});

function fixture(
  overrides: Partial<JourneyInsightsData> = {}
): JourneyInsightsData {
  return {
    courseId: 'course-1',
    courseTitle: 'Test Course',
    period: '30d',
    financials: {
      revenueCents: s(120_000, 100_000),
      purchaseCount: s(40, 30),
      subscriptionCount: s(12, 10),
      revenueTrend: [
        { date: 't-2', value: 1000 },
        { date: 't-1', value: 1200 },
      ],
    },
    engagement: {
      enrolledCount: s(200, 100),
      activeCount: s(120, 60),
      completedCount: s(50, 20),
    },
    ...overrides,
  };
}

describe('completionRate', () => {
  it('guards div-by-zero — no enrolments reports 0%, never NaN/Infinity', () => {
    expect(completionRate(0, 0)).toBe(0);
    expect(completionRate(5, 0)).toBe(0);
    expect(Number.isFinite(completionRate(5, 0))).toBe(true);
  });

  it('rounds to an integer percentage', () => {
    expect(completionRate(50, 200)).toBe(25);
    expect(completionRate(1, 3)).toBe(33);
    expect(completionRate(2, 3)).toBe(67);
  });
});

describe('buildLiveMetrics', () => {
  it('tags every metric with the live tier', () => {
    const metrics = buildLiveMetrics(fixture().financials);
    expect(metrics).toHaveLength(3);
    expect(metrics.every((m) => m.tier === 'live')).toBe(true);
  });

  it('renders revenue as GBP pence (money) and carries the trend', () => {
    const revenue = buildLiveMetrics(fixture().financials).find(
      (m) => m.key === 'revenue'
    );
    expect(revenue?.format).toBe('money');
    expect(revenue?.value).toBe(120_000);
    expect(revenue?.previousValue).toBe(100_000);
    expect(revenue?.trend).toHaveLength(2);
  });

  it('renders counts as plain numbers', () => {
    const metrics = buildLiveMetrics(fixture().financials);
    const purchases = metrics.find((m) => m.key === 'purchases');
    expect(purchases?.format).toBe('number');
    expect(purchases?.value).toBe(40);
  });
});

describe('buildCourseMetrics', () => {
  it('tags every metric with the course tier', () => {
    const metrics = buildCourseMetrics(fixture().engagement);
    expect(metrics.every((m) => m.tier === 'course')).toBe(true);
  });

  it('derives completion rate as a percent from completed ÷ enrolled', () => {
    const rate = buildCourseMetrics(fixture().engagement).find(
      (m) => m.key === 'completionRate'
    );
    expect(rate?.format).toBe('percent');
    expect(rate?.unit).toBe('%');
    expect(rate?.value).toBe(25); // 50 / 200
    expect(rate?.previousValue).toBe(20); // 20 / 100
  });

  it('leaves the previous completion rate null when the prior period is absent', () => {
    const { engagement } = fixture({
      engagement: {
        enrolledCount: s(200, null),
        activeCount: s(120, null),
        completedCount: s(50, null),
      },
    });
    const rate = buildCourseMetrics(engagement).find(
      (m) => m.key === 'completionRate'
    );
    expect(rate?.previousValue).toBeNull();
  });
});

describe('buildJourneyMetricGroups — structural provenance', () => {
  it('returns exactly the two v1 tiers, live before course', () => {
    const groups = buildJourneyMetricGroups(fixture());
    expect(groups.map((g) => g.tier)).toEqual(['live', 'course']);
  });

  it('attaches the correct legend meta to each group', () => {
    const groups = buildJourneyMetricGroups(fixture());
    expect(groups[0].meta).toBe(METRIC_TIERS.live);
    expect(groups[1].meta).toBe(METRIC_TIERS.course);
  });

  it('every metric carries the tier of the group it lives in', () => {
    for (const group of buildJourneyMetricGroups(fixture())) {
      expect(group.metrics.every((m) => m.tier === group.tier)).toBe(true);
    }
  });

  it('never emits a track tier — track is dropped for v1', () => {
    const tiers = new Set(
      buildJourneyMetricGroups(fixture()).flatMap((g) =>
        g.metrics.map((m) => m.tier)
      )
    );
    expect([...tiers].sort()).toEqual(['course', 'live']);
    expect(tiers.has('track' as never)).toBe(false);
  });
});

describe('track tier is acknowledged but not built', () => {
  it('exposes UNTRACKED_TIER for the legend without producing metrics', () => {
    expect(UNTRACKED_TIER.id).toBe('track');
    // METRIC_TIERS (the built tiers) must not contain track.
    expect(Object.keys(METRIC_TIERS).sort()).toEqual(['course', 'live']);
  });
});
