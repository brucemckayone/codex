/**
 * PriceChangeNote's states as rendered (Codex-2hxff.85 M3, .86; batch C1
 * Part B page 4). The words are `priceChangeNotes()`'s, tested beside it;
 * these check what each state shows and offers: P2 and P9 nothing to press,
 * P4 a held count, P7 the warning tone and no button.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PriceChangeNote from './PriceChangeNote.svelte';
import type { PriceNoteView } from './price-note-view';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function view(over: Partial<PriceNoteView>): PriceNoteView {
  return {
    ids: ['c1'],
    key: 'pro:2026-10-30T14:12:00.000Z',
    icon: 'mail',
    tone: 'info',
    lead: 'Lead.',
    text: 'Text.',
    bar: null,
    counts: [],
    meta: null,
    action: null,
    lastRunAt: null,
    ...over,
  };
}

function render(props: Record<string, unknown>) {
  component = mount(PriceChangeNote, { target: document.body, props });
  flushSync();
  return document.querySelector<HTMLElement>(
    '[data-testid="price-change-note"]'
  );
}

describe('PriceChangeNote', () => {
  test('P2 and P9, before the first run: a note with nothing to press', () => {
    const note = render({
      view: view({ icon: 'clock', lead: 'New prices saved.' }),
    });
    expect(note?.getAttribute('role')).toBe('note');
    expect(note?.querySelector('b')?.textContent).toBe('New prices saved.');
    expect(note?.querySelectorAll('button')).toHaveLength(0);
    expect(note?.querySelector('[role="progressbar"]')).toBeNull();
  });

  test('P4: the held count is a number and words, never a name', () => {
    const note = render({
      view: view({
        counts: [
          { value: '22', label: 'emailed' },
          { value: '1', label: "couldn't be emailed" },
        ],
        action: 'dismiss',
      }),
      name: 'Pro',
    });
    const items = [...(note?.querySelectorAll('li') ?? [])].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(items).toEqual(['22 emailed', "1 couldn't be emailed"]);
    expect(note?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Dismiss the Pro price note'
    );
  });

  test('P7 paused: the warning tone, and nothing for the creator to press', () => {
    const note = render({ view: view({ icon: 'pause', tone: 'warning' }) });
    expect(note?.dataset.tone).toBe('warning');
    expect(note?.querySelectorAll('button')).toHaveLength(0);
  });

  test('a press while a read is out does nothing', () => {
    const onCheckAgain = vi.fn();
    const note = render({
      view: view({ action: 'check' }),
      busy: true,
      onCheckAgain,
    });
    note?.querySelector('button')?.click();
    expect(onCheckAgain).not.toHaveBeenCalled();
  });
});
