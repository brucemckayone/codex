/**
 * AnalyticsCommandBar: "Last N days" is exactly N UTC calendar days
 * (Codex-2hxff.75, review I-1). The admin API reads an end date as the whole
 * of that day, so a preset that started N days back read N + 1: 30d on 26 Oct
 * covered 26 Sep to 26 Oct, one more day than Billing and the dashboard.
 *
 * Mounts the real bar; `$app/navigation` and `$app/state` are mocked and the
 * clock is fixed at 26 Oct 2026, 15:00 UTC.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn(async (_url: string) => {}) }));
const page = vi.hoisted(() => ({
  url: new URL('http://studio-alpha.lvh.me:3000/studio/analytics'),
}));

vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({ page }));

import AnalyticsCommandBar from './AnalyticsCommandBar.svelte';
import { inclusiveDays } from './analytics-range';

const NOW = new Date('2026-10-26T15:00:00.000Z');

let component: ReturnType<typeof mount> | null = null;

function mountBar(props: {
  startDate: string;
  endDate: string;
  compareFrom?: string;
  compareTo?: string;
}) {
  component = mount(AnalyticsCommandBar, { target: document.body, props });
  flushSync();
}

function tab(label: string): HTMLButtonElement {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  ).find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`no tab labelled ${label}`);
  return found;
}

/** The params of the one URL the bar navigated to. */
function navigatedTo(): URLSearchParams {
  expect(nav.goto).toHaveBeenCalledTimes(1);
  const [url] = nav.goto.mock.calls[0];
  return new URL(url, page.url).searchParams;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  nav.goto.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('AnalyticsCommandBar presets', () => {
  test('30d on 26 Oct is 27 Sep to 26 Oct: 30 days, not 31', () => {
    mountBar({ startDate: '2026-10-20', endDate: '2026-10-26' });

    tab(m.analytics_date_30d()).click();
    const params = navigatedTo();

    expect(params.get('startDate')).toBe('2026-09-27');
    expect(params.get('endDate')).toBe('2026-10-26');
    expect(
      inclusiveDays(
        params.get('startDate') as string,
        params.get('endDate') as string
      )
    ).toBe(30);
  });

  test('with compare on, the compare window is the 30 days before it', () => {
    mountBar({
      startDate: '2026-10-20',
      endDate: '2026-10-26',
      compareFrom: '2026-10-13',
      compareTo: '2026-10-19',
    });

    tab(m.analytics_date_30d()).click();
    const params = navigatedTo();

    expect(params.get('compareFrom')).toBe('2026-08-28');
    expect(params.get('compareTo')).toBe('2026-09-26');
  });

  test('every preset tab navigates to exactly its days', () => {
    for (const [label, days] of [
      [m.analytics_date_7d(), 7],
      [m.analytics_date_30d(), 30],
      [m.analytics_date_90d(), 90],
      [m.analytics_date_year(), 365],
    ] as const) {
      // A custom range, so no preset click is a no-op navigation.
      mountBar({ startDate: '2026-10-01', endDate: '2026-10-02' });
      tab(label).click();
      const params = navigatedTo();
      expect(
        inclusiveDays(
          params.get('startDate') as string,
          params.get('endDate') as string
        )
      ).toBe(days);
      unmount(component as ReturnType<typeof mount>);
      component = null;
      nav.goto.mockClear();
    }
  });

  test('the 30-day window it navigates to is shown as "Last 30 days"', () => {
    mountBar({ startDate: '2026-09-27', endDate: '2026-10-26' });

    expect(tab(m.analytics_date_30d()).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(document.querySelector('.window-chip__value')?.textContent).toBe(
      m.analytics_cmd_window_last_30d()
    );
  });

  test('an old 31-day link is labelled by its dates, not "Last 30 days"', () => {
    mountBar({ startDate: '2026-09-26', endDate: '2026-10-26' });

    for (const el of document.querySelectorAll('[role="tab"]')) {
      expect(el.getAttribute('aria-selected')).not.toBe('true');
    }
    // "26 Sept – 26 Oct"; the month spelling is the runtime's ICU data.
    const day = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
    });
    expect(document.querySelector('.window-chip__value')?.textContent).toBe(
      `${day.format(new Date('2026-09-26'))} – ${day.format(new Date('2026-10-26'))}`
    );
  });
});
