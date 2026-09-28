import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBodyFonts, getHeadingFonts } from '$lib/brand-editor/font-catalog';
import { STYLES, sampleContext } from '$lib/page-builder/kit';
import {
  PAGE_STYLE_IDS,
  type PageStyleId,
  SECTION_TYPE_IDS,
} from '$lib/page-builder/kit/model/ids';
import { upgradePage } from '$lib/page-builder/kit/model/upgrade';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SectionGallery from './SectionGallery.svelte';
import StylePanel from './StylePanel.svelte';

const PAGE_ID = '00000000-0000-4000-8000-0000000000b8';
const HERO: PageSection = {
  id: 'h',
  type: 'hero',
  enabled: true,
  props: { heading: 'Quiet hours, every morning' },
};

let app: ReturnType<typeof mount> | null = null;

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

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OnScreen);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '';
});

function open(
  brandOverrides: PageBuilderState['brandOverrides'] = null,
  style: PageStyleId = 'bold',
  pageId = PAGE_ID
): void {
  pageBuilder.open(pageId, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides,
    design: { style },
    sections: [HERO],
  } as PageBuilderState);
}

function renderStyle(): void {
  app = mount(StylePanel, {
    target: document.body,
    props: {
      get page() {
        const pending = pageBuilder.pending;
        return upgradePage({
          design: pending?.design,
          sections: pending?.sections,
        });
      },
      get brandOverrides() {
        return pageBuilder.pending?.brandOverrides ?? null;
      },
      context: sampleContext(),
    },
  });
  flushSync();
}

// `HTMLElement | Document`, not `ParentNode`: this project's ambient Workers
// types declare their own `ParentNode` (HTMLRewriter's), which a DOM node is not.
function el<T extends Element = HTMLElement>(
  selector: string,
  root: HTMLElement | Document = document
): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

describe('StylePanel', () => {
  it('shows each Style as this page’s own hero and writes the one chosen', () => {
    open();
    renderStyle();
    const cards = [
      ...document.querySelectorAll<HTMLButtonElement>('.style-card'),
    ];
    expect(cards.map((c) => c.dataset.style)).toEqual([...PAGE_STYLE_IDS]);
    const soft = el('.style-card[data-style="soft"]');
    expect(el('.lp', soft).dataset.lpStyle).toBe('soft');
    expect(soft.textContent).toContain('Quiet hours, every morning');
    expect(
      el('.style-card[data-style="bold"]').getAttribute('aria-pressed')
    ).toBe('true');

    soft.click();
    flushSync();
    expect(pageBuilder.pending?.design?.style).toBe('soft');
    expect(
      el('.style-card[data-style="soft"]').getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('sets a page colour through the brand picker and clears it back to the organisation', () => {
    open();
    renderStyle();
    const [primary] = document.querySelectorAll<HTMLElement>('.brand-colour');
    expect(primary.textContent).toContain('From your organisation’s brand');

    el<HTMLButtonElement>('.brand-colour__button', primary).click();
    flushSync();
    const hex = el<HTMLInputElement>(
      '.brand-colour__picker input.color-input__field',
      primary
    );
    hex.value = '#123456';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    hex.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toEqual({
      primaryColor: '#123456',
    });
    expect(primary.textContent).toContain('This page only');

    el<HTMLButtonElement>('.brand-colour__reset', primary).click();
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
  });

  it('shows a font set for this page and clears it', () => {
    open({ fontHeading: 'Fraunces' });
    renderStyle();
    const [heading] = document.querySelectorAll<HTMLElement>('.brand-font');
    expect(heading.textContent).toContain('This page only');
    expect(heading.textContent).toContain('Fraunces');
    el<HTMLButtonElement>('.brand-font__reset', heading).click();
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
  });
});

describe('StylePanel — the fonts a Style suggests', () => {
  // Whichever Styles suggest a pair today: the Style WPs choose them.
  const suggesting = PAGE_STYLE_IDS.find((id) => STYLES[id].fonts);
  const plain = PAGE_STYLE_IDS.find((id) => !STYLES[id].fonts);
  if (!suggesting || !plain) throw new Error('needs one Style of each kind');
  const pair = STYLES[suggesting].fonts as { heading: string; body: string };

  const row = () => document.querySelector<HTMLElement>('.style-fonts__row');

  it('appears only on choosing a Style that suggests fonts, and changes no font by itself', () => {
    open(null, plain);
    renderStyle();
    expect(row()).toBeNull();

    el<HTMLButtonElement>(`.style-card[data-style="${suggesting}"]`).click();
    flushSync();
    expect(pageBuilder.pending?.design?.style).toBe(suggesting);
    expect(row()?.textContent).toContain(
      `This Style suggests ${pair.heading} and ${pair.body}.`
    );
    // The sample sets the page's own headline in the suggested face.
    const sample = el('.style-fonts__heading');
    expect(sample.textContent?.trim()).toBe('Quiet hours, every morning');
    expect(sample.style.fontFamily).toContain(pair.heading);
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
  });

  it('writes both fonts as ONE undoable step, which the font fields can undo', () => {
    open(null, suggesting);
    renderStyle();
    el<HTMLButtonElement>('.style-fonts__use').click();
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toEqual({
      fontHeading: pair.heading,
      fontBody: pair.body,
    });
    expect(row()).toBeNull();
    const [heading, body] =
      document.querySelectorAll<HTMLElement>('.brand-font');
    expect(heading.textContent).toContain('This page only');
    expect(body.textContent).toContain('This page only');

    pageBuilder.undo();
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toBeNull();
    expect(row()).not.toBeNull();

    pageBuilder.redo();
    flushSync();
    el<HTMLButtonElement>('.brand-font__reset', heading).click();
    flushSync();
    expect(pageBuilder.pending?.brandOverrides).toEqual({
      fontBody: pair.body,
    });
    expect(row()).not.toBeNull();
  });

  it('stays away while the page already renders the pair, as its own or the organisation’s', () => {
    open({ fontHeading: pair.heading, fontBody: pair.body }, suggesting);
    renderStyle();
    expect(row()).toBeNull();
    if (app) unmount(app);
    app = null;
    pageBuilder.close();

    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.style.setProperty('--brand-font-heading', `'${pair.heading}'`);
    layout.style.setProperty('--brand-font-body', `'${pair.body}'`);
    // `appendChild`: the ambient Workers types retype `append` (see `el`).
    document.body.appendChild(layout);
    open(null, suggesting);
    renderStyle();
    expect(row()).toBeNull();
  });

  describe('“Keep my fonts”', () => {
    const other = PAGE_STYLE_IDS.find(
      (id) => id !== suggesting && STYLES[id].fonts
    );
    if (!other) throw new Error('needs two Styles that suggest fonts');
    const keep = () => el<HTMLButtonElement>('.style-fonts__keep');
    const reopen = (style: PageStyleId, pageId = PAGE_ID) => {
      if (app) unmount(app);
      app = null;
      pageBuilder.close();
      open(null, style, pageId);
      renderStyle();
    };

    it('declines the pair for this page and Style, changes no font, and is remembered', () => {
      open(null, suggesting);
      renderStyle();
      expect(keep().textContent?.trim()).toBe('Keep my fonts');
      keep().click();
      flushSync();
      expect(row()).toBeNull();
      expect(pageBuilder.pending?.brandOverrides).toBeNull();
      // Back to the page later: still declined.
      reopen(suggesting);
      expect(row()).toBeNull();
      // Another Style's pair is still offered, on this page…
      el<HTMLButtonElement>(`.style-card[data-style="${other}"]`).click();
      flushSync();
      expect(row()?.textContent).toContain(
        `This Style suggests ${STYLES[other].fonts?.heading}`
      );
      // …and this Style's on another page.
      reopen(suggesting, '00000000-0000-4000-8000-0000000000b9');
      expect(row()).not.toBeNull();
    });

    it('hands focus back to the Style it was about, whichever answer is given', async () => {
      open(null, suggesting);
      renderStyle();
      const card = el(`.style-card[data-style="${suggesting}"]`);
      keep().focus();
      keep().click();
      await tick();
      await Promise.resolve();
      expect(document.activeElement).toBe(card);

      reopen(other);
      el<HTMLButtonElement>('.style-fonts__use').click();
      await tick();
      await Promise.resolve();
      expect(document.activeElement).toBe(
        el(`.style-card[data-style="${other}"]`)
      );
    });

    it('without storage, offers the pair as before and still declines it for this visit', () => {
      const refuse = () => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      };
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
      open(null, suggesting);
      renderStyle();
      // A store that cannot be read hides nothing…
      expect(row()).not.toBeNull();
      // …and a refused write still takes the row away, without an error.
      keep().click();
      flushSync();
      expect(row()).toBeNull();
    });
  });

  it('suggests only fonts the page’s font fields offer', () => {
    const headings = new Set(getHeadingFonts().map((font) => font.family));
    const bodies = new Set(getBodyFonts().map((font) => font.family));
    for (const id of PAGE_STYLE_IDS) {
      const fonts = STYLES[id].fonts;
      if (!fonts) continue;
      expect(headings.has(fonts.heading), `${id} heading`).toBe(true);
      expect(bodies.has(fonts.body), `${id} body`).toBe(true);
    }
  });
});

describe('SectionGallery', () => {
  function renderGallery(counts: Record<string, number>) {
    const onChoose = vi.fn();
    app = mount(SectionGallery, {
      target: document.body,
      props: {
        open: true,
        style: 'clean',
        afterLabel: 'Hero',
        counts,
        onChoose,
      },
    });
    flushSync();
    return onChoose;
  }

  it('groups every type, each a real render of its sample in the page’s Style', () => {
    renderGallery({});
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>('.gallery__item'),
    ];
    expect(items).toHaveLength(SECTION_TYPE_IDS.length);
    const faq = el('.gallery__item[data-type="faq"]');
    expect(el('.lp', faq).dataset.lpStyle).toBe('clean');
    expect(el('[data-lp-type="faq"]', faq)).toBeTruthy();
    expect(document.querySelectorAll('.gallery__group-title').length).toBe(5);
  });

  it('shows Story and Gallery in their groups, the gallery drawing its plates before any picture exists', () => {
    renderGallery({});
    const groupOf = (type: string) =>
      el(`.gallery__item[data-type="${type}"]`)
        .closest('.gallery__group')
        ?.querySelector('.gallery__group-title')?.textContent;
    expect(groupOf('story')).toBe('Your story');
    expect(groupOf('gallery')).toBe('Proof');

    const story = el('.gallery__item[data-type="story"]');
    expect(el('[data-lp-type="story"]', story).textContent).toContain(
      'How the six weeks unfold'
    );
    // A still render — every thumbnail is — draws the layout's plates.
    const gallery = el('.gallery__item[data-type="gallery"]');
    expect(el('.lp', gallery).hasAttribute('data-lp-still')).toBe(true);
    expect(el('.gallery__plates', gallery).childElementCount).toBeGreaterThan(
      0
    );
  });

  it('disables a type at its maximum, saying why, and inserts the one chosen', () => {
    const onChoose = renderGallery({ hero: 1 });
    const hero = el<HTMLButtonElement>('.gallery__item[data-type="hero"]');
    expect(hero.disabled).toBe(true);
    expect(hero.textContent).toContain('Already on this page');

    el<HTMLButtonElement>('.gallery__item[data-type="faq"]').click();
    flushSync();
    expect(onChoose).toHaveBeenCalledWith('faq');
  });
});
