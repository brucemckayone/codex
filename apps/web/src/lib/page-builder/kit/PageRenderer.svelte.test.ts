import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { PAGE_STYLE_IDS } from './model/ids';
import { sampleContext, samplePage } from './model/sample';
import { STYLES } from './model/styles';
import PageRenderer from './PageRenderer.svelte';
import type { PageEdit } from './page-context';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(props: Record<string, unknown> = {}) {
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page: samplePage('bold'),
      context: sampleContext({
        offer: 'tiers',
        media: { heroImageUrl: '/hero.jpg' },
      }),
      ...props,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
  return document.body.querySelector('.lp') as HTMLElement;
}

/** Remove exactly what editing adds, so the rest can be compared. */
function publicMarkup(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll('[contenteditable]')) {
    for (const attr of [
      'contenteditable',
      'spellcheck',
      'role',
      'aria-label',
      'data-field',
    ]) {
      el.removeAttribute(attr);
    }
  }
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of [
      'data-lp-section',
      'data-lp-selected',
      'data-lp-editing',
      'data-lp-still',
    ]) {
      el.removeAttribute(attr);
    }
  }
  copy.querySelector('.lp-sticky')?.remove();
  return copy.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
}

describe('PageRenderer', () => {
  it.each(
    PAGE_STYLE_IDS
  )('renders every section of the %s page, in order, under one h1', async (style) => {
    const root = await render({ page: samplePage(style) });
    expect(root.dataset.lpStyle).toBe(style);
    const sections = [...root.querySelectorAll('.lp-section')];
    expect(sections.map((s) => s.getAttribute('data-lp-type'))).toEqual([
      ...STYLES[style].order,
    ]);
    expect(sections.map((s) => s.id)).toEqual([...STYLES[style].order]);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    for (const s of sections) {
      expect(s.getAttribute('data-lp-scheme')).toBe(
        STYLES[style].schemes[
          s.getAttribute(
            'data-lp-type'
          ) as keyof (typeof STYLES)['bold']['schemes']
        ]
      );
    }
  });

  it('draws public markup identical with and without the editor, apart from editing attributes', async () => {
    const publicHtml = publicMarkup(await render());
    unmount(app);
    const edit: PageEdit = { commit: () => {} };
    const editingRoot = await render({ edit, selectedId: 'sample-pricing' });
    expect(
      editingRoot.querySelectorAll('[contenteditable]').length
    ).toBeGreaterThan(10);
    expect(
      editingRoot
        .querySelector('[data-lp-selected]')
        ?.getAttribute('data-lp-type')
    ).toBe('pricing');
    expect(publicMarkup(editingRoot)).toBe(publicHtml);
  });

  it('routes an inline edit to its section and key', async () => {
    const commits: string[] = [];
    const root = await render({
      edit: {
        commit: (id: string, key: string, value: string) =>
          commits.push(`${id}.${key}=${value}`),
      },
    });
    const heading = root.querySelector('#pricing h2') as HTMLElement;
    heading.textContent = 'Pick a plan';
    heading.dispatchEvent(new Event('input', { bubbles: true }));
    expect(commits).toEqual(['sample-pricing.heading=Pick a plan']);
  });

  it('carries page brand overrides on a nested brand scope, and nothing when there are none', async () => {
    let root = await render();
    expect(root.hasAttribute('data-org-brand')).toBe(false);
    expect(root.getAttribute('style')).toBeNull();
    unmount(app);
    root = await render({
      brandOverrides: { primaryColor: '#0D9488', fontHeading: 'Syne' },
    });
    expect(root.hasAttribute('data-org-brand')).toBe(true);
    expect(root.getAttribute('style')).toContain('--brand-color: #0D9488');
    expect(
      document.head.querySelector(
        'link[href*="fonts.googleapis.com"][href*="Syne"]'
      )
    ).not.toBeNull();
  });

  it('previews a theme on its own root, never on <html>', async () => {
    const root = await render({ theme: 'dark' });
    expect(root.dataset.lpTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(
      'dark'
    );
  });

  it('keeps the floating call to action outside every query container', async () => {
    const root = await render();
    const bar = root.querySelector<HTMLElement>('.lp-sticky');
    expect(bar?.parentElement).toBe(root);
    expect(bar?.closest('.lp-page')).toBeNull();
    // Hidden until it has observed the page (jsdom's observer never reports).
    // Svelte sets `inert` as a property; jsdom does not reflect it.
    expect(bar?.inert || bar?.hasAttribute('inert')).toBe(true);
    expect(bar?.hasAttribute('data-shown')).toBe(false);
  });
});
