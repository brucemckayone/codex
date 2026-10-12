import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { priceWithCadence } from './model/copy';
import { PAGE_STYLE_IDS } from './model/ids';
import { pricingView } from './model/offer';
import { sampleContext, samplePage } from './model/sample';
import { STYLES } from './model/styles';
import type { KitPage } from './model/types';
import {
  animate,
  entranceOn,
  FakeObserver,
  install,
  wake,
} from './motion/testing';
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
  // The one sanctioned editor-only element (contract A4): an empty-state prompt.
  for (const el of copy.querySelectorAll('[data-lp-edit-only]')) el.remove();
  // Attributes in name order: the markup keeps them in the order they were
  // set, which is timing, not meaning. The editor holds the poster's picture
  // from the first paint, so `data-pictured` is set with its root; the public
  // page sets it when the still arrives, after the root's own style.
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    const attributes = [...el.attributes]
      .map(({ name, value }) => [name, value] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [name] of attributes) el.removeAttribute(name);
    for (const [name, value] of attributes) el.setAttribute(name, value);
  }
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

  // Every Style, because each defaults different layouts (Clean/Soft reach
  // the accordions, Cinematic the cover hero) — Bold alone left them unproven.
  it.each(
    PAGE_STYLE_IDS
  )('draws the %s page identical with and without the editor, apart from editing attributes', async (style) => {
    const page = samplePage(style);
    const publicRoot = await render({ page });
    // Stripping edit-only prompts must never hide a public element: the
    // public render carries none at all.
    expect(publicRoot.querySelectorAll('[data-lp-edit-only]').length).toBe(0);
    const publicHtml = publicMarkup(publicRoot);
    unmount(app);
    const edit: PageEdit = { commit: () => {} };
    const editingRoot = await render({
      page,
      edit,
      selectedId: 'sample-pricing',
    });
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
    // No background of its own: the org's surfaces are inherited, not re-derived.
    expect(root.hasAttribute('data-org-bg')).toBe(false);
  });

  it('re-derives the org’s surfaces on the carrier when the page sets its own background, light or dark', async () => {
    let root = await render({ brandOverrides: { backgroundColor: '#F6EFE6' } });
    expect(root.hasAttribute('data-org-brand')).toBe(true);
    expect(root.hasAttribute('data-org-bg')).toBe(true);
    unmount(app);
    root = await render({
      brandOverrides: { darkOverrides: { backgroundColor: '#101018' } },
    });
    expect(root.hasAttribute('data-org-bg')).toBe(true);
    expect(root.getAttribute('style')).toContain('--brand-bg-dark: #101018');
  });

  it('names which theme the page’s own background is for, so the other takes the org’s (owner, D7)', async () => {
    const cases = [
      [{ backgroundColor: '#F6EFE6' }, 'light'],
      [{ darkOverrides: { backgroundColor: '#101018' } }, 'dark'],
      [
        {
          backgroundColor: '#F6EFE6',
          darkOverrides: { backgroundColor: '#101018' },
        },
        'both',
      ],
      [{ primaryColor: '#0D9488' }, null],
      // A blank background is no background (the override drops it).
      [{ backgroundColor: '  ' }, null],
    ] as const;
    for (const [brandOverrides, expected] of cases) {
      if (app) unmount(app);
      document.body.innerHTML = '';
      const root = await render({ brandOverrides });
      expect(
        root.getAttribute('data-page-bg'),
        JSON.stringify(brandOverrides)
      ).toBe(expected);
    }
  });

  it('names each theme’s ground band on the root, so the pole follows the ground (Codex-61zsk.42)', async () => {
    const cases = [
      // Night: a dark ground for the light theme; the dark theme's is the
      // org's (none here: the platform's, so no band).
      [{ backgroundColor: '#15211C' }, 'd24', null],
      [
        {
          backgroundColor: '#E9D8B4',
          darkOverrides: { backgroundColor: '#15211C' },
        },
        'l85',
        'd24',
      ],
      [{ primaryColor: '#0D9488' }, null, null],
    ] as const;
    for (const [brandOverrides, light, dark] of cases) {
      if (app) unmount(app);
      document.body.innerHTML = '';
      const root = await render({ brandOverrides });
      const label = JSON.stringify(brandOverrides);
      expect(root.getAttribute('data-ground-light'), label).toBe(light);
      expect(root.getAttribute('data-ground-dark'), label).toBe(dark);
    }
  });

  it('draws a moving background as base off the bands its veil is proven on', async () => {
    const page = samplePage('bold');
    const hero = page.sections.find((s) => s.type === 'hero');
    if (!hero) throw new Error('no hero');
    hero.design = { ...hero.design, scheme: 'atmosphere' };
    const scheme = (root: HTMLElement) =>
      root
        .querySelector(`.lp-section[data-lp-type='hero']`)
        ?.getAttribute('data-lp-scheme');
    expect(scheme(await render({ page }))).toBe('atmosphere');
    if (app) unmount(app);
    document.body.innerHTML = '';
    expect(
      scheme(
        // L 0.82: the l80 band, whose veil would hide the shader (03 X50).
        await render({ page, brandOverrides: { backgroundColor: '#D2C3A8' } })
      )
    ).toBe('base');
  });

  it('marks the section that continues the band above, and only it (03 X58)', async () => {
    const page: KitPage = {
      design: { style: 'studio' },
      sections: [
        {
          id: 'p',
          type: 'pricing',
          enabled: true,
          design: { scheme: 'base' },
          props: { heading: 'Join' },
        },
        {
          id: 'q',
          type: 'faq',
          enabled: true,
          design: { scheme: 'base' },
          props: {},
        },
        {
          id: 'r',
          type: 'faq',
          enabled: true,
          design: { scheme: 'base' },
          props: { heading: 'More' },
        },
      ],
    };
    const root = await render({ page });
    const marked = [
      ...root.querySelectorAll('.lp-section[data-lp-continues]'),
    ].map((s) => s.id);
    expect(marked).toEqual(['faq']);
  });

  it('previews a theme on its own root, never on <html>', async () => {
    const root = await render({ theme: 'dark' });
    expect(root.dataset.lpTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(
      'dark'
    );
  });

  describe("the page's dials (03 X61)", () => {
    const dialled = (dials: unknown): KitPage => {
      const page = samplePage('soft');
      return { ...page, design: { ...page.design, dials: dials as never } };
    };

    it('names the corners on the root', async () => {
      const root = await render({ page: dialled({ corners: 'rounder' }) });
      expect(root.dataset.lpCorners).toBe('rounder');
    });

    it('names no corners a page did not set', async () => {
      expect((await render()).hasAttribute('data-lp-corners')).toBe(false);
    });

    it('never writes a step no rule draws: it would match nothing', async () => {
      const root = await render({ page: dialled({ corners: 'square' }) });
      expect(root.hasAttribute('data-lp-corners')).toBe(false);
    });

    it('draws each section in the colour and spacing its dials resolve to', async () => {
      const root = await render({
        page: dialled({ colour: 'vivid', spacing: 'spacious' }),
      });
      const sections = [...root.querySelectorAll('.lp-section')];
      // Soft's questions stay a tint beside its brand ask; its other tints go brand.
      expect(
        sections
          .filter(
            (s) =>
              STYLES.soft.schemes[s.getAttribute('data-lp-type') as 'faq'] ===
              'soft'
          )
          .map((s) => s.getAttribute('data-lp-scheme'))
      ).toEqual(
        sections
          .filter(
            (s) =>
              STYLES.soft.schemes[s.getAttribute('data-lp-type') as 'faq'] ===
              'soft'
          )
          .map((s) =>
            s.getAttribute('data-lp-type') === 'faq' ? 'soft' : 'brand'
          )
      );
      expect(
        new Set(sections.map((s) => s.getAttribute('data-lp-spacing')))
      ).toEqual(new Set(['spacious']));
    });
  });

  describe('atmosphere and background images (03 §5)', () => {
    const IMAGE = { key: 'landing-pages/page-1/images/image-1' };
    const CDN = 'https://cdn.example';

    /** Bold's sample page with a Moving background hero and imaged sections. */
    function surfacedPage(): KitPage {
      const page = samplePage('bold');
      return {
        ...page,
        sections: page.sections.map((s) => {
          if (s.type === 'hero')
            return {
              ...s,
              design: { scheme: 'atmosphere' as const },
              props: { ...s.props, background: IMAGE },
            };
          if (s.type === 'text' || s.type === 'cta')
            return { ...s, props: { ...s.props, background: IMAGE } };
          return s;
        }),
      };
    }

    const context = () => sampleContext({ offer: 'tiers', mediaBaseUrl: CDN });

    it('flags a live page that has a Moving background section, in the look its Style asks for, blurred when it names none', async () => {
      // Bold asks for the hazy look (03 X59).
      const root = await render({ page: surfacedPage(), context: context() });
      expect(root.dataset.lpAtmosphere).toBe('hazy');
      unmount(app);
      // Cinematic asks for it sharp.
      const page = samplePage('cinematic');
      page.sections[0] = {
        ...page.sections[0],
        design: { scheme: 'atmosphere' },
      };
      const sharp = await render({ page, context: context() });
      expect(sharp.dataset.lpAtmosphere).toBe('sharp');
      unmount(app);
      // A Style that names no look is blurred, as the org's other pages.
      const bold = STYLES.bold as { atmosphere?: 'soft' | 'hazy' | 'sharp' };
      const asked = bold.atmosphere;
      delete bold.atmosphere;
      try {
        const soft = await render({ page: surfacedPage(), context: context() });
        expect(soft.dataset.lpAtmosphere).toBe('soft');
      } finally {
        bold.atmosphere = asked;
      }
    });

    it('never flags it while editing, in a still thumbnail, or without such a section', async () => {
      const edit: PageEdit = { commit: () => {} };
      for (const props of [
        { page: surfacedPage(), edit },
        { page: surfacedPage(), still: true },
        { page: samplePage('bold') },
      ]) {
        const root = await render({ ...props, context: context() });
        expect(root.hasAttribute('data-lp-atmosphere')).toBe(false);
        unmount(app);
        app = null;
      }
    });

    // Contract X11: the org's shader reads the ORG's colours, so a page with its
    // own colours would clash with it; it draws the glow in its own colours.
    it('uses the glow, not the org shader, once the page has its own colours', async () => {
      for (const brandOverrides of [
        { primaryColor: '#0D9488' },
        { secondaryColor: '#1B2A41' },
      ]) {
        const root = await render({
          page: surfacedPage(),
          context: context(),
          brandOverrides,
        });
        expect(root.hasAttribute('data-lp-atmosphere')).toBe(false);
        unmount(app);
        app = null;
      }
      // Fonts alone leave the colours the shader draws with untouched.
      const fontsOnly = await render({
        page: surfacedPage(),
        context: context(),
        brandOverrides: { fontHeading: 'Syne' },
      });
      expect(fontsOnly.dataset.lpAtmosphere).toBe('hazy');
    });

    it('draws a background image behind a section, decoratively, on the media colours', async () => {
      const root = await render({ page: surfacedPage(), context: context() });
      const text = root.querySelector<HTMLElement>('#text');
      const img = text?.querySelector('.lp-surface > img');
      expect(img?.getAttribute('src')).toBe(`${CDN}/${IMAGE.key}/lg.webp`);
      expect(img?.getAttribute('alt')).toBe('');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('decoding')).toBe('async');
      expect(
        text?.querySelector('.lp-surface')?.getAttribute('aria-hidden')
      ).toBe('true');
      expect(text?.hasAttribute('data-lp-on-media')).toBe(true);
      // The surface sits behind the content, as the section's first child.
      expect(text?.firstElementChild?.classList.contains('lp-surface')).toBe(
        true
      );
    });

    it('leaves the hero and the call to action to their own media', async () => {
      const root = await render({ page: surfacedPage(), context: context() });
      for (const id of ['#hero', '#cta']) {
        const section = root.querySelector<HTMLElement>(id);
        expect(section?.querySelector('.lp-surface img')).toBeNull();
        expect(section?.hasAttribute('data-lp-on-media')).toBe(false);
      }
      // Every other section still has an (empty) surface for Style decoration.
      expect(root.querySelectorAll('.lp-section > .lp-surface')).toHaveLength(
        root.querySelectorAll('.lp-section').length
      );
    });

    it('renders no image without a CDN base, and the section keeps its scheme', async () => {
      const root = await render({
        page: surfacedPage(),
        context: sampleContext({ offer: 'tiers' }),
      });
      const text = root.querySelector<HTMLElement>('#text');
      expect(text?.querySelector('.lp-surface img')).toBeNull();
      expect(text?.hasAttribute('data-lp-on-media')).toBe(false);
    });

    it('draws the surfaced page identical with and without the editor', async () => {
      const page = surfacedPage();
      const publicRoot = await render({ page, context: context() });
      const publicHtml = publicMarkup(publicRoot);
      unmount(app);
      const editingRoot = await render({
        page,
        context: context(),
        edit: { commit: () => {} },
      });
      expect(publicMarkup(editingRoot)).toBe(publicHtml);
    });
  });

  // Codex-61zsk.39: a creator who recommends a path other than the platform's
  // must see that same path featured everywhere the page sells.
  it('features the pricing section’s recommended path in the call to action and the floating bar too', async () => {
    const page = samplePage('bold', ['hero', 'pricing', 'cta']);
    const pricing = page.sections.find((s) => s.type === 'pricing');
    expect(pricing).toBeDefined();
    pricing!.props = {
      ...pricing!.props,
      offers: [{ id: 'purchase', best: true }],
    };
    const context = sampleContext({
      offer: 'tiers',
      media: { heroImageUrl: '/hero.jpg' },
    });
    const authored = pricingView(context, pricing!.props).featured;
    // The premise: on its own the platform recommends a different path.
    expect(authored?.id).toBe('purchase');
    expect(pricingView(context, {}).featured?.id).not.toBe('purchase');

    const root = await render({ page, context });
    const cta = root.querySelector('.cta');
    expect(cta?.querySelector('.cta__amount')?.textContent).toBe(
      authored!.priceLabel
    );
    expect(
      cta?.querySelector('a[href*="offer="]')?.getAttribute('href')
    ).toContain('offer=purchase');
    expect(
      root.querySelector('.pricing a[href*="offer=purchase"]')
    ).not.toBeNull();
    expect(document.body.querySelector('.lp-sticky__price')?.textContent).toBe(
      priceWithCadence(authored!)
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

  it.each(
    PAGE_STYLE_IDS
  )('draws the %s floating bar in the scheme its Style names', async (style) => {
    const root = await render({ page: samplePage(style) });
    expect(
      root.querySelector('.lp-sticky')?.getAttribute('data-lp-scheme')
    ).toBe(STYLES[style].sticky ?? 'base');
  });

  it('floats the bar on the org’s own surface (base, its raised card) unless a Style names a band: Cinematic’s on its tint', async () => {
    const bars: Record<string, string | null | undefined> = {};
    for (const style of ['quiet', 'cinematic', 'bold'] as const) {
      const root = await render({ page: samplePage(style) });
      bars[style] = root
        .querySelector('.lp-sticky')
        ?.getAttribute('data-lp-scheme');
      if (app) unmount(app);
      app = null;
    }
    expect(bars).toEqual({
      quiet: 'base',
      cinematic: 'soft',
      bold: 'base',
    });
  });
});

describe('PageRenderer entrances (03 X13)', () => {
  let restore: () => void;

  beforeEach(() => {
    install();
    // What motion.css gives a heading that builds, once armed (jsdom runs no CSS).
    restore = animate((el) =>
      el.matches('.lp-heading') ? [entranceOn(el)] : []
    );
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  const headings = (root: HTMLElement) => [
    ...root.querySelectorAll<HTMLElement>(
      '.lp-section:not([data-lp-type="hero"]) .lp-heading'
    ),
  ];

  it('stages the public page from its root: one below the fold waits, one on screen stays', async () => {
    const root = await render();
    const [onScreen, ...below] = headings(root);
    expect(below.length).toBeGreaterThan(3);
    wake(onScreen, 'on');
    for (const heading of below) wake(heading, 'below');
    expect(onScreen.hasAttribute('data-lp-enter')).toBe(false);
    expect(below.map((h) => h.getAttribute('data-lp-enter'))).toEqual(
      below.map(() => 'wait')
    );
  });

  it.each([
    ['the canvas', { edit: { commit: () => {} } }],
    ['a still thumbnail', { still: true }],
  ])('stages nothing on %s', async (_, props) => {
    const root = await render(props);
    for (const heading of headings(root)) wake(heading, 'below');
    expect(root.querySelector('[data-lp-enter]')).toBeNull();
    expect(
      FakeObserver.all.some((o) => headings(root).some((h) => o.targets.has(h)))
    ).toBe(false);
  });
});
