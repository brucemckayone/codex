/**
 * No class in the page kit may contain `__title` or `-title`.
 *
 * The org's own brand stylesheet paints every `[class*='__title']` and
 * `[class*='-title']` with the org's HEADING colour
 * (`lib/styles/tokens/org-brand.css`), so a kit element named for what it is
 * — a practice's title, say — silently takes the heading ink on every org
 * page. It happened in 03 X57: the curriculum's practice names turned the
 * brand's heading green on Of Blood & Bones' dark page, and no test noticed,
 * because the colour only exists under a real org brand. A kit heading is the
 * `Heading` primitive (`lp-heading`); anything else names itself otherwise.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const KIT = join(__dirname, '..');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith('.svelte') ? [path] : [];
  });
}

/** Comments name things too: only what the browser reads may count. */
const stripComments = (source: string) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The class names an element can carry: markup attributes and selectors. */
function classNames(source: string): string[] {
  const code = stripComments(source);
  const names: string[] = [];
  for (const [, value] of code.matchAll(/\bclass="([^"]*)"/g))
    names.push(...value.split(/\s+/));
  for (const [, name] of code.matchAll(/\bclass:([\w-]+)/g)) names.push(name);
  for (const [, name] of code.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g))
    names.push(name);
  return names.filter(Boolean);
}

const COLLIDES = /(__|-)title/;

describe('page-kit class names', () => {
  const files = svelteFiles(KIT);

  it('reads every block, primitive and shell', () => {
    // The scan must reach the kit, or a clean result means nothing.
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith('Practices.svelte'))).toBe(true);
  });

  it('never names an element so the org’s heading colour paints it', () => {
    const offenders = files.flatMap((file) =>
      classNames(readFileSync(file, 'utf8'))
        .filter((name) => COLLIDES.test(name))
        .map((name) => `${relative(KIT, file)}: .${name}`)
    );
    expect(offenders).toEqual([]);
  });
});
