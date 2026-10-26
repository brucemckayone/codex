/**
 * The three Studio stat tiles take an optional `detail` snippet: a line under
 * the value, such as the revenue figure's per-kind line (Codex-2hxff.20
 * WEB-02). Absent, nothing is added; present, it sits straight under the
 * value, and a loading TodayStat leaves it out with the value.
 */
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import KPICard from './analytics/KPICard.svelte';
import TodayStat from './dashboard/TodayStat.svelte';
import StatCard from './StatCard.svelte';

const detail = createRawSnippet(() => ({
  render: () => '<p data-testid="tile-detail">One-off £312.45</p>',
}));

describe('stat tile detail', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  const found = () => document.querySelector('[data-testid="tile-detail"]');

  test('TodayStat renders it straight after the value', () => {
    component = mount(TodayStat, {
      target: document.body,
      props: {
        ordinal: '01',
        label: 'Revenue',
        value: '£1,241.00',
        series: [1, 2, 3],
        variant: 'feature',
        detail,
      },
    });

    expect(found()?.previousElementSibling?.classList).toContain('stat-body');
    expect(found()?.nextElementSibling?.classList).toContain('stat-spark');
  });

  test('a loading TodayStat leaves it out, with the value', () => {
    component = mount(TodayStat, {
      target: document.body,
      props: {
        ordinal: '01',
        label: 'Revenue',
        value: '£–',
        loading: true,
        variant: 'feature',
        detail,
      },
    });

    expect(found()).toBeNull();
  });

  test('KPICard renders it between the value row and the delta', () => {
    component = mount(KPICard, {
      target: document.body,
      props: {
        label: 'Revenue',
        value: 124100,
        format: 'money',
        previousValue: 100000,
        detail,
      },
    });

    expect(found()?.previousElementSibling?.classList).toContain(
      'kpi-card__value-row'
    );
    expect(found()?.nextElementSibling?.classList).toContain('kpi-card__delta');
  });

  test('StatCard renders it under the value row', () => {
    component = mount(StatCard, {
      target: document.body,
      props: { label: 'Gross · last 30 days', value: '£1,241.00', detail },
    });

    expect(found()?.previousElementSibling?.classList).toContain('stat-row');
  });

  test('without it, no tile adds anything', () => {
    component = mount(StatCard, {
      target: document.body,
      props: { label: 'Purchases', value: 34 },
    });

    expect(found()).toBeNull();
    expect(document.querySelector('.stat-row')?.nextElementSibling).toBeNull();
  });
});
