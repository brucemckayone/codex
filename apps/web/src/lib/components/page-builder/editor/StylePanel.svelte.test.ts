import type { PageBuilderState, PageSection } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleContext } from '$lib/page-builder/kit';
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
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

function open(brandOverrides: PageBuilderState['brandOverrides'] = null): void {
  pageBuilder.open(PAGE_ID, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides,
    design: { style: 'bold' },
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
    expect(cards.map((c) => c.dataset.style)).toEqual([
      'bold',
      'clean',
      'soft',
      'cinematic',
    ]);
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
    expect(items).toHaveLength(14);
    const faq = el('.gallery__item[data-type="faq"]');
    expect(el('.lp', faq).dataset.lpStyle).toBe('clean');
    expect(el('[data-lp-type="faq"]', faq)).toBeTruthy();
    expect(document.querySelectorAll('.gallery__group-title').length).toBe(5);
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
