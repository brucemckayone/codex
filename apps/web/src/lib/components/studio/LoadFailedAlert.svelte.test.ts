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
import {
  type LoadReadDouble,
  loadReadDouble,
} from './__fixtures__/load-read.mock.svelte';
import { type AlertRead, loadRead } from './alert-read';

let component: ReturnType<typeof mount> | null = null;
/** The harness's props, reactive so a test can change what the page refuses. */
let harness: { remote: KitQuery<unknown>; refuseStatus?: number } | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  harness = null;
  document.body.innerHTML = '';
});

function mountHarness(refuseStatus?: number): KitQuery<unknown> {
  const remote = kitQuery<unknown>();
  const props = $state({ remote, refuseStatus });
  harness = props;
  component = mount(LoadFailedAlertHarness, {
    target: document.body,
    props,
  });
  flushSync();
  return remote;
}

function mountFailed(refuseStatus?: number): KitQuery<unknown> {
  const remote = mountHarness(refuseStatus);
  remote.fail();
  flushSync();
  return remote;
}

const alert = () => document.querySelector('[data-testid="load-error"]');
const retryButton = () =>
  alert()?.querySelector('button') as HTMLButtonElement | null;
const status = () => document.querySelector('[role="status"]');
const messageNode = () => alert()?.querySelector('.load-failed__message');
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

  expect(remote.refreshes(refreshed)).toBe(1);
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
    const { refreshed } = await retryOntoNewQuery(remote);

    // Both reads fail, as they do when the network is down. The stray one
    // has no reader: unhandled, it would fail this run.
    remote.fail(undefined, refreshed);
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

    expect(remote.refreshes(refreshed)).toBe(1);
    expect(remote.refreshes(remote.held())).toBe(0);
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

  test('a Retry that claimed nothing leaves no stale "still" behind', async () => {
    const remote = mountFailed(403);
    await retryOntoNewQuery(remote);
    remote.fail({ status: 403, body: { message: 'Forbidden' } });
    await settle();
    expect(alert()).toBeNull();

    // The page stops refusing, so the held query's failure shows again: as a
    // first failure, since no Retry of it has failed.
    if (harness) harness.refuseStatus = undefined;
    flushSync();

    expect(alert()?.textContent).toContain("We couldn't load it.");
    expect(alert()?.textContent).not.toContain("We still couldn't");
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

  test('with focus unmoved, a repeat failure focuses the alert and does not re-insert it', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);
    remote.fail();
    await settle();
    const before = messageNode();

    await retryOntoNewQuery(remote);
    remote.fail();
    await settle();

    // Focusing the alert reads it out; inserting it again as well would read
    // it twice.
    expect(document.activeElement?.classList.contains('load-failed')).toBe(
      true
    );
    expect(messageNode()).toBe(before);
  });

  test('with focus moved, a repeat failure leaves it there and re-reads the message', async () => {
    const remote = mountFailed();
    await retryOntoNewQuery(remote);
    remote.fail();
    await settle();
    const before = messageNode();

    await retryOntoNewQuery(remote);
    elsewhere().focus();
    remote.fail();
    await settle();

    expect(document.activeElement).toBe(elsewhere());
    // Same text as before, so `role="alert"` reads it out only if it is
    // inserted again.
    expect(messageNode()?.textContent).toContain("We still couldn't load it.");
    expect(messageNode()).not.toBe(before);
  });
});

describe('Retry, when the page keeps its query', () => {
  test("waits for that query's own read, in place", async () => {
    const remote = mountHarness();
    const query = remote.held();
    // The page refreshed it before its first read settled, so kit keeps it
    // in its cache when that read fails, and a Retry re-reads it in place.
    void query.refresh().catch(() => {});
    remote.fail();
    flushSync();
    expect(alert()).not.toBeNull();

    retryButton()?.focus();
    retryButton()?.click();
    await settle();
    expect(remote.held()).toBe(query);
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );

    remote.fail();
    await settle();
    expect(alert()?.textContent).toContain("We still couldn't load it.");

    retryButton()?.click();
    await settle();
    remote.land(LOADED);
    await settle();
    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
  });
});

describe("Retry, on a read from the page's load", () => {
  /** A load read whose first load failed, mounted as the creator list does. */
  function mountLoadRead(options?: {
    marksReloading?: boolean;
  }): LoadReadDouble<unknown> {
    const read = loadReadDouble<unknown>(options);
    component = mount(LoadFailedAlertHarness, {
      target: document.body,
      props: { remote: read },
    });
    flushSync();
    return read;
  }

  async function pressRetry() {
    retryButton()?.focus();
    retryButton()?.click();
    await settle();
  }

  test('keeps "Retrying…" until the reload lands, then says it loaded', async () => {
    const read = mountLoadRead();
    expect(alert()).not.toBeNull();

    await pressRetry();
    expect(read.refreshes()).toBe(1);
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );

    read.land(LOADED);
    await settle();
    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
    expect(document.activeElement).toBe(status());
  });

  test('a reload that fails again says so and focuses the alert', async () => {
    const read = mountLoadRead();
    await pressRetry();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );

    read.fail();
    await settle();
    expect(alert()?.textContent).toContain("We still couldn't load it.");
    expect(document.activeElement?.classList.contains('load-failed')).toBe(
      true
    );
  });

  test('waits for the reload when the page rebuilds the read to mark it', async () => {
    const read = mountLoadRead({ marksReloading: true });
    const before = read.get();

    await pressRetry();
    // A new read object, still failed, and no promise: judging it at once
    // would say "still" while the reload is in flight.
    expect(read.get()).not.toBe(before);
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(alert()?.textContent).not.toContain("We still couldn't");

    read.land(LOADED);
    await settle();
    expect(alert()).toBeNull();
    expect(document.activeElement).toBe(status());
  });

  test('a list that lands ends the Retry while other queries hold the refresh', async () => {
    const read = mountLoadRead();
    await pressRetry();

    // Kit's invalidate lands the data, then waits on the live remote queries.
    read.landBeforeQueries(LOADED);
    await settle();
    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
    expect(document.activeElement).toBe(status());

    read.queriesSettle();
    await settle();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
  });

  test('an overtaken reload keeps "Retrying…" until the run that overtook it lands', async () => {
    const read = mountLoadRead();
    await pressRetry();

    // A tab click or another invalidate overtook it: the data is unchanged.
    read.overtake();
    await settle();
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retrying()
    );
    expect(alert()?.textContent).not.toContain("We still couldn't");

    // The run that overtook it reloads the page.
    read.land(LOADED);
    await settle();
    expect(alert()).toBeNull();
    expect(status()?.textContent?.trim()).toBe('It loaded.');
    expect(document.activeElement).toBe(status());
  });
});

describe('the query prop', () => {
  test('takes a remote query as it is, or a load read, never a plain object', () => {
    const wrapped = {
      current: undefined,
      error: undefined,
      refresh: () => Promise.resolve(),
    };
    // A plain object wrapping a remote query would hide kit's query swap.
    // @ts-expect-error neither a remote query nor made by loadRead
    const prop: AlertRead = wrapped;
    expect(prop).toBe(wrapped);
  });

  test('loadRead takes no remote query', () => {
    const wrapKit = (query: KitRead<unknown>) =>
      // @ts-expect-error a remote query goes to the alert as it is
      loadRead(query);
    expect(typeof wrapKit).toBe('function');
  });
});
