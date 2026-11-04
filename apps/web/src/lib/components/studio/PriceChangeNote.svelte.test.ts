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

  /** A note whose Check again goes out as the pages' reads do: busy while out. */
  function mountChecking() {
    const onCheckAgain = vi.fn();
    const onDismiss = vi.fn();
    const props = $state<Record<string, unknown>>({
      view: view({ action: 'check' }),
      name: 'Pro',
      busy: false,
      onCheckAgain,
      onDismiss,
    });
    onCheckAgain.mockImplementation(() => {
      props.busy = true;
    });
    component = mount(PriceChangeNote, { target: document.body, props });
    flushSync();
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="price-change-note"] button'
    );
    const status = document.querySelector<HTMLElement>(
      '[data-testid="price-note-status"]'
    );
    expect(button).not.toBeNull();
    expect(status).not.toBeNull();
    /** The read lands with `next`. */
    const land = (next: PriceNoteView) => {
      props.view = next;
      props.busy = false;
      flushSync();
    };
    return { props, button, status, land, onCheckAgain, onDismiss };
  }

  test('a Check again that finds it done: Dismiss in place, focus on the status line (W6, C2-W6)', () => {
    const { button, status, land, onCheckAgain, onDismiss } = mountChecking();
    button?.focus();
    button?.click();
    flushSync();
    expect(onCheckAgain).toHaveBeenCalledOnce();

    land(view({ icon: 'mail', action: 'dismiss' }));
    const after = document.querySelector<HTMLButtonElement>(
      '[data-testid="price-change-note"] button'
    );
    expect(after).toBe(button);
    expect(after?.textContent?.trim()).toBe('Dismiss');
    expect(document.activeElement).toBe(status);

    // A second press lands on the words, not on Dismiss.
    (document.activeElement as HTMLElement).click();
    expect(onDismiss).not.toHaveBeenCalled();
    after?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });

  test('a Check again that finds it still going keeps focus; a later read that finishes it moves nothing (C2-W6)', () => {
    const { props, button, land } = mountChecking();
    button?.focus();
    button?.click();
    flushSync();
    land(view({ action: 'check', meta: 'Checked just now.' }));
    expect(document.activeElement).toBe(button);

    // Another note's Check again goes out, and its read finishes this one.
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    props.busy = true;
    flushSync();
    land(view({ icon: 'mail', action: 'dismiss' }));
    expect(document.activeElement).toBe(elsewhere);
  });

  test('a note that opens done takes no focus (C2-W6)', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    render({ view: view({ action: 'dismiss' }), name: 'Pro' });
    expect(document.activeElement).toBe(outside);
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
