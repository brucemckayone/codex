/**
 * The library chip's looks (Codex-6sbn1, owner round 2 decision 2, variant A):
 * tinted when anything published uses the item, grey when only drafts do, a
 * muted "Not in use" when nothing does, and nothing at all when the worker
 * didn't send the count (never a false "Not in use").
 */
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$lib/remote/media.remote', () => ({
  getMediaUsage: vi.fn(() => ({
    current: undefined,
    error: undefined,
    loading: true,
  })),
}));

const MediaUseChip = (await import('./MediaUseChip.svelte')).default;
const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

let component: ReturnType<typeof mount> | null = null;

function render(props: ComponentProps<typeof MediaUseChip>) {
  component = mount(MediaUseChip, { target: document.body, props });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
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

  test('something published uses it: the tinted chip', () => {
    render({ mediaId: MEDIA_ID, usage: { total: 5, live: 4 } });
    const chip = document.querySelector<HTMLButtonElement>('button.use-chip');
    expect(chip?.textContent).toContain('In use by 5');
    expect(chip?.dataset.tone).toBe('live');
    expect(chip?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  test('only drafts use it: the grey chip', () => {
    render({ mediaId: MEDIA_ID, usage: { total: 2, live: 0 } });
    const chip = document.querySelector<HTMLButtonElement>('button.use-chip');
    expect(chip?.textContent).toContain('In use by 2');
    expect(chip?.dataset.tone).toBe('draft');
  });
});
