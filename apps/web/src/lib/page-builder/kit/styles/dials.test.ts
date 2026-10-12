// @vitest-environment node
/**
 * The corners dial in CSS (03 X61): `kit.css`'s two rules, held to the
 * recipes they copy and to the cascade they rely on.
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
