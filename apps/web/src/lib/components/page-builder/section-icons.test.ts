/**
 * Catalogue icons are REAL icons, and the rail is not named by a glyph
 * (Codex-1khpv).
 *
 * WHAT WAS WRONG, measured with codepoints on the live builder. The catalogue's
 * eleven `icon` values reached the DOM as TEXT NODES inside the rail rows and the
 * add-section picker — `◇` U+25C7, `◍` U+25CD, `⊞` U+229E, `✦` U+2726, `☺` U+263A
 * — beside 17 real `IconBase` SVGs in the same rail, plus `⠿` U+283F (a BRAILLE
 * PATTERNS codepoint) as the drag grip. `guide: '☺'` is the one value Unicode
 * actually classes as emoji-capable, so on Apple platforms it rendered in colour
 * among monochrome strokes.
 *
 * These assertions are BEHAVIOURAL where behaviour is the claim — the picker is
 * mounted and its DOM read — because "route it through IconBase" is a statement
 * about what reaches the page, and a source grep cannot tell an `<svg>` from a
 * string that happens to be spelled the same.
 *
 * The accessible-name half is asserted too, and it is the reason the fix is not
 * merely house style: a decorative icon that is NOT hidden joins its button's
 * accessible name, so a rail row would be announced "◇ Hero" rather than "Hero".
 */

import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { SECTION_CATALOG } from '$lib/page-builder';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import AddSectionPicker from './AddSectionPicker.svelte';
import SectionList from './SectionList.svelte';
import { SECTION_GRIP_ICON, SECTION_ICONS, sectionIcon } from './section-icons';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Every codepoint Unicode would let a font draw as colour emoji. */
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u;
/** The Braille block, which `⠿` U+283F came from. */
const BRAILLE = /[⠀-⣿]/u;

describe('SECTION_ICONS', () => {
  it('declares an icon component for every catalogue section type', () => {
    for (const def of SECTION_CATALOG) {
      expect(
        SECTION_ICONS[def.type],
        `no icon component for ${def.type}`
      ).toBeTypeOf('function');
    }
    // And nothing beyond the catalogue — a stale entry for a retired type is the
    // same drift in the other direction.
    expect(Object.keys(SECTION_ICONS).sort()).toEqual(
      SECTION_CATALOG.map((d) => d.type).sort()
    );
  });

  it('sectionIcon is total — an unknown/widened type still gets an icon', () => {
    // The rail must render a row for a section type this deployment's catalogue
    // does not know, the same forward-compatibility the renderer's unknown-type
    // skip provides.
    expect(sectionIcon('retreat-schedule')).toBeTypeOf('function');
    expect(sectionIcon('hero')).toBe(SECTION_ICONS.hero);
  });

  it('the drag grip is a component, not the Braille codepoint it used to be', () => {
    expect(SECTION_GRIP_ICON).toBeTypeOf('function');
  });
});

describe('AddSectionPicker — each row draws an SVG, not a glyph', () => {
  it('renders one icon SVG per catalogue row and no lone-symbol text node', () => {
    const component = mount(AddSectionPicker, {
      target: document.body,
      props: { onadd: () => {} },
    });
    flushSync();

    const rows = [...document.body.querySelectorAll('.add-picker__item')];
    expect(rows).toHaveLength(SECTION_CATALOG.length);

    for (const row of rows) {
      const glyph = row.querySelector('.add-picker__glyph');
      expect(glyph, 'row has no icon slot').not.toBeNull();
      // THE ICON IS AN SVG. This is the assertion the bead's acceptance names.
      expect(
        glyph?.querySelector('svg'),
        'icon slot holds no <svg>'
      ).not.toBeNull();
      // …and it carries nothing readable, so it cannot join the row's name.
      expect(glyph?.textContent?.trim()).toBe('');
    }

    // NO pictograph and NO Braille codepoint anywhere in the picker's text — the
    // exact class of value that was reaching the DOM.
    const text = document.body.textContent ?? '';
    expect(PICTOGRAPH.test(text), `pictograph in picker text: ${text}`).toBe(
      false
    );
    expect(BRAILLE.test(text)).toBe(false);

    unmount(component);
    document.body.innerHTML = '';
  });

  it('names each row by its label alone — the icon is decorative', () => {
    const component = mount(AddSectionPicker, {
      target: document.body,
      props: { onadd: () => {} },
    });
    flushSync();

    // `IconBase` sets aria-hidden itself; assert the OUTCOME rather than the
    // attribute, because the outcome is what a screen reader computes.
    const hero = SECTION_CATALOG[0];
    const row = [...document.body.querySelectorAll('.add-picker__item')][0];
    expect(row.querySelector('.add-picker__label')?.textContent).toBe(
      hero.label
    );
    for (const svg of row.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }

    unmount(component);
    document.body.innerHTML = '';
  });
});

// The catalogue's own `icon` string is pinned non-emoji next to the field it
// guards, in `$lib/page-builder/section-catalog.test.ts` — that assertion needs
// no component import, and co-locating it keeps the public-lib root's tests free
// of an editor-bundle dependency the CE-4 boundary gate scans for.

// ── THE SECTIONS RAIL — the surface the codepoints were actually read from ───
//
// O24 read the lone-symbol text nodes inside `.jb__outline`, not the picker, and
// found each row's accessible name was literally "⠿ ◇ Hero": the drag grip and the
// catalogue glyph were TEXT INSIDE THE BUTTON, so they joined the name. The picker
// assertions above cannot see that, because the grip only exists on the rail.

function railSection(id: string, type: string): PageSection {
  return { id, type, enabled: true, props: {} } as PageSection;
}

function railState(): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'bone-deep',
    title: 'Bone Deep',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    sections: [
      railSection('sec-hero', 'hero'),
      railSection('sec-ache', 'ache'),
      railSection('sec-guide', 'guide'),
      // A type this deployment's catalogue does not know — the rail must still
      // draw a row, and still draw an icon.
      railSection('sec-unknown', 'retreat-schedule'),
    ],
  } as PageBuilderState;
}

describe('SectionList — a rail row is named by its label, not by a glyph', () => {
  it('draws an SVG per row and keeps every symbol out of the accessible name', () => {
    pageBuilder.close();
    pageBuilder.open('00000000-0000-4000-8000-000000000000', railState());
    const component = mount(SectionList, { target: document.body });
    flushSync();

    const rows = [...document.body.querySelectorAll('.section-list__row')];
    expect(rows).toHaveLength(4);

    for (const row of rows) {
      // THE GRIP. It was `⠿` U+283F, a Braille codepoint standing in for an icon.
      const grip = row.querySelector('.section-list__grip');
      expect(grip?.querySelector('svg'), 'grip is not an icon').not.toBeNull();
      expect(grip?.textContent?.trim()).toBe('');

      // THE TYPE ICON, including on the unknown type — `sectionIcon` is total.
      const glyph = row.querySelector('.section-list__glyph');
      expect(glyph?.querySelector('svg'), 'no type icon').not.toBeNull();
      expect(glyph?.textContent?.trim()).toBe('');

      // THE ACCESSIBLE NAME of the select button is the label ALONE. This is the
      // assertion that would have failed before the fix, with "◇ Hero".
      const select = row.querySelector('.section-list__select');
      expect(select?.textContent?.trim()).toBe(
        (
          select?.querySelector('.section-list__label')?.textContent ?? ''
        ).trim()
      );
      for (const svg of row.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    }

    // No pictograph and no Braille codepoint anywhere in the rail's text.
    const text = document.body.textContent ?? '';
    expect(PICTOGRAPH.test(text), `pictograph in rail text: ${text}`).toBe(
      false
    );
    expect(BRAILLE.test(text), `braille in rail text: ${text}`).toBe(false);

    unmount(component);
    pageBuilder.close();
  });
});
