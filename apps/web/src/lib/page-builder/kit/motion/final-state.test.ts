// @vitest-environment node
/**
 * The public page's SERVER HTML is the final state (03-expressive-contract
 * §6, §10): every word is there and nothing waits for a script to show it —
 * no inline `opacity: 0`, nothing hidden, no count-up at zero. Motion only
 * ever starts from this state in the browser, behind its gates
 * (`styles/motion.css`, `motion/count-up.ts`), and ends on it.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { StatsProps } from '../blocks/stats/definition';
import { statFigures } from '../blocks/stats/figures';
import { PAGE_STYLE_IDS } from '../model/ids';
import { sampleContext, samplePage } from '../model/sample';
import PageRenderer from '../PageRenderer.svelte';
import { parseFigure } from './count-up';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const decode = (html: string) =>
  html.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

function serve(style: (typeof PAGE_STYLE_IDS)[number]) {
  const page = samplePage(style);
  // One figure that must never count, beside the sample's that do.
  for (const section of page.sections)
    if (section.type === 'stats')
      section.props = {
        ...section.props,
        items: [
          ...((section.props.items as StatsProps['items']) ?? []),
          { value: '24/7', label: 'support' },
        ],
      };
  const context = sampleContext({
    offer: 'tiers',
    media: { heroImageUrl: '/hero.jpg' },
  });
  const html = render(PageRenderer, { props: { page, context } }).body.replace(
    /<!--[\s\S]*?-->/g,
    ''
  );
  return { page, context, html };
}

describe.each(
  PAGE_STYLE_IDS
)('the %s page, as the server sends it', (style) => {
  const { page, context, html } = serve(style);

  it('hides nothing inline', () => {
    const inline = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((match) =>
      decode(match[1])
    );
    expect(inline.length).toBeGreaterThan(0);
    for (const declarations of inline) {
      expect(declarations).not.toMatch(/(?:^|;)\s*opacity:\s*0(?![.\d])/);
      expect(declarations).not.toMatch(/(?:^|;)\s*visibility:\s*hidden/);
      expect(declarations).not.toMatch(/(?:^|;)\s*display:\s*none/);
    }
  });

  it('holds every section heading as written', () => {
    const text = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const headings = page.sections
      .map((section) => section.props.heading)
      .filter((heading): heading is string => typeof heading === 'string');
    expect(headings.length).toBeGreaterThan(5);
    for (const heading of headings) expect(text).toContain(heading);
  });

  it('holds every figure at its final value, marked where it counts', () => {
    const stats = page.sections.find((section) => section.type === 'stats');
    const expected = statFigures(
      stats?.props as StatsProps,
      context.stages
    ).map((f) => f.value);
    expect(
      expected.filter((value) => parseFigure(value)).length
    ).toBeGreaterThan(1);
    expect(expected).toContain('24/7');
    const values = [
      ...html.matchAll(
        /<span class="stat__value[^"]*"([^>]*)>([^<]*)<\/span>/g
      ),
    ];
    expect(values.map((match) => decode(match[2]))).toEqual(expected);
    for (const [, attributes, value] of values)
      expect(attributes.includes('data-lp-count'), value).toBe(
        parseFigure(decode(value)) !== null
      );
    expect(html).not.toContain('data-lp-counting');
    expect(html).not.toContain('lp-count"');
  });

  it('arms no entrance: the stage does that in the browser, below the fold', () => {
    expect(html).not.toContain('data-lp-enter');
    expect(html).not.toContain('data-lp-order');
  });
});
