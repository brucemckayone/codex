/**
 * Studio categories: adding a topic must leave you ready to add the NEXT one
 * (Codex-1g5lh.7).
 *
 * THE BUG. The create-success `$effect` used to do `selectedId = r.category.id`,
 * on the theory that a cover upload was the obvious next step and covers can
 * only be attached to a row that exists. The inspector is a SINGLE pane whose
 * mode derives from that selection, so the effect silently converted the "New
 * topic" add form into an "Edit topic" form for the row just inserted. A creator
 * laying out their taxonomy in one sitting — the common path — then typed their
 * second topic into an edit form and RENAMED THE FIRST. Reported verbatim as
 * "it feels broken as I'm trying to add more than one serially but it's editing
 * the one just inserted".
 *
 * WHY THE PAGE AND NOT A HELPER. The defect was in the wiring between a form
 * result and a piece of page state; a unit test of an extracted function would
 * pass in both worlds. So this mounts the real `+page.svelte` with the real
 * inspector, the real `CategoryList`, and the real `TopicCard` preview, and
 * mocks only `$lib/remote/categories.remote` (which imports `$app/server` and
 * cannot load in jsdom).
 *
 * `landCreateSuccess()` reproduces production faithfully: the server-side list
 * query refreshes so the new row appears, and `form.result` flips to
 * `{ success: true, category }` with `pending` back at 0 — the exact two inputs
 * the page's effect reads.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$lib/remote/categories.remote',
  () => import('./__fixtures__/categories-remote.mock.svelte')
);

import CategoriesPage from '../+page.svelte';
import type { MockCategory } from './__fixtures__/categories-remote.mock.svelte';
import {
  landCreateFailure,
  landCreateSuccess,
  reset,
  seedCreateResult,
  setCategories,
} from './__fixtures__/categories-remote.mock.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function category(overrides: Partial<MockCategory> = {}): MockCategory {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Breathwork',
    slug: 'breathwork',
    description: null,
    icon: null,
    coverImageKey: null,
    coverImageUrl: null,
    sortOrder: 0,
    ...overrides,
  };
}

function mountPage(categories: MockCategory[] = []) {
  setCategories(categories);
  return mount(CategoriesPage, {
    target: document.body,
    props: {
      data: {
        orgId: ORG_ID,
        categories,
        org: { name: 'Studio Alpha' },
      },
    },
  });
}

/** The inspector heading — "New topic" in add mode, "Edit topic" in edit mode. */
function inspectorHeading(): string {
  const el = document.getElementById('cats-inspector-heading');
  if (!el) throw new Error('inspector heading not rendered');
  return el.textContent?.trim() ?? '';
}

/** Present only in add mode; the edit form uses `#editName`. */
function createNameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('#createName');
}

function editNameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('#editName');
}

/** Type into a bound input the way a user does (so `bind:value` follows). */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** Row selectors carry `aria-pressed` — true only for the inspected row. */
function pressedRowCount(): number {
  return document.querySelectorAll('[aria-pressed="true"]').length;
}

describe('studio categories — serial topic entry (Codex-1g5lh.7)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reset();
    // jsdom gap, not a convenience: it implements no scrolling at all, so
    // `Element.prototype.scrollIntoView` is absent. The page's
    // `revealInspector()` calls it when the inspector is entirely off-screen —
    // and in jsdom EVERY rect is all-zeros, so `rect.bottom <= 0` reads as
    // off-screen and the real code path is reached on a manual row select.
    // Without the stub that throws as an unhandled error mid-test.
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    reset();
  });

  test('a successful insert leaves the inspector in an EMPTY ADD state', () => {
    component = mountPage();
    flushSync();

    const nameInput = createNameInput();
    expect(nameInput, 'the add form is not rendered on a fresh page').not.toBe(
      null
    );
    type(nameInput as HTMLInputElement, 'Breathwork');
    expect((createNameInput() as HTMLInputElement).value).toBe('Breathwork');

    landCreateSuccess(category());
    flushSync();

    // Still the ADD form, not an edit form for the row just inserted.
    expect(
      inspectorHeading(),
      'the inspector flipped to Edit topic — the next topic typed here would rename the one just added'
    ).toBe('New topic');
    expect(
      createNameInput(),
      'the add form was replaced by the edit form after a successful insert'
    ).not.toBe(null);
    expect(
      editNameInput(),
      'the edit form rendered after a successful insert — selection moved to the new row'
    ).toBe(null);

    // …and it is EMPTY, ready for the next name.
    expect(
      (createNameInput() as HTMLInputElement).value,
      'the add form kept the name that was just submitted'
    ).toBe('');
  });

  test('selection does not move to the newly inserted row', () => {
    component = mountPage();
    flushSync();

    landCreateSuccess(category());
    flushSync();

    // Liveness witness: the new row really did reach the list, so "no row is
    // selected" is a statement about selection and not about an empty list.
    expect(
      document.querySelectorAll('.category-select').length,
      'the inserted category never appeared in the list — the assertion below would be vacuous'
    ).toBe(1);
    expect(
      pressedRowCount(),
      'a list row reports itself selected — the insert moved the inspector onto it (Codex-1g5lh.7)'
    ).toBe(0);
    // The old effect seeded the selection inline precisely to avoid going
    // through `selectRow()`, so it never scrolled — but a future "helpful"
    // re-selection would, and moving the page under a creator mid-entry is the
    // same class of bug as the one this bead names.
    expect(
      scrollIntoView,
      'a successful insert scrolled the page — the creator was moved without asking'
    ).not.toHaveBeenCalled();
  });

  test('two topics added back to back both survive', () => {
    // The regression in user terms: the second name must create a SECOND row,
    // not rename the first.
    component = mountPage();
    flushSync();

    type(createNameInput() as HTMLInputElement, 'Breathwork');
    landCreateSuccess(category());
    flushSync();

    type(createNameInput() as HTMLInputElement, 'Cold exposure');
    expect(inspectorHeading()).toBe('New topic');
    landCreateSuccess(
      category({
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Cold exposure',
        slug: 'cold-exposure',
        sortOrder: 1,
      })
    );
    flushSync();

    const rowNames = [...document.querySelectorAll('.category-name')].map(
      (el) => el.textContent?.trim()
    );
    expect(rowNames).toEqual(['Breathwork', 'Cold exposure']);
    expect(pressedRowCount()).toBe(0);
    expect((createNameInput() as HTMLInputElement).value).toBe('');
  });

  test('a row selected by hand still opens the edit form', () => {
    // The inverse guard: not auto-selecting must not make selection unreachable.
    // Editing what you just made is one click away, which is the whole premise
    // of the fix.
    component = mountPage([category()]);
    flushSync();

    const row = document.querySelector<HTMLButtonElement>('.category-select');
    expect(row).not.toBe(null);
    row?.click();
    flushSync();

    expect(inspectorHeading()).toBe('Edit topic');
    expect(editNameInput()?.value).toBe('Breathwork');
    expect(pressedRowCount()).toBe(1);
  });

  test('a FAILED insert keeps the add form and surfaces the error', () => {
    component = mountPage();
    flushSync();

    type(createNameInput() as HTMLInputElement, 'Breathwork');
    landCreateFailure('Name already taken');
    flushSync();

    expect(inspectorHeading()).toBe('New topic');
    expect(document.body.textContent).toContain('Name already taken');
    expect(pressedRowCount()).toBe(0);
  });

  test('a STALE result held by the form singleton does not fire on mount', () => {
    // A remote `form()` is a module-level singleton: its `result` outlives
    // unmount and navigation. This page is `ssr = false`, so navigating away and
    // back re-mounts it on top of whatever the last submission left behind.
    // Seeded to null, the create effect read that as a brand-new result and
    // replayed its side effects — a toast, and (pre-fix) a selection jump — with
    // no user action at all. The guard is seeded with `untrack(() => …result)`.
    const existing = category();
    seedCreateResult({ success: true, category: existing });

    component = mountPage([existing]);
    flushSync();

    expect(
      inspectorHeading(),
      'a stale create result from a previous mount drove the inspector into edit mode'
    ).toBe('New topic');
    expect(pressedRowCount()).toBe(0);
    expect(createNameInput()).not.toBe(null);
  });
});
