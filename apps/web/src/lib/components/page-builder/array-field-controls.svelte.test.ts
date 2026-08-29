/**
 * `ArrayField` writes the TYPE each entry key's reader expects — proved on
 * `invite.offers`, the editor for the copy at the page's primary conversion
 * moment (`section-catalog.ts` calls it exactly that).
 *
 * WHAT WENT WRONG. `Codex-28ifd` fixed a catch-all `<input type="text">` at the
 * TOP level of the inspector: a creator typed into a field labelled
 * "Credentials", saved, and got nothing, because the string never survived
 * `asObjectArray`. The same defect survived one nesting level down. `ArrayField`
 * dispatched a repeater's ENTRY fields on `textarea` alone and fell through to a
 * text input for everything else, and three of `invite.offers`' six entry fields
 * land there — each one traced to the reader that discards it:
 *
 *   · `id`      declared `select` over three canonical path ids. As free text the
 *               legal values were never shown, and `readDecorations`
 *               (`offer-paths.ts`) drops an entry naming no real path — so a
 *               creator who typed the label they could see ("One-off purchase")
 *               authored an entry that decorated nothing.
 *   · `bullets` declared `list`. As one text input it persisted a bare STRING
 *               into a key read by `fieldStringArray`, which returns `[]` for a
 *               non-array — every bullet typed was discarded, and the published
 *               page kept the platform's default bullets.
 *   · `best`    declared `toggle`. As a text input it wrote a STRING into a key
 *               read by `fieldBool` (`record[key] === true`), so no value a
 *               creator could type — "true", "yes", "1" — ever flagged a way in
 *               as recommended.
 *
 * WHY THE EXISTING GUARDS MISSED IT, and why this file mounts the real thing:
 * `section-editor-controls.svelte.test.ts` collected declared kinds with
 * `fields.map((f) => f.control)` — top level only — and all three kinds ARE built
 * at the top level, so the set was satisfied by a different dispatch than the one
 * rendering them. That file's guard now descends and asserts the element kind per
 * declared entry field. This file is the other half: it drives the controls and
 * asserts the SHAPE that lands in the draft, because rendering a checkbox and
 * writing `"on"` would satisfy an element-kind assertion and still corrupt.
 */

import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionEditor from './SectionEditor.svelte';

const PAGE_ID = '00000000-0000-4000-8000-00000000ab01';

function invitePage(props: Record<string, unknown> = {}): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    sections: [
      { id: 'sec-invite', type: 'invite', enabled: true, props } as PageSection,
    ],
  } as PageBuilderState;
}

/** The live section out of the store's pending draft. */
function section(): PageSection {
  const s = pageBuilder.pending?.sections[0];
  if (!s) throw new Error('no pending section — open() did not seed the draft');
  return s;
}

/** The authored offers bag, whatever shape the write left it in. */
function offers(): unknown {
  return section().props.offers;
}

/** The one row's cell whose own label is `text`. */
function cell(label: string): HTMLElement {
  const found = [
    ...document.body.querySelectorAll<HTMLElement>('.af__cell'),
  ].find(
    (el) => el.querySelector('.af__cell-label')?.textContent?.trim() === label
  );
  if (!found) throw new Error(`no cell labelled "${label}"`);
  return found;
}

/** A button whose visible text contains `text`. */
function button(text: string): HTMLButtonElement {
  const found = [
    ...document.body.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => (b.textContent ?? '').includes(text));
  if (!found) throw new Error(`no button containing "${text}"`);
  return found;
}

function mountInvite() {
  return mount(SectionEditor, {
    target: document.body,
    props: { section: section() },
  });
}

beforeEach(() => {
  pageBuilder.close();
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
});

describe('invite.offers — every entry control writes its reader’s type', () => {
  it('adds a way in through the repeater’s own affordance', () => {
    pageBuilder.open(PAGE_ID, invitePage());
    const component = mountInvite();
    flushSync();

    // No rows yet, so no cells — the empty state names the field's own noun.
    expect(document.body.querySelectorAll('.af__cell').length).toBe(0);

    button('Add way in').click();
    flushSync();

    expect(Array.isArray(offers())).toBe(true);
    expect((offers() as unknown[]).length).toBe(1);

    unmount(component);
  });

  it('offers the three canonical path ids as a select, not a free-text box', () => {
    // The values are the ones `deriveOfferPaths` enumerates. A free-text box
    // never showed them, and an entry naming no real path decorates nothing.
    pageBuilder.open(PAGE_ID, invitePage({ offers: [{}] }));
    const component = mountInvite();
    flushSync();

    const select = cell('Which way in').querySelector('select');
    expect(select).not.toBeNull();
    const offered = [...(select?.options ?? [])].map((o) => o.value);
    expect(offered).toContain('purchase');
    expect(offered).toContain('subscription-monthly');
    expect(offered).toContain('subscription-annual');
    // Plus an explicit unset choice FIRST, so an entry with no id reads as
    // unset rather than silently as the first legal value.
    expect(offered[0]).toBe('');

    // The entry field's declared hint reaches the DOM too. It carried the
    // CONSTRAINT ("Must name a path the course actually offers, or the entry is
    // ignored") and had nowhere to render, so the one warning that would have
    // explained a dropped entry was invisible.
    expect(
      cell('Which way in').querySelector('.af__cell-hint')?.textContent
    ).toContain('Must name a path');

    // And it writes the id verbatim — `readDecorations` keys on this string.
    if (select) {
      select.value = 'subscription-annual';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    flushSync();
    expect((offers() as Record<string, unknown>[])[0].id).toBe(
      'subscription-annual'
    );

    unmount(component);
  });

  it('writes `best` as a real boolean — the shape `fieldBool` tests for', () => {
    pageBuilder.open(PAGE_ID, invitePage({ offers: [{ id: 'purchase' }] }));
    const component = mountInvite();
    flushSync();

    const box = cell('Recommended').querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    expect(box).not.toBeNull();
    expect(box?.checked).toBe(false);

    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    flushSync();

    const row = (offers() as Record<string, unknown>[])[0];
    // `=== true`, not truthy: the string "true" is what the text box wrote, and
    // `fieldBool` reads it as false. This assertion is the whole bug.
    expect(row.best).toBe(true);
    expect(typeof row.best).toBe('boolean');
    // The rest of the row survives the write.
    expect(row.id).toBe('purchase');

    unmount(component);
  });

  it('round-trips a bullet as a one-element ARRAY, not a bare string', () => {
    pageBuilder.open(PAGE_ID, invitePage({ offers: [{ id: 'purchase' }] }));
    const component = mountInvite();
    flushSync();

    const bullets = cell('Bullets');
    // The nested array control, named by the sub-field's own itemLabel.
    const add = [...bullets.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('bullet')
    );
    expect(add, 'an add-bullet affordance').toBeDefined();
    add?.click();
    flushSync();

    const input = bullets.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).not.toBeNull();
    if (input) {
      input.value = 'Lifetime access';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    flushSync();

    const row = (offers() as Record<string, unknown>[])[0];
    // `fieldStringArray` returns [] for anything failing `Array.isArray`, so a
    // string here is a bullet the creator sees typed and the page never shows.
    expect(row.bullets).toEqual(['Lifetime access']);

    unmount(component);
  });

  it('keeps the plain text and textarea entry fields on their own kinds', () => {
    // The counterpart: widening the dispatch must not promote a `text` entry
    // field to something else. `name`/`who` are text, `blurb` is a textarea.
    pageBuilder.open(PAGE_ID, invitePage({ offers: [{}] }));
    const component = mountInvite();
    flushSync();

    expect(cell('Name').querySelector('input[type="text"]')).not.toBeNull();
    expect(
      cell('Who it is for').querySelector('input[type="text"]')
    ).not.toBeNull();
    expect(cell('Blurb').querySelector('textarea')).not.toBeNull();

    const nameInput = cell('Name').querySelector<HTMLInputElement>('input');
    if (nameInput) {
      nameInput.value = 'The whole thing';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    flushSync();
    expect((offers() as Record<string, unknown>[])[0].name).toBe(
      'The whole thing'
    );

    unmount(component);
  });

  it('never nests a repeater inside a repeater — one level by contract', () => {
    // `ArrayField` renders itself for a nested `list`, so the depth bound is
    // worth asserting rather than assuming: a `list` declares no `itemFields`,
    // which is what stops the recursion. A doubly-nested array is an editor
    // nobody can use and no renderer reads one.
    pageBuilder.open(PAGE_ID, invitePage({ offers: [{}] }));
    const component = mountInvite();
    flushSync();

    const nestedCells = cell('Bullets').querySelectorAll('.af__cell');
    expect(nestedCells.length).toBe(0);

    unmount(component);
  });
});
