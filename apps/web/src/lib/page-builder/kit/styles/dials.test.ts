// @vitest-environment node
/**
 * The page dials in CSS. The corners dial (03 X61): `kit.css`'s two rules,
 * held to the recipes they copy and to the cascade they rely on. The type
 * dial and the motion dial's `still` (X62): a factor in every headline size,
 * and the timing tokens made instant as `tokens/motion.css` makes them.
 *
 * Each step is a recipe the kit already draws: `brand` is the kit's own
 * defaults, `rounder` is Soft's. A copy left behind its source changes one
 * page's corners and no other's, silently, so each is held here to its
 * source. And the dial wins by one attribute over each Style's own tokens
 * (`.lp[data-lp-style='<id>']`), which holds only while every Style declares
 * its corners there and nothing below the root declares them at all: a
 * token declared on a descendant beats any root rule by inheritance.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_DIALS, PAGE_STYLE_IDS } from '../model/ids';

const DIR = dirname(fileURLToPath(import.meta.url));
const KIT = join(DIR, '..');
const TOKEN_FILE = join(KIT, '..', '..', 'styles', 'tokens', 'motion.css');
const read = (path: string) => readFileSync(join(DIR, path), 'utf8');
const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = ['card', 'media', 'button', 'chip'].map(
  (name) => `--lp-radius-${name}`
);

/** Each radius token declaration in a sheet, with the selector it sits under. */
function declarations(source: string) {
  const css = uncomment(source);
  return [
    ...css.matchAll(/(--lp-radius-(?:card|media|button|chip)):\s*([^;]+);/g),
  ].map((match) => {
    const open = css.lastIndexOf('{', match.index);
    const selector = css.slice(css.lastIndexOf('}', open) + 1, open).trim();
    return { token: match[1], value: match[2].trim(), selector };
  });
}

/** Every kit stylesheet and component, by path from the kit. */
function kitSources(dir = KIT): { file: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return kitSources(path);
    return /\.(css|svelte)$/.test(entry.name)
      ? [{ file: relative(KIT, path), source: readFileSync(path, 'utf8') }]
      : [];
  });
}

/** Each custom property a rule declares, by name (whitespace collapsed). */
function block(source: string, selector: string): Record<string, string> {
  const css = uncomment(source);
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return {};
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].replace(/\s+/g, ' ').trim(),
    ])
  );
}

/** The four tokens a rule declares, by token. */
function rule(source: string, selector: string) {
  const found = declarations(source).filter((d) => d.selector === selector);
  return Object.fromEntries(found.map((d) => [d.token, d.value]));
}

describe('the corners dial', () => {
  const kit = read('kit.css');

  it('has a rule for each of its steps, and for nothing else', () => {
    const steps = [
      ...new Set(
        declarations(kit)
          .map((d) => d.selector.match(/data-lp-corners='([^']+)'/)?.[1])
          .filter(Boolean)
      ),
    ];
    expect(steps.sort()).toEqual([...PAGE_DIALS.corners].sort());
  });

  it("brand is the kit's own corners", () => {
    const own = rule(kit, '.lp');
    expect(Object.keys(own).sort()).toEqual([...TOKENS].sort());
    expect(rule(kit, ".lp[data-lp-style][data-lp-corners='brand']")).toEqual(
      own
    );
  });

  it("rounder is Soft's corners", () => {
    const soft = rule(read('style-soft.css'), ".lp[data-lp-style='soft']");
    expect(Object.keys(soft).sort()).toEqual([...TOKENS].sort());
    expect(rule(kit, ".lp[data-lp-style][data-lp-corners='rounder']")).toEqual(
      soft
    );
  });

  it("wins over every Style's own: each declares its corners on its root, one attribute fewer", () => {
    for (const style of PAGE_STYLE_IDS) {
      const found = declarations(read(`style-${style}.css`));
      expect(found.map((d) => d.token).sort(), style).toEqual(
        [...TOKENS].sort()
      );
      for (const { selector } of found)
        expect(selector, style).toBe(`.lp[data-lp-style='${style}']`);
    }
  });

  it('is never undercut from below: nothing else in the kit declares a corner token', () => {
    const sheets = new Set([
      'kit.css',
      ...PAGE_STYLE_IDS.map((s) => `style-${s}.css`),
    ]);
    const stray: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.(css|svelte)$/.test(entry.name) &&
          !sheets.has(relative(DIR, path))
        )
          for (const { token } of declarations(readFileSync(path, 'utf8')))
            stray.push(`${relative(KIT, path)} ${token}`);
      }
    };
    walk(KIT);
    expect(stray).toEqual([]);
  });
});

describe('the type dial', () => {
  const kit = read('kit.css');
  const SIZE = /(--lp-size-(display|heading|cta)):\s*([^;]+);/g;

  it('has a rule for each of its steps', () => {
    const steps = [...uncomment(kit).matchAll(/data-lp-drama='([^']+)'/g)].map(
      (m) => m[1]
    );
    expect(steps.sort()).toEqual([...PAGE_DIALS.drama].sort());
  });

  // A size with no factor keeps one Style's headlines, or one block's, the
  // same size at every step, silently.
  it("multiplies every headline size the kit and each Style declare by its kind's factor", () => {
    const sizes = kitSources().flatMap(({ file, source }) =>
      [...uncomment(source).matchAll(SIZE)].map((m) => ({
        file,
        token: m[1],
        kind: m[2] === 'heading' ? 'heading' : 'display',
        value: m[3].trim(),
      }))
    );
    expect(sizes.length).toBeGreaterThanOrEqual(28);
    const wrong = sizes.filter(
      ({ kind, value }) =>
        // One size may stand for another (the closing ask's heading).
        !/^var\(--lp-size-(display|heading|cta)\)$/.test(value) &&
        !value.endsWith(`* var(--lp-scale) * var(--lp-drama-${kind}, 1))`)
    );
    expect(wrong.map((s) => `${s.file} ${s.token}: ${s.value}`)).toEqual([]);
  });

  it('calmer takes every headline a step down; louder only the section headings', () => {
    expect(block(kit, ".lp[data-lp-drama='calmer']")).toEqual({
      '--lp-drama-display': '0.85',
      '--lp-drama-heading': '0.85',
    });
    expect(block(kit, ".lp[data-lp-drama='louder']")).toEqual({
      '--lp-drama-heading': '1.15',
      '--lp-drama-held': 'calc(1 / var(--lp-drama-heading))',
    });
  });

  it('is never undercut from below: nothing else declares a factor', () => {
    const stray = kitSources().flatMap(({ file, source }) =>
      [...uncomment(source).matchAll(/(--lp-drama-[\w-]+):/g)]
        .filter(() => file !== 'styles/kit.css')
        .map((m) => `${file} ${m[1]}`)
    );
    // The closing band draws its heading at the ask's size, which has no
    // louder step in it, so it says there is none to take back.
    expect(stray).toEqual(['blocks/cta/CtaBlock.svelte --lp-drama-held']);
    expect(uncomment(kit).match(/--lp-drama-[\w-]+:/g)).toHaveLength(4);
  });

  // A quote, a price, a number or a lead tile's name drawn at the heading's
  // size sits in a card's or a column's room, which louder's fit cannot see.
  // So it follows the dial down and never up; only the section heading grows.
  it("holds louder's step out of every other use of the heading's size", () => {
    const uses = kitSources().flatMap(({ file, source }) =>
      uncomment(source)
        .split('\n')
        .filter((line) => line.includes('var(--lp-size-heading)'))
        .map((line) => ({ file, line: line.trim() }))
    );
    const free = uses.filter(
      ({ file, line }) =>
        !line.includes('var(--lp-size-heading) * var(--lp-drama-held, 1)') &&
        // The section heading, which louder grows as far as it fits (its
        // title's hold is pinned in `blocks/benefits/lift.source.test.ts`).
        file !== 'primitives/Heading.svelte' &&
        // Path's route stops on the section heading's line.
        file !== 'styles/style-path.css'
    );
    // A floor, so the scan is seen to read the kit: 13 since the wall stopped
    // restating Voice's featured quote size (Codex-61zsk.28).
    expect(uses.length).toBeGreaterThanOrEqual(13);
    expect(free.map(({ file, line }) => `${file}: ${line}`)).toEqual([]);
  });
});

describe("the motion dial's still", () => {
  const still = block(read('kit.css'), ".lp[data-lp-motion='still']");
  const tokens = block(readFileSync(TOKEN_FILE, 'utf8'), ':root');

  it('makes every timing token instant, as reduced motion does', () => {
    const durations = Object.keys(tokens).filter((t) =>
      t.startsWith('--duration-')
    );
    expect(durations.length).toBeGreaterThanOrEqual(5);
    for (const token of durations) expect(still[token], token).toBe('0.01ms');
  });

  // Each is declared again so its `var()`s take the instant durations: one
  // left to inherit keeps `:root`'s, and every transition built on it moves.
  it('declares every transition again, as the token file writes it', () => {
    const transitions = Object.keys(tokens).filter((t) =>
      t.startsWith('--transition-')
    );
    expect(transitions.length).toBeGreaterThanOrEqual(4);
    for (const token of transitions)
      expect(still[token], token).toBe(tokens[token]);
    expect(Object.keys(still).sort()).toEqual(
      Object.keys(tokens)
        .filter((t) => /^--(duration|transition)-/.test(t))
        .sort()
    );
  });
});
