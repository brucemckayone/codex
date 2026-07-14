import { describe, expect, it } from 'vitest';
import { renderContentBody } from './render';

/**
 * Guards the prod 500 on /content/liberty (Codex-eb00a.2): the content-detail
 * SSR load renders TipTap JSON bodies via `generateHTML`, which must come from
 * `@tiptap/html/server` — the browser `@tiptap/html` build throws when `window`
 * is undefined (Cloudflare Workers / workerd), 500-ing the whole page.
 *
 * These run under jsdom (where `window` exists), so the "no-window" test below
 * simulates workerd explicitly — that is the only case that distinguishes the
 * browser build from the server build here.
 */

const paragraphDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Liberty body' }] },
  ],
};

describe('renderContentBody', () => {
  it('renders a TipTap JSON body to sanitized HTML', async () => {
    const html = await renderContentBody({ contentBodyJson: paragraphDoc });
    expect(html).toContain('Liberty body');
    expect(html).toContain('<p>');
  });

  it('renders legacy markdown when there is no JSON body', async () => {
    const html = await renderContentBody({ contentBody: '# Heading' });
    expect(html).toContain('Heading');
  });

  it('returns null when there is no body at all', async () => {
    expect(await renderContentBody({})).toBeNull();
  });

  it('soft-degrades to null instead of throwing when the doc cannot render', async () => {
    // Unknown node type makes ProseMirror's fromJSON throw; the loader must
    // never 500 because of one malformed body.
    const bad = { type: 'doc', content: [{ type: '__no_such_node__' }] };
    await expect(
      renderContentBody({ contentBodyJson: bad })
    ).resolves.toBeNull();
  });

  it('renders even when global window is undefined (workerd SSR)', async () => {
    // Reproduces the prod condition: the browser @tiptap/html build throws on
    // `typeof window === "undefined"`; the /server build does not. If this
    // returns null, the browser import has regressed (throw → degrade → null).
    const g = globalThis as unknown as { window?: unknown };
    const saved = g.window;
    g.window = undefined;
    try {
      const html = await renderContentBody({ contentBodyJson: paragraphDoc });
      expect(html).toContain('Liberty body');
    } finally {
      g.window = saved;
    }
  });
});
