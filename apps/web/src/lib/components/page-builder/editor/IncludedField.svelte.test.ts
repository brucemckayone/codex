/**
 * The pricing section's "What's included" control (Codex-61zsk.73): the
 * course's own lines until the creator touches them, then rows whose
 * untouched facts stay live.
 */
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { CourseFacts } from '$lib/page-builder/kit/model/facts';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import IncludedField from './IncludedField.svelte';

/** 6 stages, 24 practices, 18 videos and 6 audio, 5 hr 40 min of them. */
const FACTS: CourseFacts = {
  stages: 6,
  practices: 24,
  seconds: (5 * 60 + 40) * 60,
  kinds: { video: 18, audio: 6, written: 0 },
};

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

/** Mount with a parent that writes `onChange` back, as the inspector does. */
function render(
  initial: unknown,
  options: { facts?: CourseFacts; shown?: boolean } = {}
) {
  const state = $state({ value: initial });
  const writes: unknown[] = [];
  app = mount(IncludedField, {
    target: document.body,
    props: {
      get value() {
        return state.value;
      },
      facts: options.facts ?? FACTS,
      shown: options.shown ?? true,
      onChange: (next: unknown) => {
        writes.push(next);
        state.value = next;
      },
    },
  });
  flushSync();
  return { writes, state };
}

const inputs = () => [
  ...document.body.querySelectorAll<HTMLTextAreaElement>('.included__input'),
];
const values = () => inputs().map((input) => input.value);
const tags = () =>
  [...document.body.querySelectorAll('.included__tag')].map((tag) =>
    tag.textContent?.trim()
  );
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  );
const toggle = () =>
  document.body.querySelector<HTMLButtonElement>('[role="switch"]');

function type(input: HTMLTextAreaElement | undefined, text: string): void {
  if (!input) throw new Error('no such line');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('IncludedField — the course’s own lines, until touched', () => {
  it('shows the lines the canvas draws, every one live, and nothing to reset', () => {
    render(undefined);
    expect(values()).toEqual([
      '6 stages',
      '24 practices',
      '5 hr 40 min of video and audio',
      '18 videos · 6 audio',
    ]);
    expect(new Set(tags())).toEqual(
      new Set([m.studio_page_editor_included_live()])
    );
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(button(m.studio_page_editor_included_reset())).toBeUndefined();
  });

  it('writes nothing by being shown, whatever is stored', () => {
    // `Switch` reports its state as it syncs, on mount too: a list that is
    // already on must not be "switched on" again over the creator's rows.
    for (const stored of [undefined, [], [{ fact: 'stages' }]]) {
      const { writes } = render(stored);
      expect(writes, JSON.stringify(stored)).toEqual([]);
      unmount(app);
      app = null;
    }
  });

  it('writes the lines out on the first edit, the untouched ones still live', () => {
    const { writes } = render(undefined);
    type(inputs()[2], 'Nearly six hours of guided practice');
    expect(writes.at(-1)).toEqual([
      { fact: 'stages' },
      { fact: 'practices' },
      { fact: 'length', text: 'Nearly six hours of guided practice' },
      { fact: 'mix' },
    ]);
    expect(tags()[2]).toBe(m.studio_page_editor_included_rewritten());
    expect(document.body.textContent).toContain(
      m.studio_page_editor_included_course_says({
        line: '5 hr 40 min of video and audio',
      })
    );
  });

  it('makes a rewritten line live again, by its button or by typing the course’s words back', async () => {
    const { writes } = render([{ fact: 'stages', text: 'Six stages' }]);
    button(m.studio_page_editor_included_relive())?.click();
    flushSync();
    await tick();
    expect(writes.at(-1)).toEqual([{ fact: 'stages' }]);

    type(inputs()[0], 'Six stages');
    type(inputs()[0], '6 stages');
    expect(writes.at(-1)).toEqual([{ fact: 'stages' }]);
  });

  it('adds a line of the creator’s own, ready to type into', async () => {
    const { writes } = render([{ fact: 'stages' }]);
    button(m.studio_page_editor_included_add())?.click();
    flushSync();
    await tick();
    expect(writes.at(-1)).toEqual([{ fact: 'stages' }, { text: '' }]);
    expect(document.activeElement).toBe(inputs()[1]);
    type(inputs()[1], 'Printable workbook');
    expect(writes.at(-1)).toEqual([
      { fact: 'stages' },
      { text: 'Printable workbook' },
    ]);
    expect(tags()).toEqual([
      m.studio_page_editor_included_live(),
      m.studio_page_editor_included_own(),
    ]);
  });

  it('deletes a line, and deleting the last switches the list off', () => {
    const { writes } = render([{ fact: 'stages' }, { text: 'Workbook' }]);
    // A row's remove button is named by its line.
    const remove = (line: string) =>
      document.body.querySelector<HTMLButtonElement>(
        `button[aria-label="${m.studio_page_editor_row_remove({ item: line })}"]`
      );
    remove('6 stages')?.click();
    flushSync();
    expect(writes.at(-1)).toEqual([{ text: 'Workbook' }]);
    remove('Workbook')?.click();
    flushSync();
    expect(writes.at(-1)).toEqual([]);
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(document.body.textContent).toContain(
      m.studio_page_editor_included_off()
    );
  });

  it('switches the list off, and back on to the same lines', () => {
    const rows = [{ fact: 'stages' }, { text: 'Workbook' }];
    const { writes } = render(rows);
    toggle()?.click();
    flushSync();
    expect(writes.at(-1)).toEqual([]);
    expect(inputs()).toEqual([]);
    toggle()?.click();
    flushSync();
    expect(writes.at(-1)).toEqual(rows);
  });

  it('switches a stored-off list back on as the course’s own lines', () => {
    const { writes } = render([]);
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    toggle()?.click();
    flushSync();
    expect(writes.at(-1)).toBeUndefined();
    expect(values()).toHaveLength(4);
  });

  it('resets to the course’s lines by taking the key away', () => {
    const { writes } = render([{ text: 'Workbook' }]);
    button(m.studio_page_editor_included_reset())?.click();
    flushSync();
    expect(writes).toEqual([undefined]);
    expect(values()).toEqual([
      '6 stages',
      '24 practices',
      '5 hr 40 min of video and audio',
      '18 videos · 6 audio',
    ]);
  });

  it('says when a live line has nothing to show yet, and where the list shows', () => {
    render([{ fact: 'length' }], {
      facts: { ...FACTS, seconds: null },
      shown: false,
    });
    expect(values()).toEqual(['']);
    expect(document.body.textContent).toContain(
      m.studio_page_editor_included_waiting_length()
    );
    expect(document.body.textContent).toContain(
      m.studio_page_editor_included_elsewhere()
    );
  });

  it('shows a long line whole, and keeps it one line', () => {
    // A wrapping field, so "2 hr 10 min of video and audio" is never cut
    // off; but the page draws a line as one, so Enter adds no break and a
    // pasted one is a space.
    const { writes } = render([{ text: 'Printable workbook' }]);
    const [field] = inputs();
    expect(field?.tagName).toBe('TEXTAREA');
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    field?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    type(field, 'Printable\nworkbook  \r\n and notes');
    expect(writes.at(-1)).toEqual([{ text: 'Printable workbook and notes' }]);
  });
});
