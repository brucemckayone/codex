// @vitest-environment node
/**
 * Under reduced motion, every transition collapses to 0s, from one rule
 * (Codex-1vs02).
 *
 * `reset.css` used to force `transition-duration: 0.01ms` on `*`. Because
 * `transition-property` defaults to `all`, that made every element transition
 * every property it changed, even elements that declare no transition. A
 * `getComputedStyle` or layout read straight after a change then returned the
 * old value until a frame had passed. In a real browser, a font-size read
 * after a root attribute change came back one step stale. A transition starts
 * only when duration + delay is above 0s, so at 0s a change lands at once.
 *
 * jsdom runs no CSS, so it cannot see any of this. The gate reads the
 * stylesheets instead, with svelte's own CSS parser (as the page kit's
 * `styles/motion.test.ts` does). It covers every `.css` file under `src/` and
 * every component's `<style>`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const STYLES = dirname(fileURLToPath(import.meta.url));
const SRC = dirname(dirname(STYLES));
const RESET = 'lib/styles/reset.css';

interface Declared {
  /** Relative to `src/`, with the line: `lib/styles/reset.css:120`. */
  where: string;
  file: string;
  property: string;
  value: string;
  /** Every selector of the rule, as written (nested rules joined to their parents). */
  selectors: string[];
  /** The at-rules around it, outermost first. */
  conditions: string[];
}

type CssNode = {
  type: string;
  start: number;
  name?: string;
  prelude?: string | { children: { start: number; end: number }[] };
  property?: string;
  value?: string;
  block?: { children: CssNode[] } | null;
};

function declarations(
  file: string,
  nodes: CssNode[],
  source: string
): Declared[] {
  const out: Declared[] = [];
  const walk = (list: CssNode[], conditions: string[], parents: string[]) => {
    for (const node of list) {
      if (node.type === 'Atrule') {
        if (node.name === 'keyframes') continue;
        walk(
          node.block?.children ?? [],
          [...conditions, `@${node.name} ${node.prelude}`],
          parents
        );
      } else if (
        node.type === 'Rule' &&
        typeof node.prelude === 'object' &&
        node.prelude
      ) {
        const own = node.prelude.children.map((part) =>
          source.slice(part.start, part.end).replace(/\s+/g, ' ').trim()
        );
        const selectors = parents.length
          ? parents.flatMap((parent) =>
              own.map((part) =>
                part.includes('&')
                  ? part.replaceAll('&', parent)
                  : `${parent} ${part}`
              )
            )
          : own;
        for (const child of node.block?.children ?? []) {
          if (child.type === 'Declaration')
            out.push({
              where: `${file}:${source.slice(0, child.start).split('\n').length}`,
              file,
              property: child.property ?? '',
              value: (child.value ?? '').replace(/\s+/g, ' ').trim(),
              selectors,
              conditions,
            });
          else walk([child], conditions, selectors);
        }
      }
    }
  };
  walk(nodes, [], []);
  return out;
}

function sheet(path: string): Declared[] {
  const source = readFileSync(path, 'utf8');
  const file = relative(SRC, path);
  const nodes = path.endsWith('.css')
    ? parseCss(source).children
    : (parse(source, { modern: true }).css?.children ?? []);
  return declarations(file, nodes as unknown as CssNode[], source);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
  });
}

const ALL = files(SRC).flatMap(sheet);

const REDUCE = /prefers-reduced-motion:\s*reduce/;
const NO_PREFERENCE = /prefers-reduced-motion:\s*no-preference/;
/** `*`, `*::before`, `*::after`, bare or in `:global()`. */
const UNIVERSAL = /^(:global\()?\*(::?(before|after))?\)?$/;
const TRANSITION = /^transition(-[a-z-]+)?$/;

/** The value with every `var(…)` (and what nests in it) taken out. */
function withoutVars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; ) {
    if (!value.startsWith('var(', i)) {
      out += value[i++];
      continue;
    }
    let depth = 0;
    for (; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')' && --depth === 0) {
        i++;
        break;
      }
    }
    out += ' ';
  }
  return out;
}
/** A literal time above zero: `60ms`, `.3s`, `0.01ms`. Not `0s`, not `0ms`. */
const NON_ZERO_TIME =
  /(?<![\w.-])(\d*\.\d*[1-9]\d*|\d*[1-9]\d*(\.\d+)?)m?s(?![\w-])/;

describe('reduced motion collapses every transition to 0s (Codex-1vs02)', () => {
  const collapse = ALL.filter(
    (d) =>
      d.file === RESET &&
      d.conditions.some((c) => REDUCE.test(c)) &&
      d.selectors.some((s) => UNIVERSAL.test(s))
  );
  const value = (property: string) =>
    collapse.find((d) => d.property === property)?.value;

  it('reset.css holds the collapse on every element and its two pseudo-elements', () => {
    expect(collapse.length).toBeGreaterThan(0);
    for (const d of collapse)
      expect(d.selectors).toEqual(['*', '*::before', '*::after']);
  });

  it('forces transitions to 0s, so a change starts no transition and lands at once', () => {
    expect(value('transition-duration')).toBe('0s !important');
  });

  it('still stops every animation, and keeps it 0.01ms so animationend fires', () => {
    expect(value('animation-duration')).toBe('0.01ms !important');
    expect(value('animation-iteration-count')).toBe('1 !important');
    expect(value('scroll-behavior')).toBe('auto !important');
  });

  it('no other rule sets a transition on every element', () => {
    // tokens/motion.css is imported after reset.css, so its old copy of the
    // collapse (0.01ms) won over a fix made in reset.css alone.
    const universal = ALL.filter(
      (d) =>
        TRANSITION.test(d.property) &&
        d.selectors.some((s) => UNIVERSAL.test(s))
    ).map((d) => `${d.where} ${d.property}: ${d.value}`);
    expect(universal).toHaveLength(1);
    expect(universal[0]).toMatch(
      /^lib\/styles\/reset\.css:\d+ transition-duration: 0s !important$/
    );
  });
});

describe('the motion tokens are near zero under reduced motion', () => {
  const tokens = ALL.filter(
    (d) =>
      d.file === 'lib/styles/tokens/motion.css' &&
      d.property.startsWith('--duration-')
  );
  const base = tokens.filter((d) => d.conditions.length === 0);
  const reduced = new Map(
    tokens
      .filter((d) => d.conditions.some((c) => REDUCE.test(c)))
      .map((d) => [d.property, d.value])
  );

  it('overrides every duration token, at 0.01ms or less', () => {
    expect(base.length).toBeGreaterThan(0);
    for (const { property } of base) {
      const v = reduced.get(property);
      expect(v, property).toMatch(/^[\d.]+m?s$/);
      const ms = Number.parseFloat(v ?? '') * (v?.endsWith('ms') ? 1 : 1000);
      expect(ms, property).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('an !important transition is timed by a token', () => {
  // A component's `!important` transition has more specificity than the `*`
  // collapse, so it overrides it. Only its own duration can keep it still,
  // and the duration tokens are near zero under reduced motion. A literal
  // time would animate for people who asked for no motion. Gating the rule
  // behind (prefers-reduced-motion: no-preference) is the other way out.
  const important = ALL.filter(
    (d) =>
      TRANSITION.test(d.property) &&
      d.value.endsWith('!important') &&
      !(d.file === RESET && d.selectors.some((s) => UNIVERSAL.test(s)))
  );

  it('finds the ones there are (the census can see)', () => {
    expect(important.length).toBeGreaterThan(0);
  });

  it('times none of them with a literal', () => {
    const literal = important
      .filter((d) => !d.conditions.some((c) => NO_PREFERENCE.test(c)))
      .filter((d) => NON_ZERO_TIME.test(withoutVars(d.value)))
      .map((d) => `${d.where} ${d.property}: ${d.value}`);
    expect(literal).toEqual([]);
  });
});
