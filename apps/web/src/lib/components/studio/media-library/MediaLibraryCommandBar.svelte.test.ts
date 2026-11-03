/**
 * The command bar's live chip (Codex-a6ofh.1.3): once the fallback has spent
 * its refetches it reads "Live progress paused" and offers Refresh, the only
 * thing that starts it again on this page.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MediaStatusConnection } from '$lib/client/media-status.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import MediaLibraryCommandBar from './MediaLibraryCommandBar.svelte';

let component: ReturnType<typeof mount> | null = null;

function render(live: MediaStatusConnection, onLiveResume = vi.fn()) {
  component = mount(MediaLibraryCommandBar, {
    target: document.body,
    props: {
      live,
      onLiveResume,
      onUploadClick: vi.fn(),
    },
  });
  flushSync();
  return onLiveResume;
}

const chip = () => document.querySelector('.live-chip');
const refresh = () =>
  document.querySelector<HTMLButtonElement>('button.live-resume');

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('MediaLibraryCommandBar live chip', () => {
  test('paused: says so in a status region, and Refresh starts it again', async () => {
    const onLiveResume = render('paused');
    expect(chip()?.textContent?.trim()).toBe('Live progress paused');
    expect(chip()?.getAttribute('data-state')).toBe('paused');
    expect(chip()?.closest('[role="status"]')).not.toBeNull();

    refresh()?.focus();
    refresh()?.click();
    expect(onLiveResume).toHaveBeenCalledTimes(1);
    // Refresh is about to go: focus moves to the status it changed.
    await tick();
    expect(document.activeElement).toBe(chip()?.closest('.live-status'));
  });

  test.each([
    'idle',
    'connecting',
  ] as const)('%s: no chip at all (a first connect is quiet)', (live) => {
    render(live);
    expect(chip()).toBeNull();
    expect(refresh()).toBeNull();
  });

  test.each([
    'live',
    'polling',
    'reconnecting',
    'stopped',
  ] as const)('%s: no Refresh, since something is still running or a reload is the answer', (live) => {
    render(live);
    expect(chip()).not.toBeNull();
    expect(refresh()).toBeNull();
  });
});
