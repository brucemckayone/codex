import { afterEach, describe, expect, test, vi } from 'vitest';
import type { StudioCategory } from '$lib/remote/categories.types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import CategoryList from './CategoryList.svelte';

/**
 * CategoryList unit tests.
 *
 * CategoryList is the presentational half of the studio categories page — pure
 * props + callbacks, no remote imports — so it renders in jsdom and its list /
 * empty-state / reorder / select / delete behaviour is falsifiable in isolation.
 */

const sample: StudioCategory[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Interviews',
    slug: 'interviews',
    description: 'Long-form conversations',
    // Still stored on the row (the column is untouched) — the list must NOT
    // render it; the emoji is exactly what this redesign removes.
    icon: '🎙️',
    coverImageKey: 'categories/aaaa/cover',
    coverImageUrl: 'https://cdn.example.test/categories/aaaa/cover/md.webp',
    sortOrder: 0,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'Essays',
    slug: 'essays',
    description: null,
    icon: null,
    coverImageKey: null,
    coverImageUrl: null,
    sortOrder: 1,
  },
];

function noop() {}

/** The three required callbacks, defaulted, so tests name only what they assert. */
function props(overrides: Record<string, unknown> = {}) {
  return {
    categories: sample,
    onselect: noop,
    ondelete: noop,
    onmove: noop,
    ...overrides,
  };
}

describe('CategoryList', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders the empty state when there are no categories', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props({ categories: [] }),
    });

    expect(document.body.textContent).toContain('No topics yet');
    expect(document.querySelectorAll('.category-row').length).toBe(0);
  });

  test('renders a row per category with name, slug and order index', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props(),
    });

    const rows = document.querySelectorAll('.category-row');
    expect(rows.length).toBe(2);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Interviews');
    expect(text).toContain('/interviews');
    expect(text).toContain('Essays');
    expect(text).toContain('/essays');
    expect(text).toContain('Long-form conversations');

    // Order indices are rendered 1-based.
    const indices = Array.from(document.querySelectorAll('.order-index')).map(
      (el) => el.textContent
    );
    expect(indices).toEqual(['1', '2']);
  });

  test('renders the cover image when coverImageUrl is present', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props(),
    });

    const img = document.querySelector<HTMLImageElement>('.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe(sample[0].coverImageUrl);
    // No badge on the row whose image can actually render.
    const firstRow = document.querySelectorAll('.category-row')[0];
    expect(firstRow?.querySelectorAll('.category-badge').length).toBe(0);
  });

  test('falls back to the topic initial — never the stored emoji', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props(),
    });

    // Row 2 has no cover: the thumb shows "E" for Essays.
    const initials = Array.from(
      document.querySelectorAll('.cover-initial')
    ).map((el) => el.textContent);
    expect(initials).toEqual(['E']);

    // Row 1 carries icon '🎙️' in its data; it must appear nowhere in the DOM.
    expect(document.body.textContent).not.toContain('🎙️');
    expect(document.querySelector('.cover-glyph')).toBeNull();
  });

  test('flags a coverless row so the gap is visible while scanning', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props(),
    });

    const secondRow = document.querySelectorAll('.category-row')[1];
    expect(secondRow?.querySelector('.category-badge')?.textContent).toContain(
      'No cover'
    );
  });

  test('shows a "Cover set" badge when a cover exists but has no resolved URL', () => {
    const noUrl: StudioCategory[] = [
      {
        ...sample[1],
        coverImageKey: 'categories/cccc/cover',
        coverImageUrl: null,
      },
    ];
    component = mount(CategoryList, {
      target: document.body,
      props: props({ categories: noUrl }),
    });

    const badges = Array.from(document.querySelectorAll('.category-badge'));
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toContain('Cover set');
    expect(document.querySelector('.cover-image')).toBeNull();
  });

  test('disables reorder up on the first row and down on the last', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props(),
    });

    const upFirst = document.querySelector<HTMLButtonElement>(
      '[aria-label="Move Interviews up"]'
    );
    const downLast = document.querySelector<HTMLButtonElement>(
      '[aria-label="Move Essays down"]'
    );
    expect(upFirst?.disabled).toBe(true);
    expect(downLast?.disabled).toBe(true);
  });

  test('invokes onmove when a reorder control is clicked', () => {
    const onmove = vi.fn();
    component = mount(CategoryList, {
      target: document.body,
      props: props({ onmove }),
    });

    const upSecond = document.querySelector<HTMLButtonElement>(
      '[aria-label="Move Essays up"]'
    );
    upSecond?.click();
    flushSync();

    expect(onmove).toHaveBeenCalledWith(1, -1);
  });

  // NOTE: there is deliberately no test for "reorder controls are not nested
  // inside the selector". Svelte refuses to compile a <button> inside a
  // <button> (node_invalid_placement), so such a test could never fail — the
  // compiler is the guard. What IS worth locking is that the selector stays a
  // real <button> rather than a div with a click handler, which is asserted
  // below.
  test('the row selector is a button that invokes onselect with its category', () => {
    const onselect = vi.fn();
    component = mount(CategoryList, {
      target: document.body,
      props: props({ onselect }),
    });

    const selector = document
      .querySelectorAll('.category-row')[0]
      ?.querySelector<HTMLButtonElement>('.category-select');
    expect(selector?.tagName).toBe('BUTTON');
    selector?.click();
    flushSync();

    expect(onselect).toHaveBeenCalledWith(
      expect.objectContaining({ id: sample[0].id })
    );
  });

  test('announces the selected row via aria-pressed', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: props({ activeId: sample[1].id }),
    });

    const pressed = Array.from(
      document.querySelectorAll('.category-select')
    ).map((el) => el.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true']);
  });

  test('invokes ondelete with the row category', () => {
    const ondelete = vi.fn();
    component = mount(CategoryList, {
      target: document.body,
      props: props({ ondelete }),
    });

    const deleteButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Delete Interviews"]'
    );
    deleteButton?.click();
    flushSync();

    expect(ondelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: sample[0].id })
    );
  });
});
