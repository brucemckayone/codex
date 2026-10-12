/**
 * The page spaces a section whose block has no head as the continuation of
 * the band above (03 X58), and it learns which blocks have one from
 * `HEADED_BY_WORDS`. That list is only true while it names exactly the blocks
 * that draw their head from `hasHead`: a block added to it that heads itself
 * some other way would lose its top padding while still drawing a heading,
 * and a block that reads `hasHead` but is missing from it would keep a
 * chapter break of empty ground over its untitled content.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTION_TYPE_IDS } from '../model/ids';
import { HEADED_BY_WORDS } from '../model/resolve';

const BLOCKS = __dirname;

/** Comments name things too: only code may count. */
const stripComments = (source: string) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Each section type's own Svelte files, comments stripped. */
const sources = SECTION_TYPE_IDS.map((type) => {
  const dir = join(BLOCKS, type);
  const code = readdirSync(dir)
    .filter((name) => name.endsWith('.svelte'))
    .map((name) => stripComments(readFileSync(join(dir, name), 'utf8')))
    .join('\n');
  return { type, code };
});

describe('HEADED_BY_WORDS', () => {
  it('reads every section type’s block', () => {
    // The scan must reach the blocks, or an empty match means nothing.
    expect(sources.every(({ code }) => code.includes('<script'))).toBe(true);
  });

  it('names exactly the blocks that draw their head from `hasHead`', () => {
    const reading = sources
      .filter(({ code }) => /\bhasHead\(/.test(code))
      .map(({ type }) => type);
    expect(reading.sort()).toEqual([...HEADED_BY_WORDS].sort());
  });

  it('leaves no block reading its eyebrow, heading and lead by hand', () => {
    const byHand = sources
      .filter(({ code }) =>
        /content\.eyebrow\s*\|\|\s*content\.heading\s*\|\|\s*content\.body/.test(
          code
        )
      )
      .map(({ type }) => type);
    expect(byHand).toEqual([]);
  });
});
