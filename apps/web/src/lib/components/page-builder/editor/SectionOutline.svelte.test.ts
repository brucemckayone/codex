import type { PageSection } from '@codex/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionOutline from './SectionOutline.svelte';

const SECTIONS: PageSection[] = [
  { id: 'a', type: 'hero', enabled: true, props: {} },
  { id: 'b', type: 'problem', enabled: false, props: {} },
  { id: 'c', type: 'faq', enabled: true, name: 'Common worries', props: {} },
];

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function render(overrides: Record<string, unknown> = {}) {
  const props = {
    sections: SECTIONS,
    selectedId: 'a',
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
  app = mount(SectionOutline, { target: document.body, props });
  flushSync();
  const rows = [
    ...document.querySelectorAll<HTMLButtonElement>('.outline__main'),
  ];
  return { props, rows };
}

function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  );
  flushSync();
}

describe('SectionOutline', () => {
  it('lists plain names, the creator’s own name first, and marks hidden sections', () => {
    const { rows } = render();
    expect(
      rows.map((r) => r.querySelector('.outline__label')?.textContent)
    ).toEqual(['Hero', 'The problem', 'Common worries']);
    expect(rows[1].textContent).toContain('Hidden');
    expect(
      document.querySelectorAll('.outline__row')[1].hasAttribute('data-hidden')
    ).toBe(true);
  });

  it('is one tab stop, on the selected row', () => {
    const { rows } = render({ selectedId: 'c' });
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('selects on click and with the arrow keys', () => {
    const { props, rows } = render();
    rows[2].click();
    expect(props.onSelect).toHaveBeenLastCalledWith('c');
    key(rows[0], 'ArrowDown');
    expect(props.onSelect).toHaveBeenLastCalledWith('b');
    key(rows[0], 'End');
    expect(props.onSelect).toHaveBeenLastCalledWith('c');
  });

  it('moves the section with Alt + arrow and announces it', () => {
    const { props, rows } = render();
    key(rows[0], 'ArrowDown', { altKey: true });
    expect(props.onMove).toHaveBeenCalledWith('a', 1);
    expect(document.querySelector('.outline__live')?.textContent).toBe(
      'Hero moved to position 2 of 3'
    );
    key(rows[0], 'ArrowUp', { altKey: true });
    // Already first: nothing to move past.
    expect(props.onMove).toHaveBeenCalledTimes(1);
  });

  it('shows and hides a section', () => {
    const { props } = render();
    const tools = [
      ...document.querySelectorAll<HTMLButtonElement>('.outline__tool'),
    ];
    const show = tools.find(
      (t) => t.getAttribute('aria-label') === 'Show The problem'
    );
    show?.click();
    expect(props.onToggle).toHaveBeenCalledWith('b');
  });

  it('adds a section from the bottom of the list', () => {
    const { props } = render();
    document.querySelector<HTMLButtonElement>('.outline__add')?.click();
    expect(props.onAdd).toHaveBeenCalled();
  });
});
