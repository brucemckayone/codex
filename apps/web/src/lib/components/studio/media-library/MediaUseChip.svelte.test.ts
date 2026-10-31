/**
 * The library chip (Codex-6sbn1, owner round 2 decision 2, variant A): tinted
 * with a lock when anything published uses the item, grey with a link when
 * only drafts do (never colour alone, and the name says how many are
 * published), a muted "Not in use" when nothing does, and nothing at all when
 * the worker didn't send the count (never a false "Not in use"). Its popover
 * says "Not in use" when a fresh read finds the uses gone, and on a phone its
 * scrim takes the tap that closes it.
 */
import type { MediaUsage } from '@codex/shared-types';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const read = vi.hoisted(() => ({
  current: undefined as MediaUsage | undefined,
}));

vi.mock('$lib/remote/media.remote', () => ({
  getMediaUsage: vi.fn(() => ({
    current: read.current,
    error: undefined,
    loading: read.current === undefined,
    refresh: vi.fn(),
  })),
}));

const MediaUseChip = (await import('./MediaUseChip.svelte')).default;
const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

let component: ReturnType<typeof mount> | null = null;

function render(props: ComponentProps<typeof MediaUseChip>) {
  component = mount(MediaUseChip, { target: document.body, props });
  flushSync();
}

function chip(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button.use-chip');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  if (component) unmount(component);
  component = null;
  read.current = undefined;
  document.body.innerHTML = '';
});

describe('MediaUseChip', () => {
  test('no count from the worker: draws nothing', () => {
    render({ mediaId: MEDIA_ID });
    expect(document.body.textContent?.trim()).toBe('');
    expect(document.querySelector('.use-row')).toBeNull();
  });

  test('nothing uses it: "Not in use", and no button', () => {
    render({ mediaId: MEDIA_ID, usage: { total: 0, live: 0 } });
    expect(document.querySelector('.use-none')?.textContent).toBe('Not in use');
    expect(document.querySelector('button')).toBeNull();
  });

  test('something published uses it: tinted, a lock, and the name says how many are published', () => {
    render({ mediaId: MEDIA_ID, usage: { total: 5, live: 4 } });
    expect(chip()?.textContent).toContain('In use by 5');
    expect(chip()?.dataset.tone).toBe('live');
    expect(chip()?.getAttribute('aria-label')).toBe(
      'In use by 5, 4 published. Show where'
    );
    expect(chip()?.getAttribute('aria-haspopup')).toBe('dialog');
    // The lock (its body is the one <rect>), not the link: a mark that isn't colour.
    expect(chip()?.querySelector('svg rect')).not.toBeNull();
  });

  test('only drafts use it: grey, a link, and the name says drafts only', () => {
    render({ mediaId: MEDIA_ID, usage: { total: 2, live: 0 } });
    expect(chip()?.textContent).toContain('In use by 2');
    expect(chip()?.dataset.tone).toBe('draft');
    expect(chip()?.getAttribute('aria-label')).toBe(
      'In use by 2, drafts only. Show where'
    );
    expect(chip()?.querySelector('svg rect')).toBeNull();
  });

  test('a fresh read that finds no uses says "Not in use", not "In use by 0"', async () => {
    read.current = {
      total: 0,
      live: 0,
      drafts: 0,
      hidden: 0,
      uses: [],
      fingerprint: 'fp',
    };
    render({ mediaId: MEDIA_ID, usage: { total: 1, live: 0 } });
    chip()?.click();
    await tick();
    flushSync();

    const pop = document.querySelector('.uses-pop');
    expect(pop?.querySelector('.uses-pop__title')?.textContent?.trim()).toBe(
      'Not in use'
    );
    expect(pop?.textContent).toContain(
      'Nothing uses it any more, so it can be deleted.'
    );
    expect(pop?.textContent).not.toContain('In use by 0');
    expect(pop?.querySelector('.uses-pop__foot')).toBeNull();
  });

  test('a tap on the scrim closes the popover', async () => {
    render({ mediaId: MEDIA_ID, usage: { total: 2, live: 0 } });
    chip()?.click();
    await tick();
    flushSync();
    const scrim = document.querySelector<HTMLElement>('.uses-pop__scrim');
    expect(scrim).not.toBeNull();
    const pop = () => document.querySelector<HTMLElement>('.uses-pop');
    expect(pop()?.inert).toBeFalsy();

    scrim?.click();
    await tick();
    flushSync();
    // Closed = gone, or leaving: Svelte makes a panel `inert` as its exit
    // starts (jsdom never ends one). Never the trigger's `aria-expanded`:
    // under the Popover's default `forceVisible` Melt derives that from
    // visibility, so it reads "true" open or closed.
    const panel = pop();
    expect(panel === null || panel.inert).toBe(true);
  });
});
