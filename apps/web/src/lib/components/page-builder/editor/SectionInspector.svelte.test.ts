/**
 * A write that arrives after the creator has moved on (Codex-61zsk review).
 *
 * An image upload takes seconds, and the creator is free to select another
 * section meanwhile. The inspector that started it is gone by then, and its
 * props used to follow the PARENT: the finished upload was written to
 * whichever section was selected when it landed, replacing that section's own
 * image. It must land on the section it was started for.
 */
import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFINITIONS,
  PageRenderer,
  SECTION_TYPE_IDS,
  sampleContext,
} from '$lib/page-builder/kit';
import { STYLES } from '$lib/page-builder/kit/model/styles';
import { upgradePage } from '$lib/page-builder/kit/model/upgrade';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Inspector from './Inspector.svelte';

const PAGE_ID = '00000000-0000-4000-8000-0000000000c3';
const KEY = `landing-pages/${PAGE_ID}/images/00000000-0000-4000-8000-0000000000c4`;

/** An upload the test finishes by hand, after moving the selection. */
const remote = vi.hoisted(() => ({
  result: undefined as unknown,
  finish: null as null | (() => void),
}));

vi.mock('$lib/remote/page-images.remote', () => {
  const instance = {
    get result() {
      return remote.result;
    },
    pending: 0,
    fields: {
      pageId: {
        as: (type: string, value: string) => ({ type, name: 'pageId', value }),
      },
      image: {
        as: (type: string) => ({ type, name: 'image' }),
        issues: () => undefined,
      },
    },
    enhance: (
      callback: (opts: {
        form: HTMLFormElement;
        submit: () => Promise<void>;
      }) => Promise<void>
    ) => ({
      method: 'POST',
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void callback({
          form: event.currentTarget as HTMLFormElement,
          submit: () =>
            new Promise<void>((resolve) => {
              remote.finish = () => {
                remote.result = {
                  outcome: 'uploaded',
                  key: KEY,
                  url: `https://cdn.test/${KEY}/md.webp`,
                };
                resolve();
              };
            }),
        });
      },
    }),
  };
  return { uploadPageImageForm: { for: () => instance } };
});

/** The org the layout loaded: its shader preset and its backgrounds. */
const layout = vi.hoisted(() => ({ org: null as unknown }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return { org: layout.org };
    },
  },
}));

class OnScreen {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OnScreen);
  remote.result = undefined;
  remote.finish = null;
  layout.org = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

function hero(id: string): PageSection {
  return { id, type: 'hero', enabled: true, props: { heading: id } };
}

function render(
  sections: PageSection[],
  selectedId: string,
  style: string = 'bold',
  mediaBaseUrl: string | null = null
) {
  pageBuilder.open(PAGE_ID, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    design: { style },
    sections,
  } as PageBuilderState);
  pageBuilder.selectSection(selectedId);
  app = mount(Inspector, {
    target: document.body,
    props: {
      get page() {
        const pending = pageBuilder.pending;
        return upgradePage({
          design: pending?.design,
          sections: pending?.sections,
        });
      },
      get selectedId() {
        return pageBuilder.selectedSectionId;
      },
      context: sampleContext({ mediaBaseUrl }),
      onDuplicate: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
      onChangeStyle: vi.fn(),
    },
  });
  flushSync();
}

function stored(id: string): PageSection | undefined {
  return pageBuilder.pending?.sections.find((s) => s.id === id);
}

function startUpload(): void {
  const form = document.body.querySelector('form.image__actions');
  if (!form) throw new Error('no image field on screen');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  flushSync();
}

async function finishUpload(): Promise<void> {
  if (!remote.finish) throw new Error('no upload in flight');
  remote.finish();
  await tick();
  await Promise.resolve();
  await tick();
  flushSync();
}

describe('a write that arrives after the creator has moved on', () => {
  it('lands the upload on the section it was started for', async () => {
    render([hero('hero-a'), hero('hero-b')], 'hero-a');
    startUpload();

    pageBuilder.selectSection('hero-b');
    flushSync();
    await finishUpload();

    expect(stored('hero-a')?.props.image).toEqual({ key: KEY });
    expect(stored('hero-b')?.props.image).toBeUndefined();
  });

  it('writes nothing when that section was deleted meanwhile', async () => {
    render([hero('hero-a'), hero('hero-b')], 'hero-a');
    startUpload();

    pageBuilder.removeSection('hero-a');
    flushSync();
    await finishUpload();

    expect(stored('hero-a')).toBeUndefined();
    expect(stored('hero-b')?.props.image).toBeUndefined();
  });
});

describe('the background image, a control every section shares', () => {
  const backgroundControl = () =>
    document.body.querySelector<HTMLElement>('[data-control="background"]');

  it('is offered exactly where the page draws one: every type but the hero, the call to action and the four simple sections', () => {
    // Nothing here needs the layout thumbnails, so they never come on screen.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    const offered: string[] = [];
    const drawn: string[] = [];
    for (const type of SECTION_TYPE_IDS) {
      const section = {
        id: `s-${type}`,
        type,
        enabled: true,
        props: { ...DEFINITIONS[type].sample, background: { key: KEY } },
      };
      render([section], section.id);
      if (backgroundControl()) offered.push(type);
      if (app) unmount(app);
      pageBuilder.close();

      app = mount(PageRenderer, {
        target: document.body,
        props: {
          page: { design: { style: 'bold' }, sections: [section] },
          context: sampleContext({ mediaBaseUrl: 'https://cdn.test' }),
          still: true,
        },
      });
      flushSync();
      if (document.body.querySelector('.lp-section[data-lp-on-media]'))
        drawn.push(type);
      unmount(app);
      app = null;
      document.body.innerHTML = '';
    }
    // A simple section takes its neighbour's ground (03 X64): no picture of its own.
    const simple = ['picture', 'heading', 'break', 'button'];
    expect(offered).toEqual(
      SECTION_TYPE_IDS.filter(
        (t) => t !== 'hero' && t !== 'cta' && !simple.includes(t)
      )
    );
    expect(offered).toEqual(drawn);
  });

  it('uploads a decorative background under one label, and removes it', async () => {
    render([{ id: 'f', type: 'faq', enabled: true, props: {} }], 'f');
    const control = backgroundControl();
    const group = control?.querySelector<HTMLElement>('.image[role="group"]');
    const heading = document.getElementById(
      group?.getAttribute('aria-labelledby') ?? ''
    );
    expect(heading?.textContent?.trim()).toBe('Background image');
    // The heading names the field; the field draws no second label.
    expect(control?.querySelector('.image__label')).toBeNull();

    startUpload();
    await finishUpload();
    expect(stored('f')?.props.background).toEqual({ key: KEY });

    control?.querySelector<HTMLButtonElement>('.image__btn--quiet')?.click();
    flushSync();
    expect(stored('f')?.props).not.toHaveProperty('background');
  });
});

// B2 (03 X50, X51): the canvas draws an org's hero on its moving background
// when the org has a shader, and as base on a band a moving background is
// not proven on. The colour swatches show what the canvas draws: the
// section's colour, and which one is its default.
describe('the colour the canvas draws for the hero', () => {
  const org = (tokenOverrides: object, background?: string) => ({
    brandColors: { background },
    brandFineTune: { tokenOverrides: JSON.stringify(tokenOverrides) },
  });
  const swatches = () => {
    const pressed = document.body.querySelectorAll<HTMLElement>(
      ".swatch[aria-pressed='true']"
    );
    const defaults = [
      ...document.body.querySelectorAll<HTMLElement>('.swatch'),
    ].filter((b) => b.querySelector('.swatch__default')?.textContent?.trim());
    return {
      value: [...pressed].map((b) => b.dataset.scheme),
      default: defaults.map((b) => b.dataset.scheme),
    };
  };

  it('is the moving background, by default, in an org with a shader', () => {
    layout.org = org({ 'shader-preset': 'glow' });
    render([hero('h')], 'h');
    expect(swatches()).toEqual({
      value: ['atmosphere'],
      default: ['atmosphere'],
    });
  });

  it('is the Style’s own without one', () => {
    layout.org = org({ 'shader-preset': 'none' });
    render([hero('h')], 'h');
    const own = STYLES.bold.schemes.hero ?? 'base';
    expect(own).not.toBe('atmosphere');
    expect(swatches()).toEqual({ value: [own], default: [own] });
  });

  it('is base where the org’s ground is on a band a moving background is not drawn on', () => {
    // #D2C3A8 is L 0.82: band l80, where PageRenderer draws base.
    layout.org = org({ 'shader-preset': 'glow' }, '#D2C3A8');
    render([hero('h')], 'h');
    expect(swatches()).toEqual({ value: ['base'], default: ['base'] });
  });
});

// ── The simple sections (03 X64, Codex-61zsk.53) ───────────────────────────

describe('the inspector for a simple section', () => {
  const section = (
    id: string,
    type: PageSection['type'],
    props: Record<string, unknown> = {},
    extra: Partial<PageSection> = {}
  ): PageSection => ({ id, type, enabled: true, props, ...extra });
  const problem = section('a', 'problem', { heading: 'Stuck?' });
  const curriculum = section('b', 'curriculum', { heading: 'Six weeks' });
  const note = (kind: string) =>
    document.body
      .querySelector<HTMLElement>(`[data-note="${kind}"]`)
      ?.textContent?.trim();
  const swatches = () => document.body.querySelectorAll('[data-scheme]').length;

  it('says a Picture matches the section above, and offers it no background picture', () => {
    render([problem, section('p', 'picture'), curriculum], 'p');
    expect(note('join')).toBe('Matches the section above');
    expect(swatches()).toBeGreaterThan(0);
    expect(
      document.body.querySelector('[data-control="background"]')
    ).toBeNull();
  });

  it('says a Heading matches the section below, and with nothing below, why it joins the one above', () => {
    render(
      [problem, section('h', 'heading', { heading: 'Part two' }), curriculum],
      'h'
    );
    expect(note('join')).toBe('Matches the section below');
    expect(note('heading')).toBeUndefined();
    unmount(app);
    app = null;
    pageBuilder.close();
    render([problem, section('h', 'heading', { heading: 'Part two' })], 'h');
    expect(note('join')).toBe('Matches the section above');
    expect(note('heading')).toContain(
      'reads best right above the section it introduces'
    );
  });

  it('a colour the creator picked is the section’s own', () => {
    render(
      [
        problem,
        section('p', 'picture', {}, { design: { scheme: 'accent' } }),
        curriculum,
      ],
      'p'
    );
    expect(note('join')).toBeUndefined();
    expect(note('own')).toContain('own colour');
  });

  it('a Break has no colour to pick, and says when the colour already changes or two pauses add up', () => {
    render([problem, section('k', 'break'), curriculum], 'k');
    expect(swatches()).toBe(0);
    expect(document.body.textContent).toContain(
      'A pause has no colour of its own'
    );
    // Bold: the problem is a contrast band, the curriculum the page.
    const breakNotes = () =>
      [...document.body.querySelectorAll('[data-note="break"]')].map(
        (n) => n.textContent
      );
    expect(
      breakNotes().some((t) =>
        t?.includes('colour change already makes a pause')
      )
    ).toBe(true);
    unmount(app);
    app = null;
    pageBuilder.close();
    render(
      [problem, section('k', 'break'), section('k2', 'break'), curriculum],
      'k'
    );
    expect(breakNotes().some((t) => t?.includes('Two pauses in a row'))).toBe(
      true
    );
  });

  it('offers a Break’s mark only in a Style that draws one', () => {
    const markSwitch = () =>
      [...document.body.querySelectorAll('.field__label')].some(
        (label) => label.textContent === 'Show a small mark in the middle'
      );
    render([problem, section('k', 'break'), curriculum], 'k', 'bold');
    expect(markSwitch()).toBe(true);
    for (const style of ['clean', 'path']) {
      unmount(app);
      app = null;
      pageBuilder.close();
      render([problem, section('k', 'break'), curriculum], 'k', style);
      expect(markSwitch(), style).toBe(false);
    }
  });

  it('offers a picture’s focal point at full width, and explains it elsewhere', () => {
    const image = { key: KEY, w: 1600, h: 1067 };
    render(
      [
        problem,
        section('p', 'picture', { image }, { variant: 'full' }),
        curriculum,
      ],
      'p',
      'bold',
      'https://cdn.test'
    );
    const pad = document.body.querySelector<HTMLButtonElement>('.focus__pad');
    expect(pad).not.toBeNull();
    expect(
      document.body.querySelector('.focus__readout')?.textContent
    ).toContain('Point at 50% across, 50% down');
    pad?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    flushSync();
    expect(stored('p')?.props.image).toEqual({
      ...image,
      focus: { x: 52, y: 50 },
    });
    pad?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
      })
    );
    flushSync();
    expect(stored('p')?.props.image).toEqual({
      ...image,
      focus: { x: 52, y: 60 },
    });
    document.body.querySelector<HTMLButtonElement>('.focus__centre')?.click();
    flushSync();
    // The centre is the default: never stored, and the rest of the reference kept.
    expect(stored('p')?.props.image).toEqual(image);

    unmount(app);
    app = null;
    pageBuilder.close();
    render(
      [
        problem,
        section('p', 'picture', { image }, { variant: 'contained' }),
        curriculum,
      ],
      'p',
      'bold',
      'https://cdn.test'
    );
    expect(document.body.querySelector('.focus__pad')).toBeNull();
    expect(document.body.textContent).toContain('only matters at full width');
  });

  it('keeps a half-typed link out of the page, and writes it once it is a full https address', () => {
    const link = { kind: 'link', href: 'https://example.com/a' };
    render(
      [problem, section('u', 'button', { action: link }), curriculum],
      'u'
    );
    const input =
      document.body.querySelector<HTMLInputElement>('input[type="url"]');
    expect(input?.value).toBe(link.href);
    const type = (value: string) => {
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    };
    type('http://example.com');
    expect(stored('u')?.props.action).toEqual(link);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain('starts with https://');
    type('https://example.com/b');
    expect(stored('u')?.props.action).toEqual({
      kind: 'link',
      href: 'https://example.com/b',
    });
    expect(input?.hasAttribute('aria-invalid')).toBe(false);
  });
});
