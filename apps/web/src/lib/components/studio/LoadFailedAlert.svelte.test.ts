/**
 * LoadFailedAlert: Retry judged on the query the page holds (Codex-zskbp).
 *
 * Every caller derives its query (`$derived(getX(id))`), and kit drops a
 * failed query from its cache, so `refresh()` hands the page a NEW query that
 * is still loading. The alert used to judge the Retry at once, on that
 * loading query, and counted a Retry that failed again as a success: the
 * first message stayed, and focus went to an empty status line. It also
 * unmounted while the new query loaded, dropping the focused button.
 *
 * Mounts the alert through a harness that derives its query, as a page does,
 * from a double of kit's query (`__fixtures__/kit-query.mock.svelte`).
 */

import { afterEach, describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { type KitQuery, kitQuery } from './__fixtures__/kit-query.mock.svelte';
import LoadFailedAlertHarness from './__fixtures__/LoadFailedAlertHarness.test.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountFailed(): KitQuery<unknown> {
  const remote = kitQuery<unknown>();
  component = mount(LoadFailedAlertHarness, {
    target: document.body,
    props: { remote },
  });
  remote.fail();
  flushSync();
  return remote;
}

const alert = () => document.querySelector('[data-testid="load-error"]');
const retryButton = () =>
  alert()?.querySelector('button') as HTMLButtonElement | null;
const status = () => document.querySelector('[role="status"]');
/** Lets the refreshed query's own read settle, and Retry run on from it. */
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

/** Presses Retry; the page is handed a new query, still loading. */
async function retryOntoNewQuery(remote: KitQuery<unknown>) {
  const refreshed = remote.held();
  retryButton()?.focus();
  retryButton()?.click();
  await settle();

  expect(refreshed.refresh).toHaveBeenCalledTimes(1);
  expect(remote.held()).not.toBe(refreshed);
  expect(remote.held().loading).toBe(true);
}

describe('Retry, when the page is handed a new query', () => {
  test('keeps the alert and the focused button while the new query loads', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);

    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(document.activeElement).toBe(retryButton());
  });

  test('a read that fails again says so and focuses the alert', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);

    remote.fail();
    await settle();

    expect(alert()?.textContent).toContain("We still couldn't load it.");
    expect(document.activeElement?.classList.contains('load-failed')).toBe(
      true
    );
    expect(status()?.textContent?.trim()).toBe('');
  });

  test('a read that loads removes the alert and focuses the status line that says so', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);

    remote.land({ items: [] });
    await settle();

    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
    expect(document.activeElement).toBe(status());
  });
});
