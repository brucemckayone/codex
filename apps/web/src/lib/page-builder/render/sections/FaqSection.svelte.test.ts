/**
 * FaqSection — the five compositions, the `g1-g3` group read and the collapse
 * check (`docs/design/journey-sections/02-axis-contract.md` A9/A28/A30).
 *
 * WHAT THIS FILE IS FOR. The axes are custom properties resolved on an ANCESTOR
 * (`.jp-sec`) and jsdom implements neither container queries nor `color-mix()`, so
 * contrast and geometry are measured in a real browser and recorded in the WP
 * report (contract A10). What jsdom pins down is what this component decides in
 * MARKUP, and for `faq` that is unusually load-bearing:
 *
 *  - COLLAPSIBLE vs STATIC. `accordion`/`boxed`/`grouped` render `<details>`;
 *    `open`/`paired` render none, because a `<details open>` that is never meant
 *    to close advertises an affordance that is not there. That is a DOM
 *    difference no attribute check sees.
 *  - THE COLLAPSE CHECK (A9 stage 2). `accordion` must still render every row
 *    CLOSED, which is what the published page has always served. The canvas twin
 *    opens the first row; the public page never has, and the published page wins.
 *  - THE `g1-g3` READ. `OWED_READS.faq` (A28). Clustering is pure markup logic.
 *  - REAL TEXT CHILDREN under `editable` (pilot lesson 9 — the SEO contract).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../types';
import FaqSection from './FaqSection.svelte';

const CANDLELIT: ResolvedSectionDesign = {
  width: 'narrow',
  density: 'airy',
  surface: 'media',
  edge: 'none',
  align: 'center',
  type: 'monumental',
  accent: 'glow',
  motion: 'drift',
  media: 'bleed',
};

function context(): JourneySalesContext {
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
    sellPreview: Promise.resolve<SellPreview | null>(null),
  };
}

/** Three Q&As in the builder's numbered vocabulary — what pages actually store. */
const FLAT: SectionProps = {
  heading: 'The honest answers',
  q1: 'First question?',
  a1: 'First answer.',
  q2: 'Second question?',
  a2: 'Second answer.',
  q3: 'Third question?',
  a3: 'Third answer.',
};

let component: ReturnType<typeof mount> | undefined;

function render(props: {
  config?: SectionProps;
  variant?: string;
  design?: ResolvedSectionDesign;
  editable?: boolean;
  onEdit?: (key: string, value: string) => void;
}) {
  component = mount(FaqSection, {
    target: document.body,
    props: {
      config: props.config ?? FLAT,
      context: context(),
      variant: props.variant,
      design: props.design ?? CANDLELIT,
      editable: props.editable,
      onEdit: props.onEdit,
    },
  });
  flushSync();
  return document.body;
}

const root = () => document.body.querySelector('.faq');
const questions = () =>
  [...document.body.querySelectorAll('.faq__q-text')].map((e) =>
    e.textContent?.trim()
  );
const answers = () =>
  [...document.body.querySelectorAll('.faq__a')].map((e) =>
    e.textContent?.trim()
  );
const details = () => [...document.body.querySelectorAll('details.faq__item')];

function reset() {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
}

afterEach(reset);

describe('FaqSection — compositions', () => {
  for (const id of ['accordion', 'open', 'boxed', 'paired', 'grouped']) {
    it(`renders the ${id} composition`, () => {
      render({ variant: id });
      expect(root()?.getAttribute('data-faq')).toBe(id);
      expect(questions()).toHaveLength(3);
    });
  }

  it('falls back to accordion for an unknown variant', () => {
    render({ variant: 'no-such-composition' });
    expect(root()?.getAttribute('data-faq')).toBe('accordion');
  });

  it('falls back to accordion when no variant is passed', () => {
    render({});
    expect(root()?.getAttribute('data-faq')).toBe('accordion');
  });

  it('self-hides when there are no entries', () => {
    render({ config: { heading: 'Questions' } });
    expect(root()).toBeNull();
  });

  it('skips a numbered slot missing either half of the pair', () => {
    render({ config: { q1: 'Has both?', a1: 'Yes.', q2: 'Question only?' } });
    expect(questions()).toEqual(['Has both?']);
  });
});

describe('FaqSection — collapsible versus static', () => {
  for (const id of ['accordion', 'boxed', 'grouped']) {
    it(`${id} is collapsible and uses native <details>`, () => {
      render({ variant: id });
      expect(details(), id).toHaveLength(3);
      expect(document.body.querySelectorAll('summary.faq__q')).toHaveLength(3);
    });
  }

  for (const id of ['open', 'paired']) {
    it(`${id} is static and renders no <details> at all`, () => {
      render({ variant: id });
      expect(details(), id).toHaveLength(0);
      expect(document.body.querySelectorAll('summary')).toHaveLength(0);
      // Every answer is present and unconditionally visible.
      expect(answers()).toHaveLength(3);
    });
  }

  it('gives the static compositions a real heading level, not a summary', () => {
    render({ variant: 'open' });
    expect([...document.body.querySelectorAll('h3.faq__q-text')].length).toBe(
      3
    );
  });
});

describe('FaqSection — the collapse check (contract A9 stage 2)', () => {
  it('accordion still serves every row CLOSED', () => {
    // This is what the published page has always rendered: the public renderer
    // never honoured `variant`, so `accordion` meant "all closed, click to
    // expand". The canvas twin opens the first row; the published page is the
    // one a visitor sees, so it is the one preserved.
    render({ variant: 'accordion' });
    expect(details()).toHaveLength(3);
    for (const d of details())
      expect((d as HTMLDetailsElement).open).toBe(false);
  });

  it('boxed and grouped also start closed', () => {
    for (const id of ['boxed', 'grouped']) {
      render({ variant: id });
      for (const d of details())
        expect((d as HTMLDetailsElement).open, id).toBe(false);
      reset();
    }
  });
});

describe('FaqSection — the g1-g3 group read (OWED_READS.faq, contract A28)', () => {
  const GROUPED: SectionProps = {
    q1: 'Money one?',
    a1: 'A.',
    g1: 'Money',
    q2: 'Time one?',
    a2: 'B.',
    g2: 'Time',
    q3: 'Money two?',
    a3: 'C.',
    g3: 'Money',
  };

  it('clusters entries that share a group label, in first-appearance order', () => {
    render({ variant: 'grouped', config: GROUPED });
    const labels = [...document.body.querySelectorAll('.faq__group-label')].map(
      (e) => e.textContent?.trim()
    );
    expect(labels).toEqual(['Money', 'Time']);
  });

  it('puts both Money entries in the first cluster', () => {
    render({ variant: 'grouped', config: GROUPED });
    const clusters = [...document.body.querySelectorAll('.faq__cluster')];
    expect(clusters).toHaveLength(2);
    expect(
      [...clusters[0].querySelectorAll('.faq__q-text')].map((e) =>
        e.textContent?.trim()
      )
    ).toEqual(['Money one?', 'Money two?']);
    expect(
      [...clusters[1].querySelectorAll('.faq__q-text')].map((e) =>
        e.textContent?.trim()
      )
    ).toEqual(['Time one?']);
  });

  it('degrades to ONE unlabelled cluster when no groups are authored', () => {
    // Every page today: the catalogue's `defaultProps` does not seed g1-g3, so
    // `grouped` has to render as a plain list rather than as nothing.
    render({ variant: 'grouped', config: FLAT });
    expect(document.body.querySelectorAll('.faq__cluster')).toHaveLength(1);
    expect(document.body.querySelector('.faq__group-label')).toBeNull();
    expect(questions()).toHaveLength(3);
  });

  it('keeps a partially-grouped set whole', () => {
    render({
      variant: 'grouped',
      config: { q1: 'A?', a1: 'a', q2: 'B?', a2: 'b', g2: 'Named' },
    });
    const clusters = [...document.body.querySelectorAll('.faq__cluster')];
    expect(clusters).toHaveLength(2);
    // The ungrouped entry leads, unlabelled; the named one follows.
    expect(clusters[0].querySelector('.faq__group-label')).toBeNull();
    expect(
      clusters[1].querySelector('.faq__group-label')?.textContent?.trim()
    ).toBe('Named');
    expect(questions()).toEqual(['A?', 'B?']);
  });

  it('ignores groups in every composition except grouped', () => {
    render({ variant: 'accordion', config: GROUPED });
    expect(document.body.querySelectorAll('.faq__cluster')).toHaveLength(1);
    expect(document.body.querySelector('.faq__group-label')).toBeNull();
  });

  it('keeps the stagger continuous across clusters', () => {
    render({ variant: 'grouped', config: GROUPED });
    expect(
      [...document.body.querySelectorAll('.faq__item')].map((e) =>
        e.getAttribute('data-jp-step')
      )
    ).toEqual(['1', '3', '2']);
  });
});

describe('FaqSection — the read boundary', () => {
  it('prefers an authored items[] array over the numbered flats', () => {
    render({
      config: {
        ...FLAT,
        items: [{ question: 'Array Q?', answer: 'Array A.', group: 'G' }],
      },
    });
    expect(questions()).toEqual(['Array Q?']);
  });

  it('reads a group off an items[] entry too', () => {
    render({
      variant: 'grouped',
      config: {
        items: [{ question: 'Array Q?', answer: 'Array A.', group: 'Arrays' }],
      },
    });
    expect(
      document.body.querySelector('.faq__group-label')?.textContent?.trim()
    ).toBe('Arrays');
  });

  it('drops an items[] entry missing either half', () => {
    render({
      config: { items: [{ question: 'Only a question?' }], q1: 'x', a1: 'y' },
    });
    // The malformed array yields nothing, so the numbered fallback is used.
    expect(questions()).toEqual(['x']);
  });

  it('reads more than the three slots the builder currently offers', () => {
    // `asNumberedGroups` scans to 12 while `section-fields.ts` shows 3, so the
    // data model already supports a longer FAQ than the UI can author.
    const many: SectionProps = {};
    for (let i = 1; i <= 7; i += 1) {
      many[`q${i}`] = `Q${i}?`;
      many[`a${i}`] = `A${i}.`;
    }
    render({ config: many });
    expect(questions()).toHaveLength(7);
  });
});

describe('FaqSection — the hardcoded voice is gone (Codex-i9pzs)', () => {
  it('renders NO heading element when the creator set none', () => {
    render({ config: { q1: 'Q?', a1: 'A.' } });
    expect(document.body.querySelector('.faq__heading')).toBeNull();
    expect(document.body.querySelector('h2')).toBeNull();
  });

  it('never emits the retired editorial fallback', () => {
    render({ config: { q1: 'Q?', a1: 'A.' } });
    expect(document.body.textContent).not.toContain('honest answers');
  });
});

describe('FaqSection — the edit seam', () => {
  it('emits NO edit attributes on the public render', () => {
    render({ config: FLAT });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    expect(document.body.querySelector('[data-field]')).toBeNull();
  });

  it('serves REAL TEXT CHILDREN even when editable', () => {
    render({ config: FLAT, editable: true });
    const h2 = document.body.querySelector('h2');
    expect(h2?.getAttribute('contenteditable')).toBe('true');
    expect(h2?.textContent?.trim()).toBe('The honest answers');
    expect(questions()).toEqual([
      'First question?',
      'Second question?',
      'Third question?',
    ]);
  });

  it('opens every row in the canvas, because a closed panel cannot be edited', () => {
    render({ config: FLAT, editable: true });
    for (const d of details())
      expect((d as HTMLDetailsElement).open).toBe(true);
  });

  it('reports an edit against the stored numbered key', () => {
    const onEdit = vi.fn<(key: string, value: string) => void>();
    render({ config: FLAT, editable: true, onEdit });
    const answer = document.body.querySelectorAll('.faq__a')[2] as HTMLElement;
    expect(answer.getAttribute('data-field')).toBe('a3');
    answer.textContent = 'Edited answer';
    answer.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith('a3', 'Edited answer');
  });

  it('leaves items[]-authored rows read-only, because they have no numbered key', () => {
    render({
      config: { heading: 'H', items: [{ question: 'Q?', answer: 'A.' }] },
      editable: true,
    });
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
    expect(
      document.body
        .querySelector('.faq__q-text')
        ?.getAttribute('contenteditable')
    ).toBeNull();
  });
});
