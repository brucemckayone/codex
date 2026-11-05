// @vitest-environment node
/**
 * The end screen fades and rises in, and under reduced motion it simply
 * appears (Codex-2hxff.99, owner polish (d)). reset.css already cuts every
 * animation to 0.01ms under reduced motion; the component turns its own off
 * as well, as the mockup draws it, and this pins that.
 *
 * jsdom runs no CSS, so this reads the component's `<style>` with svelte's
 * own parser, as `lib/styles/reduced-motion.test.ts` does.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  'PreviewPlayer.svelte'
);

type CssNode = {
  type: string;
  name?: string;
  prelude?: string | { children: { start: number; end: number }[] };
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

interface Declared {
  selector: string;
  property: string;
  value: string;
  /** The at-rules around it, outermost first. */
  conditions: string[];
}

function declarations(): Declared[] {
  const source = readFileSync(FILE, 'utf8');
  const nodes = (parse(source, { modern: true }).css?.children ??
    []) as unknown as CssNode[];
  const out: Declared[] = [];
  const walk = (list: CssNode[], conditions: string[]) => {
    for (const node of list) {
      if (node.type === 'Atrule') {
        if (node.name === 'keyframes') continue;
        walk(node.block?.children ?? [], [
          ...conditions,
          `@${node.name} ${node.prelude}`,
        ]);
      } else if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const selectors = (node.prelude?.children ?? []).map((part) =>
          source.slice(part.start, part.end).replace(/\s+/g, ' ').trim()
        );
        for (const child of node.block?.children ?? []) {
          if (child.type !== 'Declaration') continue;
          for (const selector of selectors)
            out.push({
              selector,
              property: child.property ?? '',
              value: (child.value ?? '').replace(/\s+/g, ' ').trim(),
              conditions,
            });
        }
      }
    }
  };
  walk(nodes, []);
  return out;
}

const REDUCE = /prefers-reduced-motion:\s*reduce/;
const CTA = '.preview-player__cta';

describe('the end screen’s entrance', () => {
  const all = declarations();
  const animation = (reduced: boolean) =>
    all.filter(
      (d) =>
        d.selector === CTA &&
        d.property === 'animation' &&
        d.conditions.some((c) => REDUCE.test(c)) === reduced
    );

  it('fades and rises in, on the motion tokens', () => {
    const [entrance] = animation(false);
    expect(entrance?.value).toMatch(
      /^preview-end-in var\(--duration-[a-z]+\) var\(--ease-[a-z-]+\) both$/
    );
  });

  it('is turned off under reduced motion', () => {
    expect(animation(true).map((d) => d.value)).toEqual(['none']);
  });
});
