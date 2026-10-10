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
import Media from './Media.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

type CssNode = {
  type: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number };
  block?: { children: CssNode[] } | null;
};

/** What each selector of a component's <style> declares (its rules merged, a
 * container query's included); comments stripped. */
function declarations(source: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  const squash = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      const children = node.block?.children ?? [];
      if (node.type === 'Rule' && node.prelude) {
        const selector = squash(
          source.slice(node.prelude.start, node.prelude.end)
        );
        const own = rules.get(selector) ?? {};
        for (const child of children)
          if (child.type === 'Declaration')
            own[child.property ?? ''] = squash(child.value ?? '');
        rules.set(selector, own);
      }
      visit(children);
    }
  };
  visit((parse(source, { modern: true }).css?.children ?? []) as CssNode[]);
  return rules;
}

describe('Media', () => {
  it('draws the image when there is one', () => {
    app = mount(Media, { target: document.body, props: { image: '/a.jpg' } });
    flushSync();
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/a.jpg'
    );
    expect(document.body.querySelector('.lp-media__plate')).toBeNull();
  });

  it('falls back to the designed plate when the image fails, never a broken glyph', () => {
    app = mount(Media, {
      target: document.body,
      props: { image: '/gone.jpg' },
    });
    flushSync();
    document.body.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.querySelector('.lp-media__plate')).not.toBeNull();
    expect(
      document.body.querySelector('.lp-media')?.hasAttribute('data-empty')
    ).toBe(true);
  });

  // The section's accent is measured against the SECTION: on a brand band it
  // is the band's ink, and the plate sits on the panel — white on near-white
  // there, 1.04:1. The marks must come from the surface they are drawn on.
  it('marks the plate in its panel’s own ink, quieter than any word, never the section’s accent', () => {
    const plate = declarations(source()).get('.lp-media__plate');
    expect(plate).toBeDefined();
    const mark =
      /^color-mix\(in oklab, var\(--lp-panel-ink\) (\d+)%, var\(--lp-panel\)\)$/;
    const disc = plate!['--_disc']?.match(mark);
    const ring = plate!['--_ring']?.match(mark);
    expect(disc, plate!['--_disc']).not.toBeNull();
    expect(ring, plate!['--_ring']).not.toBeNull();
    // A soft disc and a finer, firmer ring — both well short of text.
    expect(Number(disc![1])).toBeLessThan(Number(ring![1]));
    expect(Number(ring![1])).toBeLessThanOrEqual(40);
    expect(plate!.background).toContain('var(--_disc)');
    expect(plate!.background).toContain('var(--_ring)');
    expect(Object.values(plate!).join(' ')).not.toContain('--lp-accent');
  });

  // Codex-61zsk.37 (C1): the plate says "a picture goes here", which is a word
  // for the creator. On a live page it is never painted; each block also
  // re-composes, so an empty frame is rarely drawn there at all.
  it('paints the plate only where the page is looked at: the canvas and still thumbnails', () => {
    const rules = declarations(source());
    expect(
      rules.get(':global(.lp:not([data-lp-still])) .lp-media__plate')
    ).toEqual({ display: 'none' });
    expect(rules.get('.lp-media__plate')?.display).toBeUndefined();
  });

  it('stands a mark in for the picture: letters on the scheme it is given, never the plate', () => {
    app = mount(Media, {
      target: document.body,
      props: { mark: 'ML', scheme: 'contrast' },
    });
    flushSync();
    const box = document.body.querySelector('.lp-media');
    expect(box?.querySelector('.lp-media__plate')).toBeNull();
    expect(box?.querySelector('[aria-hidden="true"]')?.textContent).toBe('ML');
    expect(box?.getAttribute('data-lp-scheme')).toBe('contrast');
    // Designed content, not an empty frame: nothing may treat it as one.
    expect(box?.hasAttribute('data-empty')).toBe(false);
  });

  it('draws a picture over any mark', () => {
    app = mount(Media, {
      target: document.body,
      props: { image: '/a.jpg', mark: 'ML', scheme: 'contrast' },
    });
    flushSync();
    expect(document.body.querySelector('img')).not.toBeNull();
    expect(document.body.textContent?.trim()).toBe('');
    expect(
      document.body.querySelector('.lp-media')?.hasAttribute('data-lp-scheme')
    ).toBe(false);
  });
});

function source(): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Media.svelte'),
    'utf8'
  );
}
