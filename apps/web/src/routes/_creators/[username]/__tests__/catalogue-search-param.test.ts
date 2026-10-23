/**
 * The creator catalogue's search box submits the param its load reads
 * (Codex-osuqt). It was `name="q"` while the load read `?search=`, so a search
 * submitted before hydration (or with JS off) was dropped without a word.
 * Asserted on source, comments stripped, because the two halves live in a
 * component and a load that no single render exercises together.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONTENT_DIR = join(import.meta.dirname, '..', 'content');

const withoutComments = (source: string) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('creator catalogue search', () => {
  it('names its search input after the param the load reads', async () => {
    const page = withoutComments(
      await readFile(join(CONTENT_DIR, '+page.svelte'), 'utf8')
    );
    const load = withoutComments(
      await readFile(join(CONTENT_DIR, '+page.server.ts'), 'utf8')
    );

    const input = page.match(/<input[^>]*id="creator-content-search"[^>]*>/);
    const name = input?.[0].match(/\bname="([^"]+)"/)?.[1];

    expect(name).toBeDefined();
    expect(load).toContain(`url.searchParams.get('${name}')`);
  });
});
