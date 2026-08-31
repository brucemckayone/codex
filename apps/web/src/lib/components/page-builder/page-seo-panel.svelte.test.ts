/**
 * The SEO panel's three controls all do something, and the web address can hold
 * a hyphen.
 *
 * TWO DEFECTS, one panel:
 *
 * 1. THE ONE WORKING CONTROL REWROTE WHAT THE CREATOR TYPED, UNDER THE CARET. The
 *    slug input ran `slugify()` on EVERY keystroke and re-bound the result to the
 *    input's own `value`. MEASURED at the pre-fix commit, by running the two
 *    tests below against it: typing a space between "deep" and "work" replaced
 *    the field's value with "deep-work" and moved `selectionStart` from 5 to 9,
 *    so editing anywhere but the end of the field threw the caret to the end. The
 *    same binding let the field DISPLAY characters that never reached the stored
 *    slug, since `slugify` strips them and an unchanged store value re-renders
 *    nothing. Same family as `PagePricingPanel`'s untypeable decimal, and fixed
 *    the same way: a local draft is authoritative while the field is focused.
 *
 *    THE BEAD'S STRONGER CLAIM DOES NOT REPRODUCE, and is corrected here rather
 *    than repeated: "it is not possible to author `deep-work`". Typing it at the
 *    pre-fix commit DOES leave `deep-work` in the store. The caret and the
 *    display divergence are the real defects.
 *
 * 2. META TITLE + DESCRIPTION WERE PERMANENTLY `disabled` — the ONLY disabled
 *    controls in the entire six-panel builder (Codex-2j8nq). Honest at the time:
 *    `landing_pages` had no `seo` column and the save body is `.strict()`, so the
 *    keystrokes would have been discarded under a "Page saved" toast. Migration
 *    0090 + `pageSeoSchema` + the `saveJourneyPage` write + the
 *    `getJourneyForBuilder` projection close that chain, so the fields are live.
 *
 * The slug assertions read the INPUT ELEMENT's value, not the store's, because
 * the bug was precisely that the two disagreed: the store held a fine value and
 * the DOM threw the creator's keystroke away.
 */

import type { PageBuilderState } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PageSeoPanel from './PageSeoPanel.svelte';

const PAGE_ID = '00000000-0000-4000-8000-00000000cd04';

function draft(overrides: Partial<PageBuilderState> = {}): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'bone-deep',
    title: 'Bone Deep',
    status: 'draft',
    subjectType: 'course',
    subjectId: '00000000-0000-4000-8000-0000000000c0',
    brandOverrides: null,
    sections: [],
    ...overrides,
  } as PageBuilderState;
}

function panel() {
  return mount(PageSeoPanel, { target: document.body });
}

function inputs(): HTMLInputElement[] {
  return [...document.body.querySelectorAll<HTMLInputElement>('input')];
}

/** The web-address field — the first (and only) text input above the meta title. */
function slugInput(): HTMLInputElement {
  const el = inputs()[0];
  if (!el) throw new Error('no slug input');
  return el;
}

function metaTitleInput(): HTMLInputElement {
  const el = inputs()[1];
  if (!el) throw new Error('no meta-title input');
  return el;
}

function metaDescription(): HTMLTextAreaElement {
  const el = document.body.querySelector<HTMLTextAreaElement>('textarea');
  if (!el) throw new Error('no meta-description textarea');
  return el;
}

/** Type one character into a field, as a browser would: value then `input`. */
function type(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  for (const ch of text) {
    el.value = el.value + ch;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
}

beforeEach(() => {
  pageBuilder.close();
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
});

describe('PageSeoPanel — the web address', () => {
  it('shows what the creator typed, and slugifies into the store beside it', () => {
    pageBuilder.open(PAGE_ID, draft({ slug: '' }));
    const component = panel();
    flushSync();

    type(slugInput(), 'deep work');

    // Before the local draft this read 'deep-work': the field rewrote the space
    // the creator had just typed, in place, on the keystroke after it.
    expect(slugInput().value).toBe('deep work');
    expect(pageBuilder.pending?.slug).toBe('deep-work');

    // Blur → the field falls back to the canonical stored slug.
    slugInput().dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    expect(slugInput().value).toBe('deep-work');
    expect(pageBuilder.pending?.slug).toBe('deep-work');

    unmount(component);
  });

  it('lets a hyphen be typed directly', () => {
    pageBuilder.open(PAGE_ID, draft({ slug: '' }));
    const component = panel();
    flushSync();

    type(slugInput(), 'deep-work');

    expect(slugInput().value).toBe('deep-work');
    expect(pageBuilder.pending?.slug).toBe('deep-work');

    unmount(component);
  });

  it('keeps the stored slug save-schema-valid on EVERY keystroke', () => {
    // `saveJourneyPageBodySchema.slug` rejects a leading/trailing hyphen and any
    // non-alphanumeric, so a draft that leaked into `pending` would 400 a save
    // issued (e.g. by a keyboard shortcut) before the field blurred.
    pageBuilder.open(PAGE_ID, draft({ slug: '' }));
    const component = panel();
    flushSync();
    const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    for (const ch of 'Deep Work!! now') {
      slugInput().value = slugInput().value + ch;
      slugInput().dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const stored = pageBuilder.pending?.slug ?? '';
      if (stored) expect(stored).toMatch(valid);
    }
    expect(pageBuilder.pending?.slug).toBe('deep-work-now');

    unmount(component);
  });

  it('warns that renaming a LIVE page breaks the links already shared', () => {
    pageBuilder.open(PAGE_ID, draft({ status: 'published' }));
    const component = panel();
    flushSync();

    // No warning until the address actually changes — otherwise it is a
    // permanent scold rather than a consequence of this edit.
    expect(document.body.textContent).not.toContain('404');

    type(slugInput(), '-renamed');
    flushSync();

    const text = document.body.textContent ?? '';
    expect(text).toContain('404');
    expect(text).toContain('/journeys/bone-deep');

    unmount(component);
  });

  it('does NOT warn on a draft, which has no shared links to break', () => {
    pageBuilder.open(PAGE_ID, draft({ status: 'draft' }));
    const component = panel();
    flushSync();

    type(slugInput(), '-renamed');
    flushSync();

    expect(document.body.textContent).not.toContain('404');

    unmount(component);
  });
});

describe('PageSeoPanel — meta title + description (Codex-2j8nq)', () => {
  it('offers no disabled control at all', () => {
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    // These two were the only disabled controls in the whole builder.
    expect(document.body.querySelectorAll('[disabled]').length).toBe(0);

    unmount(component);
  });

  it('writes the typed meta title into the draft', () => {
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    type(metaTitleInput(), 'A descent');

    expect(pageBuilder.pending?.seo?.title).toBe('A descent');
    // A page-level override, NOT a rename: the page's own title is untouched.
    expect(pageBuilder.pending?.title).toBe('Bone Deep');

    unmount(component);
  });

  it('writes the typed meta description into the draft', () => {
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    type(metaDescription(), 'Slow work.');

    expect(pageBuilder.pending?.seo?.description).toBe('Slow work.');

    unmount(component);
  });

  it('merges rather than replaces, so the two fields are independent', () => {
    pageBuilder.open(
      PAGE_ID,
      draft({ seo: { title: 'Kept', description: 'Kept too' } })
    );
    const component = panel();
    flushSync();

    metaDescription().value = 'Rewritten';
    metaDescription().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(pageBuilder.pending?.seo?.description).toBe('Rewritten');
    expect(pageBuilder.pending?.seo?.title).toBe('Kept');

    unmount(component);
  });

  it('opens with the stored bag, so a reload shows what was saved', () => {
    pageBuilder.open(
      PAGE_ID,
      draft({
        seo: { title: 'Stored title', description: 'Stored description' },
      })
    );
    const component = panel();
    flushSync();

    expect(metaTitleInput().value).toBe('Stored title');
    expect(metaDescription().value).toBe('Stored description');

    unmount(component);
  });

  it('persists a CLEARED field as the empty string, not as an absent key', () => {
    // The public head falls back with `||`, so an empty override resumes deriving
    // from the page title / course lede. Deleting the key instead would read as
    // "the client said nothing about SEO", which the service treats as
    // leave-alone — and the creator's clear would never land.
    pageBuilder.open(PAGE_ID, draft({ seo: { description: 'Remove me' } }));
    const component = panel();
    flushSync();

    metaDescription().value = '';
    metaDescription().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(pageBuilder.pending?.seo?.description).toBe('');
    expect('description' in (pageBuilder.pending?.seo ?? {})).toBe(true);

    unmount(component);
  });

  it('carries no emoji in the share-image stub (product-UI rule)', () => {
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    // The slot itself stays a stub (a separate follow-up owns the media picker),
    // but the placeholder glyph was a 🖼 emoji in product UI.
    const text = document.body.textContent ?? '';
    expect(text).toContain('1200×630');
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);

    unmount(component);
  });
});

describe('PageSeoPanel — editing the address in the middle', () => {
  /**
   * The sharpest form of the bug: a space typed BETWEEN two words was replaced
   * under the caret and the caret was thrown to the end of the field, so the
   * next keystroke landed in the wrong place. MEASURED at the pre-fix commit:
   * the input's own value snapped from "deep work" to "deep-work" and
   * `selectionStart` moved from 5 to 9.
   */
  it('keeps the caret where the creator put it', () => {
    pageBuilder.open(PAGE_ID, draft({ slug: 'deepwork' }));
    const component = panel();
    flushSync();

    const el = slugInput();
    el.focus();
    // Type a space between "deep" and "work", as a browser would.
    el.value = 'deep work';
    el.setSelectionRange(5, 5);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(el.value).toBe('deep work');
    expect(el.selectionStart).toBe(5);
    // …and the STORE still holds the canonical slug.
    expect(pageBuilder.pending?.slug).toBe('deep-work');

    unmount(component);
  });
});
