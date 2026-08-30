/**
 * The Brand panel offers only what it can deliver, and seeds from the ORG.
 *
 * TWO DEFECTS, one panel, both of the same family as `Codex-28ifd`'s decorative
 * text input — a control that changes a stored value and nothing a visitor sees.
 *
 * 1. THE HERO SHADER SELECT COULD NEVER HAVE WORKED. It wrote
 *    `--brand-shader-preset` into the page's `tokenOverrides`, but `ShaderHero`
 *    resolves its preset via `getShaderConfig()`, which reads
 *    `getComputedStyle(document.querySelector('.org-layout'))` — an ANCESTOR of
 *    both the builder canvas and the journey page's brand wrapper. Custom
 *    properties inherit downward, so a value set on a descendant cannot reach it.
 *    Nothing in the page-builder tree mentions "shader" at all, and one of the
 *    seven options offered ('ember') was not a member of `ShaderPresetId`.
 *
 * 2. IT SEEDED THE PLATFORM PRIMARY, NOT THE ORG'S. `toggleOverride` wrote the
 *    literal `#c24129` — `--color-primary-500` in `colors.css` — so switching
 *    "Override primary colour" on instantly repainted ANY org rust, contradicting
 *    the panel's own comment, which claimed it seeded "the current org primary".
 *    The seed now comes from the live cascade: `--brand-color` on `.org-layout`,
 *    the same raw input the override replaces.
 *
 * The colour assertions are hex-literal on purpose. A brand-neutrality guard that
 * read the expected value from the same place the component does could not fail.
 */

import type { PageBuilderState } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PageBrandPanel from './PageBrandPanel.svelte';

const PAGE_ID = '00000000-0000-4000-8000-00000000cd02';
/** of-blood-and-bones' real primary — an org whose brand is NOT the platform's. */
const ORG_PRIMARY = '#A62B0C';
/** `--color-primary-500` in `colors.css`: what the panel used to hardcode. */
const PLATFORM_PRIMARY = '#c24129';

function draft(
  brandOverrides: PageBuilderState['brandOverrides'] = null
): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides,
    sections: [],
  } as PageBuilderState;
}

/** The org layout element the brand cascade lives on, carrying `brand`. */
function withOrgLayout(brand: string | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'org-layout';
  if (brand) el.style.setProperty('--brand-color', brand);
  document.body.appendChild(el);
  return el;
}

function panel() {
  return mount(PageBrandPanel, { target: document.body });
}

/** The override switch, named by its own aria-label. */
function toggle(): HTMLButtonElement {
  const el = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Override primary colour"]'
  );
  if (!el) throw new Error('no override switch');
  return el;
}

beforeEach(() => {
  pageBuilder.close();
});

afterEach(() => {
  document.body.innerHTML = '';
  pageBuilder.close();
});

describe('PageBrandPanel — every control it shows can change the page', () => {
  it('offers no hero-shader select, and stores no shader token', () => {
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    // The panel's remaining controls are the switch and (once on) the colour
    // input. A select here would be the decorative control again.
    expect(document.body.querySelectorAll('select').length).toBe(0);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('shader');
    expect(text).not.toContain('Shader');
    expect(
      pageBuilder.pending?.brandOverrides?.tokenOverrides?.[
        '--brand-shader-preset'
      ]
    ).toBeUndefined();

    unmount(component);
  });

  it('seeds the override from the ORG primary, never the platform one', () => {
    withOrgLayout(ORG_PRIMARY);
    pageBuilder.open(PAGE_ID, draft());
    const component = panel();
    flushSync();

    toggle().click();
    flushSync();

    const seeded = pageBuilder.pending?.brandOverrides?.primaryColor;
    expect(seeded?.toLowerCase()).toBe(ORG_PRIMARY.toLowerCase());
    expect(seeded?.toLowerCase()).not.toBe(PLATFORM_PRIMARY);
    // Which means switching it on is a visual no-op: the page keeps rendering
    // the colour it already had until the author picks a different one.
    const input = document.body.querySelector<HTMLInputElement>(
      'input[type="color"]'
    );
    expect(input?.value.toLowerCase()).toBe(ORG_PRIMARY.toLowerCase());

    unmount(component);
  });

  it('turning it off clears the override rather than storing a colour', () => {
    withOrgLayout(ORG_PRIMARY);
    pageBuilder.open(PAGE_ID, draft({ primaryColor: '#123456' }));
    const component = panel();
    flushSync();

    toggle().click();
    flushSync();

    expect(pageBuilder.pending?.brandOverrides?.primaryColor).toBeUndefined();
    expect(document.body.querySelector('input[type="color"]')).toBeNull();

    unmount(component);
  });

  it('re-seeds from the ORG after a cleared override, not from a constant', () => {
    // The path a creator takes when they change their mind: override, clear,
    // override again. `updateBrandOverrides` merges, so the cleared key is
    // genuinely gone and the second ON is a first override again — it must come
    // from the org's own colour, which is the whole point of the fix.
    withOrgLayout(ORG_PRIMARY);
    pageBuilder.open(PAGE_ID, draft({ primaryColor: '#0d5c3a' }));
    const component = panel();
    flushSync();

    toggle().click(); // off
    flushSync();
    expect(pageBuilder.pending?.brandOverrides?.primaryColor).toBeUndefined();

    // `updateBrandOverrides` merges, so the cleared key is genuinely gone and
    // the next ON re-seeds from the org. That is the honest behaviour: nothing
    // remembers a discarded override, and the seed is never the platform hex.
    toggle().click(); // on
    flushSync();
    expect(
      pageBuilder.pending?.brandOverrides?.primaryColor?.toLowerCase()
    ).toBe(ORG_PRIMARY.toLowerCase());

    unmount(component);
  });
});
