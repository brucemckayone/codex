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
 * empty-state / reorder / edit / delete behaviour is falsifiable in isolation.
 */

const sample: StudioCategory[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Interviews',
    slug: 'interviews',
    description: 'Long-form conversations',
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
      props: { categories: [], onedit: noop, ondelete: noop, onmove: noop },
    });

    expect(document.body.textContent).toContain('No categories yet');
    expect(document.querySelectorAll('.category-row').length).toBe(0);
  });

  test('renders a row per category with name, slug and order index', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: { categories: sample, onedit: noop, ondelete: noop, onmove: noop },
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
      props: { categories: sample, onedit: noop, ondelete: noop, onmove: noop },
    });

    const img = document.querySelector<HTMLImageElement>('.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe(sample[0].coverImageUrl);
    // No "Cover set" badge when the image can actually render.
    expect(document.querySelectorAll('.category-badge').length).toBe(0);
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
      props: { categories: noUrl, onedit: noop, ondelete: noop, onmove: noop },
    });

    const badges = Array.from(document.querySelectorAll('.category-badge'));
    expect(badges.length).toBe(1);
    expect(badges[0]?.textContent).toContain('Cover set');
    expect(document.querySelector('.cover-image')).toBeNull();
  });

  test('disables reorder up on the first row and down on the last', () => {
    component = mount(CategoryList, {
      target: document.body,
      props: { categories: sample, onedit: noop, ondelete: noop, onmove: noop },
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
      props: { categories: sample, onedit: noop, ondelete: noop, onmove },
    });

    const upSecond = document.querySelector<HTMLButtonElement>(
      '[aria-label="Move Essays up"]'
    );
    upSecond?.click();
    flushSync();

    expect(onmove).toHaveBeenCalledWith(1, -1);
  });

  test('invokes onedit with the row category', () => {
    const onedit = vi.fn();
    component = mount(CategoryList, {
      target: document.body,
      props: { categories: sample, onedit, ondelete: noop, onmove: noop },
    });

    const editButton = document
      .querySelectorAll('.category-row')[0]
      ?.querySelector<HTMLButtonElement>('.row-actions button');
    editButton?.click();
    flushSync();

    expect(onedit).toHaveBeenCalledWith(
      expect.objectContaining({ id: sample[0].id })
    );
  });

  test('invokes ondelete with the row category', () => {
    const ondelete = vi.fn();
    component = mount(CategoryList, {
      target: document.body,
      props: { categories: sample, onedit: noop, ondelete, onmove: noop },
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
