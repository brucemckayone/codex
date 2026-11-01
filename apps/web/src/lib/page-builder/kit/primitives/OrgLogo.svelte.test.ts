/**
 * The org's logo above the hero's words (Codex-61zsk.73): its picture and
 * the name it says, bare or on its plate, and nothing at all where there is
 * no logo to draw. Its sizes are CSS, so they are read from its stylesheet.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sheetRules } from '../blocks/testing';
import OrgLogo from './OrgLogo.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function draw(props: {
  logoUrl: string;
  name: string;
  plate: boolean;
  class?: string;
}) {
  app = mount(OrgLogo, { target: document.body, props });
  flushSync();
  return document.body.querySelector('img');
}

type CssNode = {
  type: string;
  name?: string;
  prelude?: string | { start: number; end: number };
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'OrgLogo.svelte'),
  'utf8'
);

/** Every declaration of each rule in source order, keyed `@<at-rule>
 * <selector>` (or the bare selector at the top level); comments stripped. */
function cascade(): Map<string, Array<[string, string]>> {
  const rules = new Map<string, Array<[string, string]>>();
  const squash = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const visit = (nodes: CssNode[], within: string) => {
    for (const node of nodes) {
      const children = node.block?.children ?? [];
      if (node.type === 'Atrule') {
        visit(children, `@${node.name} ${squash(String(node.prelude))} `);
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const key = `${within}${squash(source.slice(node.prelude.start, node.prelude.end))}`;
        const own = rules.get(key) ?? [];
        for (const child of children)
          if (child.type === 'Declaration')
            own.push([child.property ?? '', squash(child.value ?? '')]);
        rules.set(key, own);
      }
    }
  };
  visit((parse(source, { modern: true }).css?.children ?? []) as CssNode[], '');
  return rules;
}

/** What each rule ends up declaring: the last of each property. */
function declarations(): Map<string, Record<string, string>> {
  return new Map(
    [...cascade()].map(([key, list]) => [key, Object.fromEntries(list)])
  );
}

describe('OrgLogo', () => {
  it('draws the logo, described by the org’s name', () => {
    const img = draw({
      logoUrl: 'https://cdn.test/logo.svg',
      name: 'Studio Alpha',
      plate: false,
    });
    expect(img?.getAttribute('src')).toBe('https://cdn.test/logo.svg');
    expect(img?.getAttribute('alt')).toBe('Studio Alpha');
  });

  // The rail and the bottom bar already go home; a new tab stop would
  // change every Tab walk.
  it('is no link and no tab stop', () => {
    draw({
      logoUrl: 'https://cdn.test/logo.svg',
      name: 'Studio Alpha',
      plate: true,
    });
    expect(document.body.querySelector('a')).toBeNull();
    expect(document.body.querySelector('[tabindex]')).toBeNull();
    expect(document.body.querySelectorAll('img')).toHaveLength(1);
  });

  // Unforced, the ink decides in CSS; nothing in the markup says plate.
  it('forces the plate only when asked; otherwise leaves it to the ink', () => {
    expect(
      draw({
        logoUrl: '/logo.svg',
        name: 'Studio Alpha',
        plate: false,
      })?.hasAttribute('data-plate')
    ).toBe(false);
    if (app) unmount(app);
    expect(
      draw({
        logoUrl: '/logo.svg',
        name: 'Studio Alpha',
        plate: true,
      })?.hasAttribute('data-plate')
    ).toBe(true);
  });

  it('takes the caller’s hooks on its own box', () => {
    const img = draw({
      logoUrl: '/logo.svg',
      name: 'Studio Alpha',
      plate: false,
      class: 'hero__logo',
    });
    expect(img?.classList.contains('lp-logo')).toBe(true);
    expect(img?.classList.contains('hero__logo')).toBe(true);
  });

  it('draws nothing with no address: no placeholder', () => {
    expect(draw({ logoUrl: '', name: 'Studio Alpha', plate: true })).toBeNull();
    expect(document.body.innerHTML.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe(
      ''
    );
  });

  it('leaves nothing when the logo fails to load, says which, and tries a new one', () => {
    const failed: string[] = [];
    const props = $state({
      logoUrl: '/gone.svg',
      name: 'Studio Alpha',
      plate: true,
      onfail: (url: string) => failed.push(url),
    });
    app = mount(OrgLogo, { target: document.body, props });
    flushSync();
    document.body.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(document.body.querySelector('img')).toBeNull();
    expect(failed).toEqual(['/gone.svg']);

    props.logoUrl = '/new.svg';
    flushSync();
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/new.svg'
    );
  });

  describe('its sizes', () => {
    const rules = declarations();
    const base = rules.get('.lp-logo') ?? {};
    // The kit sizes it, so what sits under it (the poster's drop, Path's
    // stop) reads the same box.
    const kit = sheetRules(
      join(dirname(fileURLToPath(import.meta.url)), '../styles/kit.css')
    ).filter((rule) => rule.decls.has('--lp-logo-h'));

    it('is 40px tall in the kit’s box, its own proportions kept, never wider than 160px', () => {
      const wide = kit.find((rule) => rule.within.length === 0);
      expect(wide?.selector).toBe('.lp-section');
      expect(wide?.decls.get('--lp-logo-h')).toBe('var(--space-10)');
      expect(wide?.decls.get('--lp-logo-box')).toBe(
        'calc(var(--lp-logo-h) * 1.3)'
      );
      expect(base['--_h']).toBe('var(--lp-logo-h)');
      expect(base['block-size']).toBe('var(--lp-logo-box)');
      expect(base['inline-size']).toBe('auto');
      expect(base['max-inline-size']).toBe(
        'calc(min(calc(var(--space-10) * 4), 100%) + 2 * var(--_pad-i))'
      );
      expect(base['object-fit']).toBe('contain');
    });

    it('is 32px tall at phone width, and still at most 160px wide', () => {
      const phone = kit.filter((rule) => rule.within.length > 0);
      expect(phone).toHaveLength(1);
      expect(phone[0].within).toEqual([
        '@container lp-page (max-width: 30rem)',
      ]);
      expect(Object.fromEntries(phone[0].decls)).toEqual({
        '--lp-logo-h': 'var(--space-8)',
      });
      // It keeps no size of its own to drift from the kit's.
      for (const [selector, own] of rules)
        if (selector !== '.lp-logo')
          expect(own['--_h'], selector).toBeUndefined();
    });

    // The hero's grid gap already sets it that far above the eyebrow.
    it('sets no space above or below itself', () => {
      for (const [selector, own] of rules)
        for (const property of Object.keys(own))
          expect(property, selector).not.toMatch(
            /^margin(-block|-top|-bottom)?$/
          );
    });

    // The plate's padding is always there, so the mark stays on the
    // eyebrow's edge whether or not the plate shows; a centred parent sees
    // equal margins either side.
    it('takes its inline padding back, so the mark lines up with the words', () => {
      expect(base.padding).toBe('var(--_pad-b) var(--_pad-i)');
      expect(base['margin-inline']).toBe('calc(-1 * var(--_pad-i))');
      expect(base['--_pad-b']).toBe(
        'calc((var(--lp-logo-box) - var(--_h)) / 2)'
      );
      expect(base['--_pad-i']).toBe('calc(var(--_h) * 0.25)');
      for (const [selector, own] of rules)
        if (selector !== '.lp-logo')
          expect(Object.keys(own), selector).not.toContain('--_pad-i');
    });

    it('lets its parent align it', () => {
      for (const own of rules.values())
        expect(own['justify-self']).toBeUndefined();
    });
  });

  describe('its plate', () => {
    const rules = declarations();
    const base = rules.get('.lp-logo') ?? {};
    const forcedPlate = rules.get('.lp-logo[data-plate]') ?? {};
    const white = 'oklch(from var(--lp-ink) 1 0 0)';

    it('is a small rounded plate, its corners the Style’s', () => {
      expect(base['border-radius']).toBe(
        'min(var(--lp-radius-media), calc(var(--_h) * 0.25))'
      );
    });

    // Light ink means a dark ground: opaque white there, clear on a light one.
    it('decides from the ink, after a fallback with no plate', () => {
      const backgrounds = (cascade().get('.lp-logo') ?? [])
        .filter(([property]) => property === 'background')
        .map(([, value]) => value);
      expect(backgrounds).toEqual([
        'none',
        'oklch(from var(--lp-ink) 1 0 0 / clamp(0, (l - 0.5) * 100, 1))',
      ]);
    });

    it('is always opaque white when forced', () => {
      expect(forcedPlate).toEqual({ background: white });
    });

    // It would outline a clear plate on a light ground.
    it('casts no shadow', () => {
      for (const [selector, own] of rules)
        expect(own['box-shadow'], selector).toBeUndefined();
    });

    it('keeps its white in forced colours, outlined in the user’s text colour, whatever was asked', () => {
      const forced = rules.get('@media (forced-colors: active) .lp-logo') ?? {};
      expect(forced).toEqual({
        background: white,
        'forced-color-adjust': 'none',
        outline: 'var(--lp-border) solid CanvasText',
      });
    });

    it('hard-codes no colour', () => {
      const css = source
        .slice(source.indexOf('<style>'))
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(
        /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bwhite\b|\bblack\b/i
      );
    });
  });
});
