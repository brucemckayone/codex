/**
 * LoadFailedAlert: Retry judged on the query the page holds (Codex-zskbp).
 *
 * Every caller derives its query (`$derived(getX(id))`), and kit drops a
 * query whose first read failed from its cache. So `refresh()` hands the page
 * a NEW query, still loading, while the refreshed one fetches again on its
 * own. The alert used to judge the Retry at once, on the new loading query,
 * and so counted a repeat failure as a success: the first message stayed, and
 * focus went to an empty status line. It also unmounted while the new query
 * loaded, dropping the focused button.
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
import {
  type KitQuery,
  type KitRead,
  kitQuery,
} from './__fixtures__/kit-query.mock.svelte';
import LoadFailedAlertHarness from './__fixtures__/LoadFailedAlertHarness.test.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountFailed(refuseStatus?: number): KitQuery<unknown> {
  const remote = kitQuery<unknown>();
  component = mount(LoadFailedAlertHarness, {
    target: document.body,
    props: { remote, refuseStatus },
  });
  remote.fail();
  flushSync();
  return remote;
}

const alert = () => document.querySelector('[data-testid="load-error"]');
const retryButton = () =>
  alert()?.querySelector('button') as HTMLButtonElement | null;
const status = () => document.querySelector('[role="status"]');
const elsewhere = () =>
  document.querySelector('[data-testid="elsewhere"]') as HTMLInputElement;
const LOADED = { items: [] };
/** Lets reads settle and Retry run on from them, focus moves included. */
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

/**
 * Presses Retry: the page is handed a new query, and both are in flight.
 * Returns the refreshed query WRAPPED: a query is thenable, so an async
 * function returning it bare would await its stray read, which never ends.
 */
async function retryOntoNewQuery(
  remote: KitQuery<unknown>
): Promise<{ refreshed: KitRead<unknown> }> {
  const refreshed = remote.held();
  retryButton()?.focus();
  retryButton()?.click();
  await settle();

  expect(refreshed.refresh).toHaveBeenCalledTimes(1);
  expect(remote.held()).not.toBe(refreshed);
  expect(remote.held().loading).toBe(true);
  // Kit fetches the refreshed query again too; that stray read is pending.
  expect(refreshed.loading).toBe(true);
  return { refreshed };
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

  test('a read that fails again says so, focuses the alert, and offers Retry again', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);

    remote.fail();
    await settle();

    expect(alert()?.textContent).toContain("We still couldn't load it.");
    expect(document.activeElement?.classList.contains('load-failed')).toBe(
      true
    );
    expect(status()?.textContent?.trim()).toBe('');
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
  });

  test('a read that loads ends the Retry at once, with the stray fetch still in flight', async () => {
    const remote = mountFailed();
    const { refreshed } = await retryOntoNewQuery(remote);

    remote.land(LOADED);
    await settle();

    expect(refreshed.loading).toBe(true);
    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
    expect(document.activeElement).toBe(status());
  });

  test('a stray fetch that lands does not count; the held read failing again does', async () => {
    const remote = mountFailed();
    const { refreshed } = await retryOntoNewQuery(remote);

    remote.land(LOADED, refreshed);
    await settle();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );

    remote.fail();
    await settle();
    expect(alert()?.textContent).toContain("We still couldn't load it.");
    expect(status()?.textContent?.trim()).toBe('');
  });

  test('a second Retry, after a repeat failure, can load', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);
    remote.fail();
    await settle();

    await retryOntoNewQuery(remote);
    remote.land(LOADED);
    await settle();

    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
  });

  test('a second press while it runs sends nothing', async () => {
    const remote = mountFailed();
    const refreshed = remote.held();
    retryButton()?.click();
    retryButton()?.click();
    await settle();

    expect(refreshed.refresh).toHaveBeenCalledTimes(1);
    expect(remote.held().refresh).not.toHaveBeenCalled();
  });

  test('when the page lets the query go mid-Retry, it claims nothing', async () => {
    const remote = mountFailed(403);
    await retryOntoNewQuery(remote);

    remote.fail({ status: 403, body: { message: 'Forbidden' } });
    await settle();

    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('');
    expect(document.activeElement).not.toBe(status());
  });

  test('does not take focus from where the creator moved it', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);

    elsewhere().focus();
    remote.land(LOADED);
    await settle();

    expect(document.activeElement).toBe(elsewhere());
    expect(status()?.textContent?.trim()).toBe('It loaded.');
  });
});
