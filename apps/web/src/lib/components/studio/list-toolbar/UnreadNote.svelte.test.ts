/**
 * The word on a list read that failed (Codex-a6ofh.3.3, owner): a phone sheet
 * facet's, and the content list's "Needs you". What failed, then "Trying
 * again…" while a Try again runs, then the failed-again words if it fails
 * too. Its state is the caller's (`createFacetRetry`), so a sheet closed
 * mid-retry reopens on it.
 */
import { afterEach, describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { createFacetRetry } from './facet-retry.svelte';
import UnreadNote from './UnreadNote.svelte';

let component: ReturnType<typeof mount> | null = null;

function close() {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
}

afterEach(close);

const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const words = () =>
  document.querySelector('[role="status"]')?.textContent?.trim();
const retryButton = () =>
  document.querySelector<HTMLButtonElement>('.unread-note-retry');

/** An unread facet whose each Try again waits for the test to settle it. */
function unreadFacet() {
  const reads: Array<{ ok: () => void; fail: (error: unknown) => void }> = [];
  const unread = createFacetRetry({
    failed: () => 'Couldn’t load the things.',
    failedAgain: () => 'Still couldn’t load the things.',
    read: () =>
      new Promise<void>((ok, fail) => {
        reads.push({ ok, fail });
      }),
  });
  return { reads, unread };
}

function open(unread: ReturnType<typeof unreadFacet>['unread']) {
  component = mount(UnreadNote, {
    target: document.body,
    props: { unread },
  });
  flushSync();
}

describe('UnreadNote', () => {
  test('says what failed, with a Try again', () => {
    const { unread } = unreadFacet();
    open(unread);
    expect(words()).toBe('Couldn’t load the things.');
    expect(retryButton()?.textContent?.trim()).toBe(m.common_try_again());
  });

  test('says it is trying, once at a time, then that it failed again', async () => {
    const { unread, reads } = unreadFacet();
    open(unread);

    retryButton()?.click();
    retryButton()?.click();
    flushSync();
    expect(reads).toHaveLength(1);
    expect(words()).toBe(m.studio_list_facet_retrying());
    expect(retryButton()?.getAttribute('aria-busy')).toBe('true');

    reads[0]?.fail(new Error('still down'));
    await settle();
    expect(words()).toBe('Still couldn’t load the things.');
    expect(retryButton()?.getAttribute('aria-busy')).toBe('false');
  });

  test('a sheet closed mid-retry reopens on it, and sends no second read', async () => {
    const { unread, reads } = unreadFacet();
    open(unread);
    retryButton()?.click();
    flushSync();
    close();

    open(unread);
    expect(words()).toBe(m.studio_list_facet_retrying());
    retryButton()?.click();
    flushSync();
    expect(reads).toHaveLength(1);

    reads[0]?.fail(new Error('still down'));
    await settle();
    close();
    open(unread);
    expect(words()).toBe('Still couldn’t load the things.');
  });
});
