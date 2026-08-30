/**
 * THE FIELD SWEEP, PROPERTIES 4-6 — the three verdicts the per-row sweep cannot
 * answer one row at a time.
 *
 * `field-inventory-sweep.svelte.test.ts` walks all 98 field instances and answers
 * PERSISTS / RIGHT KEY / LABELLED per row, plus keyboard and disabled-honesty for
 * the fields the inspector renders. Three questions do not fit that shape, and its
 * own header says so about the first of them ("Property 4 ... is not a per-row
 * property — it belongs to the surface that owns the read — so it is asserted once
 * per surface at the foot of this file"). IT WAS NOT: no such assertion existed in
 * that file at all. This one is where it lives, together with the parts of 5 and 6
 * that belong to a CONTROL rather than to a field:
 *
 *   4. ERROR-SURFACED   — when a read fails, does the creator SEE it? Asserted as
 *                         a CLASS, over every store × every consumer, rather than
 *                         as three named panels — because the defect it exists to
 *                         catch was an omission, and an omission is invisible to a
 *                         test that enumerates what is there.
 *   5. KEYBOARD         — the controls that are not fields: the repeater's row
 *                         tools, the variant picker, the rail's reorder path, and
 *                         the canvas's floating add-picker.
 *   6. HONEST WHEN
 *      DISABLED         — every `disabled=` site in this directory, classified;
 *                         and behaviourally, that each one's reason is on screen.
 *
 * ── WHAT EACH OF THE FOUR DEFECTS BELOW ACTUALLY WAS ─────────────────────────
 *
 *  · THE INSPECTOR NEVER SAID THE MEDIA READ HAD FAILED. `sellMedia.loadError` was
 *    populated by both of `open()`'s reads and rendered only in `PageMediaPanel`.
 *    The same store feeds the `media` control in every section inspector, and
 *    those rendered nothing — so a failed library read was indistinguishable from
 *    "you have no ready media". Its sibling `monetisation.loadError` had been
 *    rendered by the pricing panel the whole time, which is why the rule below is
 *    stated over ALL stores and ALL consumers: one half of a symmetric pair being
 *    wired is exactly how this survived.
 *
 *  · THE PRICING PANEL LOCKED WITH NO REASON. `locked` has three causes; two
 *    spoke. `monetisation.open(null)` — which the route passes for a course-typed
 *    page with no `subjectId` — returns immediately leaving `loaded` false,
 *    `loading` false and `loadError` null for ever, so four controls were disabled
 *    with nothing on screen about why.
 *
 *  · THE CANVAS'S ADD-PICKER WAS MOUSE-ONLY IN PRACTICE. It is rendered as the
 *    component's LAST child while appearing beside the block toolbar, so tab order
 *    and visual order disagreed completely: pressing "Add a section after this"
 *    with a keyboard opened a popover the next Tab did not reach.
 *
 *  · THE MEDIA PICKERS ARE NAMED BY A PLACEHOLDER. Melt's combobox puts an
 *    `aria-labelledby` on its input pointing at a `$label` element `MediaPicker`
 *    never renders, so the reference DANGLES and the widget's own name falls
 *    through to "Select media…", identical for all six. Naming the wrapping group
 *    is the fix available inside this directory; the widget's own name needs a prop
 *    on `MediaPicker`, which lives in `components/studio` and is handed off. The
 *    dangling reference is asserted here so the handoff has a failing witness.
 *
 * ── THE BOUNDARY, STATED RATHER THAN IMPLIED ─────────────────────────────────
 * jsdom cannot say anything about geometry, so "the tab order follows the VISUAL
 * order" is proved in the two ways that are real in a DOM: no element in this
 * directory declares a positive `tabindex` (so tab order IS DOM order), and DOM
 * order matches the intended reading order where the two could diverge. A pixel
 * claim would need a browser, and both browser MCP servers were unreachable for
 * this round — which is recorded, not glossed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CourseOffer,
  PageBuilderState,
  PageSection,
} from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { variantsForType } from '$lib/page-builder';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import JourneyBuilderCanvas from './JourneyBuilderCanvas.svelte';
import PagePricingPanel from './PagePricingPanel.svelte';
import SectionEditor from './SectionEditor.svelte';
import { SECTION_FIELDS } from './section-fields';
import VariantPicker from './VariantPicker.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORES = join(HERE, '..', '..', 'page-builder');

const PAGE_ID = '00000000-0000-4000-8000-00000000e001';
const COURSE_ID = '00000000-0000-4000-8000-00000000e0c0';

const read = (path: string): string => readFileSync(path, 'utf8');

/** Every `.svelte` component this directory owns. */
const COMPONENTS: readonly string[] = readdirSync(HERE)
  .filter((f) => f.endsWith('.svelte'))
  .sort();

function pageWith(
  section: PageSection,
  over: Partial<PageBuilderState> = {}
): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'honesty',
    title: 'Honesty',
    status: 'draft',
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [section],
    ...over,
  } as PageBuilderState;
}

const sectionOfType = (
  type: string,
  props: Record<string, unknown> = {}
): PageSection =>
  ({ id: 'honesty-section', type, enabled: true, props }) as PageSection;

function live(): PageSection {
  const s = pageBuilder.pending?.sections[0];
  if (!s) throw new Error('no pending section — open() did not seed the draft');
  return s;
}

let mounted: ReturnType<typeof mount> | null = null;

function mountEditor(section: PageSection): void {
  mounted = mount(SectionEditor, {
    target: document.body,
    props: { section },
  });
  flushSync();
}

beforeEach(() => {
  pageBuilder.close();
  try {
    sessionStorage.clear();
  } catch {
    // A storage-less environment is fine — `open()` falls through to a clean clone.
  }
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
  pageBuilder.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ERROR-SURFACED
// ─────────────────────────────────────────────────────────────────────────────

describe('4 · a store that can report a read failure has every consumer render it', () => {
  /**
   * The stores in `lib/page-builder` that expose a failure reason, DERIVED — so a
   * third store added with a `loadError` is covered the day it lands rather than
   * the day someone remembers this file.
   */
  const storesWithLoadError = readdirSync(STORES)
    .filter((f) => f.endsWith('.svelte.ts'))
    .filter((f) => read(join(STORES, f)).includes('get loadError()'))
    .sort();

  it('finds the stores that can fail — the guard is vacuous without them', () => {
    // Named as well as counted: a rename that silently emptied this list would
    // make every assertion below pass over nothing.
    expect(storesWithLoadError).toEqual([
      'monetisation-store.svelte.ts',
      'sell-media-store.svelte.ts',
    ]);
  });

  it('every component that consumes such a store RENDERS its loadError', () => {
    // THE OMISSION THIS CATCHES, and why it is phrased over the whole cross
    // product: `SectionEditor` imported `sellMedia` and rendered no reason, while
    // `PageMediaPanel` next to it did. Enumerating the panels that DO render it
    // could never have found the one that did not.
    const gaps: string[] = [];
    for (const store of storesWithLoadError) {
      // `sell-media-store.svelte.ts` → the `sellMedia` singleton it exports.
      // `= new ` is what distinguishes it from the module's other `export const`s
      // (`SLOT_ACCEPTS` is the first one, and matching that named a store that
      // does not exist — a bug in an earlier draft of this very guard).
      const source = read(join(STORES, store));
      const singleton = /export const (\w+) = new /.exec(source)?.[1];
      expect(singleton, `${store} exports no store singleton`).toBeTruthy();

      for (const file of COMPONENTS) {
        const text = read(join(HERE, file));
        if (!text.includes(store.replace('.svelte.ts', ''))) continue;
        if (!text.includes(`${singleton}.loadError`)) {
          gaps.push(
            `${file} consumes ${singleton} but never reads its loadError`
          );
          continue;
        }
        // Reading it is not rendering it. The reason has to reach the DOM from a
        // BRANCH — `{:else if}` counts, because a panel may explain a nearer cause
        // first (the pricing panel puts "no course attached" ahead of the read
        // failure) — and the text itself has to be interpolated. A silent `<p>` or
        // an unrendered `$derived` is the half-fix this rule is written against.
        if (
          !new RegExp(`\\{(?:#if|:else if) ${singleton}\\.loadError\\}`).test(
            text
          )
        ) {
          gaps.push(
            `${file} reads ${singleton}.loadError outside a conditional branch`
          );
        }
        if (!new RegExp(`\\{${singleton}\\.loadError\\}`).test(text)) {
          gaps.push(`${file} never renders the ${singleton}.loadError TEXT`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('reads a failure through queryErrorMessage, never through .error?.message', () => {
    // `.error?.message` is `undefined` for every `HttpError` in this app (the text
    // is at `.body.message`), so a branch written that way is DEAD CODE that reads
    // as handled. Asserted as a NEGATIVE over the whole directory.
    const offenders = COMPONENTS.filter((f) =>
      /\.error\?\.message/.test(read(join(HERE, f)))
    );
    expect(offenders).toEqual([]);
  });

  it('the negative control above can actually fail', () => {
    // A negative assertion that cannot go red is not a guard. Proving the pattern
    // rather than the corpus, because the corpus is (correctly) empty.
    expect(/\.error\?\.message/.test('const x = q.error?.message;')).toBe(true);
    expect(/\.error\?\.message/.test('queryErrorMessage(q.error)')).toBe(false);
  });

  it('gates the inspector notice on the section actually FIELDING media', () => {
    // The structural half of "a prose section is not told about a media read it
    // never makes": the notice is behind `hasMediaField`, and `hasMediaField` is
    // derived from the field catalogue rather than from a hand-written list of
    // types — which is what stops a new media-fielding type from being silent.
    const editor = read(join(HERE, 'SectionEditor.svelte'));
    expect(editor).toMatch(/hasMediaField = \$derived\(.*control === 'media'/);
    expect(editor).toMatch(/\{#if hasMediaField\}/);
    // And the catalogue really does split the two ways: some types field media,
    // some do not, so the gate is not vacuous in either direction.
    const fieldsMedia = Object.values(SECTION_FIELDS).filter((fs) =>
      fs.some((f) => f.control === 'media')
    ).length;
    expect(fieldsMedia).toBeGreaterThan(0);
    expect(fieldsMedia).toBeLessThan(Object.keys(SECTION_FIELDS).length);
  });

  // THE BEHAVIOURAL HALF lives in `section-media-fields.svelte.test.ts`, which
  // mocks the two remote reads so `open()` can be driven into its failure path and
  // the rendered `role="alert"` asserted for real. It is not duplicated here: an
  // unmocked `query()` throws synchronously in jsdom (`app.hooks` is undefined), so
  // a copy of that case in this file could only ever assert the throw.
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. KEYBOARD-REACHABLE — the controls that are not fields
// ─────────────────────────────────────────────────────────────────────────────

describe('5 · tab order is DOM order', () => {
  it('no component in this directory declares a positive tabindex', () => {
    // The only honest jsdom proof that tab order follows visual order: a positive
    // `tabindex` is the one thing that can divorce them, and there is none. The two
    // `tabindex={... ? 0 : undefined}` sites are 0 (in flow) or absent.
    const offenders: string[] = [];
    for (const file of COMPONENTS) {
      for (const match of read(join(HERE, file)).matchAll(
        /tabindex=(?:"|\{)?\s*(-?\d+)/g
      )) {
        if (Number(match[1]) > 0)
          offenders.push(`${file}: tabindex=${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('5+6 · every repeater ENTRY control, one row per declared cell', () => {
  /**
   * The 10 entry rows, derived — the gap this closes.
   *
   * The per-row sweep exercises an entry cell for PERSISTS / RIGHT KEY / LABELLED,
   * but its keyboard and disabled loops iterate `fields`, i.e. the 88 TOP-LEVEL
   * rows only. So 10 of the 98 had those two verdicts by READING `ArrayField`'s
   * five branches rather than by touching them — which is exactly the "a row you
   * did not check but report as passing" shape the sweep exists to correct. Now
   * they are touched.
   */
  const ENTRY = Object.entries(SECTION_FIELDS).flatMap(([type, fields]) =>
    fields.flatMap((f) =>
      (f.itemFields ?? []).map((sub) => ({ type, parent: f, field: sub }))
    )
  );

  it('is 10 entry rows — the guard is vacuous if the derivation breaks', () => {
    expect(ENTRY).toHaveLength(10);
  });

  for (const row of ENTRY) {
    it(`${row.type}.${row.parent.key}[].${row.field.key} takes focus and is live`, () => {
      pageBuilder.open(
        PAGE_ID,
        pageWith(sectionOfType(row.type, { [row.parent.key]: [{}] }))
      );
      mountEditor(live());

      const parentBlock = [
        ...document.body.querySelectorAll<HTMLElement>(
          '.section-editor__field'
        ),
      ].find(
        (el) =>
          el
            .querySelector('.section-editor__field-label')
            ?.textContent?.trim() === row.parent.label
      ) as HTMLElement;
      expect(parentBlock, `no "${row.parent.label}" field block`).toBeTruthy();

      const cell = [
        ...parentBlock.querySelectorAll<HTMLElement>('.af__cell'),
      ].find(
        (el) =>
          el.querySelector('.af__cell-label')?.textContent?.trim() ===
          row.field.label
      ) as HTMLElement;
      expect(cell, `no "${row.field.label}" cell`).toBeTruthy();

      // A nested `list` cell has no row until one is added — its own control is
      // the Add button, and the row input appears after it.
      if (row.field.control === 'list') {
        const add = cell.querySelector('.af__add') as HTMLButtonElement;
        expect(
          add,
          'a nested list with no Add button cannot be authored'
        ).toBeTruthy();
        expect(add.disabled).toBe(false);
        add.focus();
        expect(document.activeElement).toBe(add);
        add.click();
        flushSync();
      }

      const control = cell.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select'
      );
      expect(control, 'the cell renders no focusable control').not.toBeNull();
      expect(control?.getAttribute('tabindex')).not.toBe('-1');
      expect((control as HTMLInputElement).disabled).toBeFalsy();
      control?.focus();
      expect(document.activeElement).toBe(control);
    });
  }
});

describe('5 · a repeater row is fully operable from the keyboard', () => {
  it('adds, reorders and removes an OBJECT row with focus and clicks only', () => {
    // The per-row sweep proves this for `ache.points`, a STRING list. `invite.offers`
    // is the object repeater — the editor for the copy at the page's primary
    // conversion moment — and its rows are a different branch of `ArrayField`.
    pageBuilder.open(PAGE_ID, pageWith(sectionOfType('invite')));
    mountEditor(live());

    const block = [
      ...document.body.querySelectorAll<HTMLElement>('.section-editor__field'),
    ].find(
      (el) =>
        el
          .querySelector('.section-editor__field-label')
          ?.textContent?.trim() === 'Ways in'
    );
    expect(block, 'no "Ways in" field block').toBeTruthy();
    const add = [...(block as HTMLElement).querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes('Add way in')
    ) as HTMLButtonElement;

    add.focus();
    expect(document.activeElement).toBe(add);
    add.click();
    add.click();
    flushSync();

    // Name row 1 through ITS OWN "Name" cell, by the label a creator reads — not
    // by index into `.af__input`, which starts with the `Which way in` SELECT and
    // would have written a way-in id into the name field.
    const cellNamed = (row: HTMLElement, label: string): HTMLElement =>
      [...row.querySelectorAll<HTMLElement>('.af__cell')].find(
        (c) => c.querySelector('.af__cell-label')?.textContent?.trim() === label
      ) as HTMLElement;

    const firstRow = (block as HTMLElement).querySelector(
      '.af__row'
    ) as HTMLElement;
    const nameInput = cellNamed(firstRow, 'Name').querySelector(
      '.af__input'
    ) as HTMLInputElement;
    nameInput.value = 'alpha';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    const rows = () =>
      pageBuilder.pending?.sections[0].props.offers as Record<
        string,
        unknown
      >[];
    expect(rows()).toHaveLength(2);
    expect(rows()[0].name).toBe('alpha');

    const tools = [
      ...(block as HTMLElement).querySelectorAll<HTMLElement>('.af__tools'),
    ];
    expect(tools, 'an object row carries no tool group').toHaveLength(2);
    // Each group is NAMED and positioned, so "row 2 actions" is distinguishable
    // from "row 1 actions" — three identical trash buttons otherwise.
    expect(tools[0].getAttribute('role')).toBe('group');
    expect(tools[0].getAttribute('aria-label')).not.toBe(
      tools[1].getAttribute('aria-label')
    );

    const [up0, down0, remove0] = [
      ...tools[0].querySelectorAll<HTMLButtonElement>('button'),
    ];
    expect(up0.disabled, 'move-up is live on the FIRST row').toBe(true);
    down0.focus();
    expect(document.activeElement).toBe(down0);
    down0.click();
    flushSync();
    expect(rows()[1].name, 'the row did not move down').toBe('alpha');

    // And back up, from the row it moved to.
    const upAgain = [
      ...[
        ...(block as HTMLElement).querySelectorAll<HTMLElement>('.af__tools'),
      ][1].querySelectorAll<HTMLButtonElement>('button'),
    ][0];
    upAgain.focus();
    upAgain.click();
    flushSync();
    expect(rows()[0].name).toBe('alpha');

    remove0.focus();
    expect(document.activeElement).toBe(remove0);
    remove0.click();
    flushSync();
    expect(rows()).toHaveLength(1);
  });

  it('puts a row’s cells BEFORE its tools, so reading order is edit-then-act', () => {
    pageBuilder.open(PAGE_ID, pageWith(sectionOfType('ache')));
    mountEditor(live());
    const block = [
      ...document.body.querySelectorAll<HTMLElement>('.section-editor__field'),
    ].find(
      (el) =>
        el
          .querySelector('.section-editor__field-label')
          ?.textContent?.trim() === 'Points'
    ) as HTMLElement;
    const add = [...block.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Add point')
    ) as HTMLButtonElement;
    add.click();
    flushSync();

    const row = block.querySelector('.af__row') as HTMLElement;
    const cells = row.querySelector('.af__cells') as HTMLElement;
    const tools = row.querySelector('.af__tools') as HTMLElement;
    // DOCUMENT_POSITION_FOLLOWING === 4: tools come after cells.
    expect(cells.compareDocumentPosition(tools) & 4).toBe(4);
  });
});

describe('5 · the variant picker', () => {
  const REEL = 'reel';

  it('makes every AVAILABLE composition focusable and operable', () => {
    const variants = [
      {
        id: 'theatre',
        label: 'Theatre',
        hint: 'One clip, large',
        thumb: 'media',
      },
      {
        id: 'strip',
        label: 'Strip',
        hint: 'A row of clips',
        thumb: 'grid',
        unavailable: 'Not built yet',
      },
    ];
    let picked: string | null = null;
    mounted = mount(VariantPicker, {
      target: document.body,
      props: {
        variants,
        selected: 'theatre',
        onselect: (id: string) => {
          picked = id;
        },
      },
    });
    flushSync();

    const options = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.vp-opt'),
    ];
    expect(options).toHaveLength(2);
    options[0].focus();
    expect(document.activeElement).toBe(options[0]);
    options[0].click();
    expect(picked).toBe('theatre');

    // A DESCOPED option is not focusable, which is correct — and is exactly why
    // its reason may not live in a `title`.
    expect(options[1].disabled).toBe(true);
    options[1].focus();
    expect(document.activeElement).not.toBe(options[1]);
  });

  it('states a descoped composition’s reason as TEXT, not as a title', () => {
    // A disabled button takes no focus and shows no tooltip on touch, so a `title`
    // would be the one place neither a keyboard nor a touch user could reach it.
    // The reason also REPLACES the hint — a hint about what the option does is
    // noise while it cannot be chosen.
    mounted = mount(VariantPicker, {
      target: document.body,
      props: {
        variants: [
          {
            id: 'strip',
            label: 'Strip',
            hint: 'A row of clip thumbnails',
            thumb: 'grid',
            unavailable: 'Not built yet — needs three to five clips',
          },
        ],
        selected: 'theatre',
        onselect: () => {},
      },
    });
    flushSync();

    const option = document.body.querySelector<HTMLButtonElement>('.vp-opt');
    expect(option?.getAttribute('title')).toBeNull();
    expect(option?.textContent).toContain('Not built yet');
    expect(option?.textContent).not.toContain('A row of clip thumbnails');
  });

  it('pins WHICH compositions the catalogue actually descopes', () => {
    // The two cases above use a hand-built fixture, so this is what ties them to
    // the real catalogue: if `strip` ships, or a second composition is descoped,
    // this goes red and whoever did it comes and reads them.
    const descoped = Object.keys(SECTION_FIELDS).flatMap((type) =>
      variantsForType(type)
        .filter((v) => v.unavailable)
        .map((v) => `${type}/${v.id}`)
    );
    expect(descoped).toEqual([`${REEL}/strip`]);
    // And the reason is real prose, not a placeholder — it is the only text a
    // creator gets for an option they cannot choose.
    const strip = variantsForType(REEL).find((v) => v.id === 'strip');
    expect((strip?.unavailable ?? '').length).toBeGreaterThan(20);
  });
});

describe('5 · the canvas’s floating add-picker is reachable from the keyboard', () => {
  const OFFER: CourseOffer = {
    courseId: COURSE_ID,
    organizationId: 'o1',
    paths: ['purchase'],
    purchase: { priceCents: 2700 },
    subscription: null,
    tiers: [],
    entitled: false,
  };

  function openCanvas(): void {
    pageBuilder.open(PAGE_ID, {
      pageType: 'course',
      slug: 'demo',
      title: 'Demo',
      status: 'draft',
      subjectType: 'course',
      subjectId: COURSE_ID,
      brandOverrides: null,
      sections: [
        { id: 'k-hero', type: 'hero', enabled: true, props: {} },
        { id: 'k-invite', type: 'invite', enabled: true, props: {} },
      ] as PageSection[],
    } as PageBuilderState);
    pageBuilder.selectSection('k-hero');
    mounted = mount(JourneyBuilderCanvas, {
      target: document.body,
      props: {
        course: { id: COURSE_ID, slug: 'demo', title: 'Demo' },
        checkoutUrl: '/journeys/demo/checkout',
        dashboardUrl: '/journeys/demo/dashboard',
        offer: OFFER,
      },
    });
    flushSync();
  }

  const addAfterBtn = (): HTMLButtonElement =>
    document.body.querySelector(
      '.jbc-block__btn[aria-label*="after"]'
    ) as HTMLButtonElement;

  it('moves focus INTO the picker when it opens, and BACK when it closes', () => {
    // THE DEFECT. The popover is rendered as the component's LAST child while it
    // appears beside the block toolbar, so tab order and visual order disagreed
    // entirely: pressing this button with a keyboard opened a picker the next Tab
    // did not reach. It was mouse-only in practice, on the one surface whose
    // keyboard path was deliberately built out.
    openCanvas();
    const trigger = addAfterBtn();
    expect(
      trigger,
      'no "add a section after this" button on the selected block'
    ).toBeTruthy();

    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    flushSync();

    const search = document.body.querySelector<HTMLInputElement>(
      '.jbc-addpop .add-picker__input'
    );
    expect(search, 'the popover did not open').not.toBeNull();
    expect(
      document.activeElement,
      'focus stayed on the trigger — the picker is hundreds of tab stops away'
    ).toBe(search);

    // Escape closes it AND hands focus back. A popover that drops focus at the top
    // of the document is its own trap.
    search?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flushSync();
    expect(document.body.querySelector('.jbc-addpop')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on the scrim too, and still returns focus', () => {
    openCanvas();
    const trigger = addAfterBtn();
    trigger.focus();
    trigger.click();
    flushSync();

    // ESTABLISH THAT FOCUS ACTUALLY LEFT, or the assertion below is vacuous: with
    // no focus move on open, focus never leaves the trigger and
    // `activeElement === trigger` after closing is trivially true. Verified by
    // mutation — dropping `focusOnMount` left this case GREEN until this line.
    expect(document.activeElement).not.toBe(trigger);

    const scrim =
      document.body.querySelector<HTMLButtonElement>('.jbc-addpop__scrim');
    expect(scrim).not.toBeNull();
    scrim?.click();
    flushSync();
    expect(document.body.querySelector('.jbc-addpop')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HONEST WHEN DISABLED
// ─────────────────────────────────────────────────────────────────────────────

describe('6 · every disabled control in this directory is classified', () => {
  /**
   * The reviewed inventory of `disabled=` bindings, keyed by the EXPRESSION.
   *
   * A TABLE RATHER THAN A COUNT, deliberately. A count drifts and then gets
   * "corrected" upward by whoever is inconvenienced by it; a table names the
   * reason each site is allowed to be disabled, so a NEW site fails until someone
   * writes down why it may exist. That is the only version of this guard that
   * still bites a year from now.
   *
   * Two honesty classes:
   *   'self-evident' — the state is visible in the control's own position (the
   *                    first row cannot move up), so no prose is owed.
   *   'stated'       — the reason is rendered as text; the behavioural cases below
   *                    assert that text for each one.
   */
  const CLASSIFIED: Readonly<Record<string, 'self-evident' | 'stated'>> = {
    // ArrayField — row tools and the cap
    'rowIndex === 0': 'self-evident',
    'rowIndex === rows.length - 1': 'self-evident',
    atCap: 'stated',
    // SectionEditor — the design-axis gate
    'Boolean(gate)': 'stated',
    // SectionList — row reorder
    'i === 0': 'self-evident',
    'i === sections.length - 1': 'self-evident',
    // JourneyBuilderCanvas — block toolbar reorder
    'vi <= 0': 'self-evident',
    'vi >= renderables.length - 1': 'self-evident',
    // PageMediaPanel — three upload forms
    'coverBusy || !sellMedia.pageId': 'stated',
    coverBusy: 'stated',
    'heroImageBusy || !sellMedia.pageId': 'stated',
    heroImageBusy: 'stated',
    'signatureImageBusy || !sellMedia.pageId': 'stated',
    signatureImageBusy: 'stated',
    // PagePricingPanel — the authoritative-read lock
    locked: 'stated',
    'locked || !isCoursePage': 'stated',
    // VariantPicker — a descoped composition
    '!!blocked': 'stated',
  };

  it('has no unclassified `disabled=` site', () => {
    const found = new Map<string, string[]>();
    for (const file of COMPONENTS) {
      for (const match of read(join(HERE, file)).matchAll(
        /disabled=\{([^}]*)\}/g
      )) {
        const expr = match[1].trim();
        found.set(expr, [...(found.get(expr) ?? []), file]);
      }
    }
    const unclassified = [...found.entries()]
      .filter(([expr]) => !(expr in CLASSIFIED))
      .map(([expr, files]) => `${expr}  (${files.join(', ')})`);
    expect(unclassified).toEqual([]);
    // And the inventory must not rot in the other direction: an entry for a site
    // that no longer exists is a claim about code that is gone.
    const stale = Object.keys(CLASSIFIED).filter((expr) => !found.has(expr));
    expect(stale).toEqual([]);
  });
});

describe('6 · a control that cannot do its job says so', () => {
  /**
   * EVERY array field, not just one, and derived rather than listed.
   *
   * All seven declare a `maxItems`, so all seven have a reachable dead state —
   * and a cap with no message is the same defect as a dead-end CTA, just quieter.
   * Exercising one and reasoning "same component" would leave six rows READ where
   * they can as easily be TOUCHED.
   */
  const ARRAY_ROWS = Object.entries(SECTION_FIELDS).flatMap(([type, fields]) =>
    fields
      .filter((f) => f.control === 'list' || f.control === 'repeater')
      .map((f) => ({ type, field: f }))
  );

  it('has an array field in every type that declares one, all capped', () => {
    expect(ARRAY_ROWS.length).toBeGreaterThan(0);
    for (const row of ARRAY_ROWS) {
      expect(
        row.field.maxItems,
        `${row.type}.${row.field.key} declares no cap, so its dead state is unreachable`
      ).toBeTruthy();
    }
  });

  for (const row of ARRAY_ROWS) {
    it(`states the CAP when ${row.type}.${row.field.key}'s add button goes dead`, () => {
      const cap = row.field.maxItems as number;
      pageBuilder.open(PAGE_ID, pageWith(sectionOfType(row.type)));
      mountEditor(live());
      const block = [
        ...document.body.querySelectorAll<HTMLElement>(
          '.section-editor__field'
        ),
      ].find(
        (el) =>
          el
            .querySelector('.section-editor__field-label')
            ?.textContent?.trim() === row.field.label
      ) as HTMLElement;
      expect(block, `no "${row.field.label}" field block`).toBeTruthy();
      const add = block.querySelector('.af__add') as HTMLButtonElement;

      for (let i = 0; i < cap; i += 1) {
        expect(
          add.disabled,
          `add went dead at row ${i}, below the cap of ${cap}`
        ).toBe(false);
        add.click();
        flushSync();
      }

      expect(add.disabled).toBe(true);
      // The cap message belongs to THIS field's own group, not to a nested one —
      // `invite.offers` rows each contain a nested `bullets` list with its own
      // `.af__cap`, so the message is read from the group's FIRST one.
      const reason = block.querySelector('.af__cap')?.textContent ?? '';
      expect(
        reason,
        'the add button went dead with no reason on screen'
      ).toContain(String(cap));
    });
  }

  it('states WHY the pricing panel is locked when there is no course behind the page', () => {
    // THE SILENT THIRD CAUSE. The route opens the store with
    // `monetisation.open(subjectType === 'course' ? subjectId : null)`, and
    // `open(null)` leaves `loaded` false, `loading` false and `loadError` null for
    // ever — so `locked` was true, four controls were disabled, and the panel said
    // nothing. The route's own sell-media call two lines earlier guards on BOTH
    // halves (`subjectType === 'course' && !!subjectId`), which is what makes this
    // an asymmetry between adjacent calls rather than a hypothesis.
    pageBuilder.open(
      PAGE_ID,
      pageWith(sectionOfType('invite'), { subjectId: null })
    );
    mounted = mount(PagePricingPanel, { target: document.body, props: {} });
    flushSync();

    const said = [
      ...document.body.querySelectorAll('[role="status"], [role="alert"]'),
    ]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(said, 'the panel locks its controls and gives no reason').toContain(
      'no course is attached'
    );

    // And it is the LOCK it is explaining: the controls really are dead.
    const dead = [
      ...document.body.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button[disabled], input[disabled]'
      ),
    ];
    expect(
      dead.length,
      'nothing was disabled, so there is nothing to explain'
    ).toBeGreaterThan(0);
  });

  it('does NOT claim a course page with a subject has no course', () => {
    // The negative control for the case above. Without it the message could be
    // unconditional and this suite would still be green.
    pageBuilder.open(PAGE_ID, pageWith(sectionOfType('invite')));
    mounted = mount(PagePricingPanel, { target: document.body, props: {} });
    flushSync();
    const said = [
      ...document.body.querySelectorAll('[role="status"], [role="alert"]'),
    ]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(said).not.toContain('no course is attached');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The handoff's failing witness
// ─────────────────────────────────────────────────────────────────────────────

describe('the media picker’s own name is still a placeholder — handoff witness', () => {
  it('has an aria-labelledby that points at nothing', () => {
    // NOT A FAILING TEST — a PINNED one. Melt's combobox writes an
    // `aria-labelledby` naming a `$label` element `MediaPicker` never renders, so
    // the reference dangles and the widget's accessible name falls through to the
    // shared placeholder. This directory's fix is the named GROUP around it
    // (asserted in the per-row sweep); naming the widget itself needs a `label`
    // prop on `MediaPicker`, which lives in `components/studio`.
    //
    // WHEN THAT PROP LANDS THIS TEST GOES RED, and that is the point: it is the
    // witness that the handoff is still open, and it fails the moment it closes.
    pageBuilder.open(PAGE_ID, pageWith(sectionOfType('hero')));
    mountEditor(live());

    const input = document.body.querySelector<HTMLInputElement>(
      'input.picker-trigger'
    );
    expect(
      input,
      'no media picker rendered in the hero inspector'
    ).not.toBeNull();
    const ids = input?.getAttribute('aria-labelledby') ?? '';
    expect(
      ids,
      'Melt no longer sets aria-labelledby — re-read this test'
    ).not.toBe('');
    for (const id of ids.split(/\s+/)) {
      expect(
        document.getElementById(id),
        `aria-labelledby "${id}" now resolves — MediaPicker gained a real label, so the group workaround can go`
      ).toBeNull();
    }
    // Which leaves the placeholder as the widget's only name.
    expect(input?.getAttribute('placeholder')).toBeTruthy();

    // The GROUP is what carries the field's name meanwhile.
    const group = input?.closest('[role="group"]');
    expect(group).not.toBeNull();
    const labelledBy = group?.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(labelledBy)?.textContent).toBe('Hero image');
  });
});
