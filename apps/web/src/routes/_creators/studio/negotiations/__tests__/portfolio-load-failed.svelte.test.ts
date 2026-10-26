/**
 * Creator studio → Negotiations: a FAILED portfolio read is not an empty
 * portfolio (Codex-2hxff.74, the .45 pattern).
 *
 * It used to say "No revenue-share agreements yet" to a creator who holds
 * agreements, and agreement emails send creators to this page: every
 * decline, and a terminate or review-date email with no thread to open
 * (Codex-2hxff.20 AGR-10). Now "We couldn't load your agreements." with Retry
 * stands in for every section and its actions.
 *
 * Mounts the real `+page.svelte`; the remote module is mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);

import {
  fail,
  httpError,
  portfolioActiveRow,
  portfolioSlot,
  reset,
  setPortfolio,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { logger } from '$lib/observability';
import NegotiationsPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountFailed() {
  component = mount(NegotiationsPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  fail(portfolioSlot());
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const loadError = () => q('[data-testid="portfolio-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

describe('a failed portfolio read', () => {
  test('says it could not load the agreements, with Retry', () => {
    mountFailed();
    expect(loadError()?.getAttribute('role')).toBe('alert');
    expect(loadError()?.textContent).toContain(m.agreement_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('never says there are no agreements, and shows no skeletons', () => {
    mountFailed();
    expect(text()).not.toContain('No revenue-share agreements yet');
    expect(q('.negotiations-page__loading')).toBeNull();
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountFailed();
    expect(error).toHaveBeenCalledWith(
      'creator-studio/negotiations: portfolio failed to load',
      expect.any(Object)
    );
  });

  test('a Retry that fails again says "We still couldn\'t…"', async () => {
    mountFailed();
    const slot = portfolioSlot();
    slot.refresh.mockImplementationOnce(async () => {
      fail(slot);
      throw httpError();
    });

    retryButton()?.click();
    await settle();

    expect(slot.refresh).toHaveBeenCalledTimes(1);
    expect(loadError()?.textContent).toContain(m.agreement_load_failed_again());
  });

  test('a Retry that loads it shows the agreements and their actions', async () => {
    mountFailed();
    const slot = portfolioSlot();
    slot.refresh.mockImplementationOnce(async () => {
      setPortfolio([portfolioActiveRow()]);
    });

    retryButton()?.click();
    await settle();

    expect(loadError()).toBeNull();
    expect(text()).toContain('Active agreements');
    expect(text()).toContain('Manage');
  });
});

test('a portfolio that LOADED empty still says so (negative control)', () => {
  setPortfolio([]);
  component = mount(NegotiationsPage, {
    target: document.body,
    props: { data: {} } as never,
  });
  flushSync();

  expect(loadError()).toBeNull();
  expect(text()).toContain('No revenue-share agreements yet');
});
