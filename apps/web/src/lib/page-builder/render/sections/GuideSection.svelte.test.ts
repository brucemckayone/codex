/**
 * GuideSection — the five compositions, the read boundary and the write-back key
 * (`docs/design/journey-sections/02-axis-contract.md` A9/A28/A56/A60).
 *
 * WHAT THIS FILE IS FOR, and what it deliberately leaves to the browser.
 *
 * The axes are CSS custom properties resolved on an ANCESTOR (`.jp-sec`), so jsdom —
 * which implements neither `container-type`, `cqw`, `aspect-ratio` resolution nor
 * `getAnimations()` — cannot say anything true about what an axis PAINTS. Geometry,
 * contrast, tap targets and the reduced-motion kill switch are verified by
 * measurement in a real browser and recorded in the WP report (contract A10).
 *
 * What jsdom CAN pin down, and what this file exists to pin down:
 *
 *  - which composition renders, and WHERE the plate / quote / signature sit inside
 *    it — the compositions differ by DOM POSITION as much as by CSS, so a
 *    regression there is invisible to any attribute-level check;
 *  - the read boundary: the two bridged aliases (`role`/`body`) that this component
 *    was the last type not to consume (`Codex-tqr51`), and the three keys it owed
 *    (`clip`/`duration`/`facts`, contract A28);
 *  - the WRITE-BACK key (contract A60) — an inline edit must target the alias the
 *    value was READ from, or a page storing `role` grows a second copy of the value
 *    under `eyebrow` and the creator's edit renders as nothing;
 *  - that the streamed `sellPreview` media (`guidePortraitUrl`, `guideClip`,
 *    `signatureUrl`) actually reaches the markup — all three were WRITE-ONLY
 *    codebase-wide until contract A15/A27, and `letter` cannot exist without the
 *    third;
 *  - that the copy is real server-rendered TEXT rather than an element a
 *    client-side action fills in later (pilot lesson 9).
 *
 * A NOTE ON THE FIXTURES. There are ZERO `guide` sections in the database, so
 * nothing here is a regression guard for an existing page — it is the first
 * description of this section's contract. The `defaultProps` fixture below is
 * literally what `section-catalog.ts` seeds when a creator adds the section in the
 * builder, which is what makes the A56 assertion meaningful: it proves the
 * catalogue's seeded variant is one the renderer actually honours.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import GuideSection from './GuideSection.svelte';

/** The Candlelit bundle — the axes every existing published page stores (A51). */
const CANDLELIT: ResolvedSectionDesign = {
  width: 'text',
  density: 'airy',
  surface: 'media',
  edge: 'none',
  align: 'center',
  type: 'monumental',
  accent: 'glow',
  motion: 'drift',
  media: 'bleed',
};

/**
 * Exactly what `section-catalog.ts:601` seeds for a `guide` section added through
 * the builder — placeholder copy included, because that is the fixture a real page
 * gets (`Codex-maf0y`).
 */
const CATALOGUE_DEFAULT_PROPS: SectionProps = {
  role: 'Your guide',
  heading: 'Who holds this',
  body: 'A short bio that establishes credibility and warmth.',
  quote: '',
  clip: 'Meet your guide',
  duration: '2:00',
};

function context(
  overrides: Partial<JourneySalesContext> = {}
): JourneySalesContext {
  return {
    course: {
      id: 'c1',
      slug: 'demo',
      title: 'The course title',
      kicker: null,
      lede: null,
      status: 'published',
      priceCents: null,
      stageCount: 1,
      practiceCount: 1,
    },
    stages: [],
    testimonials: [],
    checkoutUrl: 'http://lvh.me:3000/journeys/demo/checkout',
    dashboardUrl: 'http://lvh.me:3000/journeys/demo/dashboard',
    enrolled: false,
    offer: null,
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview | null>(null),
    ...overrides,
  };
}

/** A resolved sell-preview carrying only the fields a `guide` section reads. */
function preview(fields: Partial<SellPreview>): JourneySalesContext {
  return context({
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview>({
      intro: null,
      reel: null,
      ...fields,
    }),
  });
}

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  context?: JourneySalesContext;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(GuideSection, {
    target: document.body,
    props: {
      config: props.config ?? CATALOGUE_DEFAULT_PROPS,
      context: props.context ?? context(),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

/** `{#await}` on the streamed preview needs a microtask turn before asserting. */
async function settle() {
  await Promise.resolve();
  await tick();
  flushSync();
}

/** The `.guide__body` children, by first class — the composition's copy order. */
function bodyChildren(): string[] {
  const body = document.body.querySelector('.guide__body');
  return [...(body?.children ?? [])].map(
    (c) => String(c.className).split(' ')[0]
  );
}

afterEach(() => {
  if (component) {
    unmount(component);
    component = undefined;
  }
  document.body.innerHTML = '';
});

describe('GuideSection — compositions', () => {
  it('defaults to `portrait`: the plate leads, then the copy column', () => {
    render({ variant: 'portrait' });

    const inner = document.body.querySelector('.guide__inner');
    // First class only — Svelte appends a scope hash to every styled element.
    expect(
      [...(inner?.children ?? [])].map((c) => String(c.className).split(' ')[0])
    ).toEqual(['guide__plate', 'guide__body']);
    expect(document.body.querySelector('.guide--portrait')).not.toBeNull();
  });

  it('honours the catalogue default variant — A56, checked on the seed itself', () => {
    // `defaultVariant: 'portrait'` in `section-catalog.ts`. 0087 and 0089 both had
    // to CLEAN UP a seeder writing a variant the renderer discarded; running the
    // check on the catalogue's own seed catches that class of defect BEFORE a page
    // exists rather than after. No `variant` prop at all is the same path a
    // pre-variant client takes.
    render({ variant: undefined });

    expect(document.body.querySelector('.guide--portrait')).not.toBeNull();
    expect(document.body.querySelector('.guide__plate')).not.toBeNull();
  });

  it('falls back to `portrait` for a variant the catalogue does not declare', () => {
    render({ variant: 'no-such-composition' });

    expect(document.body.querySelector('.guide--portrait')).not.toBeNull();
    expect(
      document.body.querySelector('.guide__heading')?.textContent
    ).toContain('Who holds this');
  });

  it('`column` drops the plate entirely — the no-media arrangement', () => {
    // This is the retired `centered` variant's destination:
    // `LEGACY_SECTION_VARIANTS.guide.centered` maps to
    // `{variant: 'column', design: {align: 'center', width: 'narrow'}}`, and the
    // canvas rule it comes from is `.jp-guide--centered .jp-guide__player
    // {display: none}`.
    render({ variant: 'column' });

    expect(document.body.querySelector('.guide--column')).not.toBeNull();
    expect(document.body.querySelector('.guide__plate')).toBeNull();
  });

  it('`quote` leads with the pull-quote and KEEPS the bio beneath it', () => {
    // The canvas hid the bio (`.jp-guide--quote .jp-guide__body {display: none}`);
    // the catalogue's hint is "A big pull-quote leads; bio and attribution
    // beneath", and the hint is the specification. Pinned so the divergence cannot
    // be silently reverted by a later port.
    render({
      variant: 'quote',
      config: { ...CATALOGUE_DEFAULT_PROPS, quote: 'The one true sentence.' },
    });

    expect(bodyChildren()).toEqual([
      'guide__quote',
      'jp-sec__eyebrow',
      'jp-sec__heading',
      'guide__bio',
    ]);
    expect(document.body.querySelector('.guide__plate')).toBeNull();
    expect(document.body.querySelector('.guide__bio')?.textContent).toContain(
      'credibility and warmth'
    );
  });

  it('`credentials` keeps the plate and renders the fact list as a <dl>', () => {
    render({
      variant: 'credentials',
      config: {
        ...CATALOGUE_DEFAULT_PROPS,
        facts: [
          { label: 'Practising', detail: 'since 2009' },
          { label: 'Students', detail: '2,400' },
        ],
      },
    });

    expect(document.body.querySelector('.guide__plate')).not.toBeNull();
    const dl = document.body.querySelector('dl.guide__facts');
    expect(dl).not.toBeNull();
    expect(dl?.querySelectorAll('.guide__fact')).toHaveLength(2);
    expect(dl?.querySelector('dt')?.textContent).toBe('Practising');
    expect(dl?.querySelector('dd')?.textContent).toBe('since 2009');
  });

  it('`letter` has no plate and signs off at the foot', () => {
    render({
      variant: 'letter',
      config: { ...CATALOGUE_DEFAULT_PROPS, name: 'A Name' },
    });

    expect(document.body.querySelector('.guide__plate')).toBeNull();
    // The signature block is LAST — a letter signs off at the foot.
    expect(bodyChildren().at(-1)).toBe('guide__sign');
    expect(document.body.querySelector('.guide__signoff')?.textContent).toBe(
      'A Name'
    );
  });

  it('renders nothing at all when there is no bio, name or heading', () => {
    render({ config: { quote: 'A quote with nothing to attribute it to.' } });

    expect(document.body.querySelector('.guide')).toBeNull();
  });
});

describe('GuideSection — the read boundary (Codex-tqr51 · A28)', () => {
  it("reads the builder's `role` and `body`, not just the renderer's own names", () => {
    // The bridge (`coerce.ts` `SECTION_PROP_ALIASES.guide`) has declared
    // `eyebrow: ['eyebrow', 'role']` and `bio: ['bio', 'body']` since F-A, and this
    // component consumed NEITHER — zero `asStringFrom`, zero `aliasKeys`. A page
    // authored in the builder rendered no eyebrow and no bio.
    render({ config: { role: 'Your guide', body: 'One paragraph.' } });

    expect(document.body.querySelector('.guide__eyebrow')?.textContent).toBe(
      'Your guide'
    );
    expect(document.body.querySelector('.guide__bio')?.textContent).toContain(
      'One paragraph.'
    );
  });

  it("prefers the renderer's own key when a page stores both", () => {
    // The alias lists are ORDERED preference lists, and the renderer's name is
    // first so a page authored against it still wins.
    render({
      config: {
        eyebrow: 'Wins',
        role: 'Loses',
        bio: ['Wins too'],
        body: 'Loses',
      },
    });

    expect(document.body.querySelector('.guide__eyebrow')?.textContent).toBe(
      'Wins'
    );
    expect(document.body.querySelector('.guide__bio')?.textContent).toContain(
      'Wins too'
    );
  });

  it("splits the builder's single `body` textarea into paragraphs", () => {
    // The builder's control is a TEXTAREA (one string); the renderer's `bio` prop
    // is `string[]`. Splitting on newlines reconciles the shapes with no migration.
    render({ config: { body: 'First para.\n\nSecond para.\nThird para.' } });

    const paras = document.body.querySelectorAll('.guide__bio p');
    expect([...paras].map((p) => p.textContent)).toEqual([
      'First para.',
      'Second para.',
      'Third para.',
    ]);
  });

  it('reads the three keys it owed: `clip`, `duration` and `facts`', async () => {
    // `OWED_READS.guide = ['clip', 'duration', 'facts']` in
    // `components/page-builder/section-fields.test.ts`. That entry must now be
    // DELETED, because the suite also asserts each owed key is still genuinely
    // unread — which is contract A28 working as designed.
    render({
      config: {
        ...CATALOGUE_DEFAULT_PROPS,
        facts: [{ label: 'Years', detail: '16' }],
      },
      context: preview({
        guideClip: {
          playlistUrl: 'https://cdn.example/guide.m3u8',
          posterUrl: null,
          durationSeconds: 120,
        },
      }),
    });
    await settle();

    expect(document.body.querySelector('.guide__tag')?.textContent).toBe(
      'Meet your guide'
    );
    expect(document.body.querySelector('.guide__dur')?.textContent).toBe(
      '2:00'
    );
    expect(document.body.querySelector('.guide__facts')).not.toBeNull();
  });

  it('shows the on-frame LABEL without a clip but never the duration', async () => {
    // A caption over a portrait is meaningful; a RUNTIME over a portrait is a
    // falsehood. `section-catalog.ts` seeds `duration: '2:00'` into every new
    // guide section, so without this gate wiring the read would publish an
    // advertised runtime for a video that does not exist (`Codex-maf0y`).
    render({
      config: CATALOGUE_DEFAULT_PROPS,
      context: preview({ guideClip: null }),
    });
    await settle();

    expect(document.body.querySelector('.guide__tag')?.textContent).toBe(
      'Meet your guide'
    );
    expect(document.body.querySelector('.guide__dur')).toBeNull();
  });

  it('renders NOTHING for the string the editor actually writes into `facts`', () => {
    // MEASURED FIXTURE, verbatim from `studio-alpha`/`bone-deep` (landing page
    // `4664e6ce…`): `"facts": "20 years teaching — somatics and grief work"`.
    //
    // `facts` is declared `control: 'repeater'` with `itemFields: [{label},
    // {detail}]`, but `SectionEditor.svelte:183-231` has no `repeater` branch and
    // falls through a catch-all `{:else}` to `<input type="text">`, so `onInput`
    // writes a raw STRING. The field is MIS-authorable, not merely unauthorable.
    //
    // The renderer deliberately refuses that shape. Coercing it to `{label: <the
    // whole string>}` would be a guess — the field has two sub-fields and a
    // free-typed string says nothing about which — and shipping the guess would
    // make it a rendering contract the eventual repeater migration must preserve.
    // Rendering nothing keeps the corrupt value inert. This test exists so nobody
    // "helpfully" adds the string branch back.
    render({
      variant: 'credentials',
      config: {
        ...CATALOGUE_DEFAULT_PROPS,
        facts: '20 years teaching — somatics and grief work',
      },
    });

    expect(document.body.querySelector('.guide__facts')).toBeNull();
    expect(document.body.querySelector('.guide__fact')).toBeNull();
    // The rest of the composition still renders — a malformed field self-hides,
    // it does not take the section down.
    expect(document.body.querySelector('.guide--credentials')).not.toBeNull();
    expect(
      document.body.querySelector('.guide__heading')?.textContent
    ).toContain('Who holds this');
  });

  it('renders `facts` in its DECLARED array shape', () => {
    render({
      variant: 'credentials',
      config: {
        facts: [{ label: 'Years', detail: '20' }],
        heading: 'Who holds this',
      },
    });

    const rows = document.body.querySelectorAll('.guide__fact');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('dt')?.textContent).toBe('Years');
    expect(rows[0]?.querySelector('dd')?.textContent).toBe('20');
  });

  it('falls back to the legacy `credentials` string array for the fact list', () => {
    // Not the A30 trap: `credentials` appears in no `SECTION_FIELDS.guide` entry,
    // so no creator can ever have stored it, and the preference runs
    // `facts` ?? `credentials` rather than the other way round.
    render({
      variant: 'credentials',
      config: { name: 'A Name', credentials: ['MSc', 'BACP'] },
    });

    const labels = [...document.body.querySelectorAll('.guide__fact dt')].map(
      (dt) => dt.textContent
    );
    expect(labels).toEqual(['MSc', 'BACP']);
  });
});

describe('GuideSection — the streamed sell-preview media (A15 · A27)', () => {
  it('renders the projected portrait once the preview resolves', async () => {
    render({
      context: preview({
        guidePortraitUrl: 'https://cdn.example/portrait.jpg',
      }),
    });
    await settle();

    const img = document.body.querySelector<HTMLImageElement>('.guide__img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/portrait.jpg');
    // The monogram is the no-portrait state and must be gone.
    expect(document.body.querySelector('.guide__mark')).toBeNull();
  });

  it('falls back to the monogram when no portrait is picked', async () => {
    render({
      context: preview({ guidePortraitUrl: null }),
      config: { name: 'Rowan' },
    });
    await settle();

    expect(document.body.querySelector('.guide__img')).toBeNull();
    expect(document.body.querySelector('.guide__mark')?.textContent).toBe('R');
  });

  it('uses the guide clip POSTER as the plate image when there is no portrait', async () => {
    render({
      context: preview({
        guidePortraitUrl: null,
        guideClip: {
          playlistUrl: 'https://cdn.example/guide.m3u8',
          posterUrl: 'https://cdn.example/guide-poster.jpg',
          durationSeconds: 125,
        },
      }),
    });
    await settle();

    expect(
      document.body.querySelector<HTMLImageElement>('.guide__img')?.src
    ).toContain('guide-poster.jpg');
  });

  it('ships a play button ONLY when a real clip resolved', async () => {
    render({ context: preview({ guideClip: null }) });
    await settle();
    expect(document.body.querySelector('.guide__play')).toBeNull();

    if (component) unmount(component);
    component = undefined;
    document.body.innerHTML = '';

    render({
      context: preview({
        guideClip: {
          playlistUrl: 'https://cdn.example/guide.m3u8',
          posterUrl: null,
          durationSeconds: 125,
        },
      }),
    });
    await settle();

    const play = document.body.querySelector('.guide__play');
    expect(play).not.toBeNull();
    // An icon-only control needs an accessible name.
    expect(play?.getAttribute('aria-label')).toBeTruthy();
  });

  it('prefers the AUTHORED duration over the clip’s own (A42 precedence)', async () => {
    render({
      config: { ...CATALOGUE_DEFAULT_PROPS, duration: '2:00' },
      context: preview({
        guideClip: {
          playlistUrl: 'https://cdn.example/guide.m3u8',
          posterUrl: null,
          durationSeconds: 125,
        },
      }),
    });
    await settle();

    // 125s would format as 2:05; the creator's own string wins.
    expect(document.body.querySelector('.guide__dur')?.textContent).toBe(
      '2:00'
    );
  });

  it('derives the duration from the clip when nothing is authored', async () => {
    render({
      config: { role: 'Your guide', heading: 'Who holds this' },
      context: preview({
        guideClip: {
          playlistUrl: 'https://cdn.example/guide.m3u8',
          posterUrl: null,
          durationSeconds: 125,
        },
      }),
    });
    await settle();

    expect(document.body.querySelector('.guide__dur')?.textContent).toBe(
      '2:05'
    );
  });

  it('signs the `letter` with the projected signature still', async () => {
    // `signatureUrl` is what made `letter` buildable at all: A27 descoped the
    // composition when `courses` had no signature slot, and stage F-D added the
    // column (migration 0086). Without this the composition would have to invent
    // a synthetic mark, which is the mistake A27 calls out on `hero.split`.
    render({
      variant: 'letter',
      config: { ...CATALOGUE_DEFAULT_PROPS, name: 'Rowan' },
      context: preview({ signatureUrl: 'https://cdn.example/sig.png' }),
    });
    await settle();

    const sig = document.body.querySelector<HTMLImageElement>('.guide__sig');
    expect(sig?.getAttribute('src')).toBe('https://cdn.example/sig.png');
    // Decorative: the name is announced as text directly beneath it.
    expect(sig?.getAttribute('alt')).toBe('');
  });

  it('the `letter` still signs off with the name when no signature is picked', async () => {
    render({
      variant: 'letter',
      config: { ...CATALOGUE_DEFAULT_PROPS, name: 'Rowan' },
      context: preview({ signatureUrl: null }),
    });
    await settle();

    expect(document.body.querySelector('.guide__sig')).toBeNull();
    expect(document.body.querySelector('.guide__signoff')?.textContent).toBe(
      'Rowan'
    );
  });
});

describe('GuideSection — the edit seam', () => {
  it('serves REAL text with no seam when not editable (pilot lesson 9)', () => {
    // `EditableText` renders an EMPTY element and fills `textContent` from a
    // Svelte action, and actions do not run during SSR — so using it here would
    // serve `<h2></h2>` on the public page. This asserts the opposite.
    render({
      config: { role: 'Your guide', heading: 'Who holds this', body: 'A bio.' },
    });

    const heading = document.body.querySelector('.guide__heading');
    expect(heading?.textContent?.trim()).toBe('Who holds this');
    expect(heading?.hasAttribute('contenteditable')).toBe(false);
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('writes an edit back to the alias the value was READ from (A60)', () => {
    // A page storing the builder's `role` must edit as `role`. Writing `eyebrow`
    // would leave the page holding BOTH, `role` would keep winning the preference
    // list, and the creator's edit would render as nothing while the data silently
    // grew a second copy.
    const onEdit = vi.fn();
    render({
      config: { role: 'Your guide', body: 'A bio.' },
      editable: true,
      onEdit,
    });

    const eyebrow = document.body.querySelector('.guide__eyebrow');
    expect(eyebrow?.getAttribute('data-field')).toBe('role');
    expect(
      document.body.querySelector('.guide__bio')?.getAttribute('data-field')
    ).toBe('body');
  });

  it('writes back to the canonical key when THAT is what the page stores', () => {
    const onEdit = vi.fn();
    render({
      config: { eyebrow: 'Your guide', bio: ['A bio.'] },
      editable: true,
      onEdit,
    });

    expect(
      document.body.querySelector('.guide__eyebrow')?.getAttribute('data-field')
    ).toBe('eyebrow');
    expect(
      document.body.querySelector('.guide__bio')?.getAttribute('data-field')
    ).toBe('bio');
  });

  it('falls back to the key `section-fields.ts` writes when neither is stored', () => {
    // A section holding neither alias should ACQUIRE the builder's own key, which
    // is what the field definition writes.
    const onEdit = vi.fn();
    render({ config: { heading: 'Who holds this' }, editable: true, onEdit });

    // No eyebrow renders (nothing stored), so the heading is the probe: `heading`
    // is unaliased and is its own key either way.
    expect(
      document.body.querySelector('.guide__heading')?.getAttribute('data-field')
    ).toBe('heading');
  });

  it('reports the edited value under that same key', () => {
    const onEdit = vi.fn();
    render({
      config: { role: 'Your guide', body: 'A bio.' },
      editable: true,
      onEdit,
    });

    const eyebrow = document.body.querySelector<HTMLElement>('.guide__eyebrow');
    expect(eyebrow).not.toBeNull();
    if (!eyebrow) return;
    eyebrow.textContent = 'Edited';
    eyebrow.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(onEdit).toHaveBeenCalledWith('role', 'Edited');
  });
});
