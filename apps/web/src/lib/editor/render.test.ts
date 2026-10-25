import { describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/observability';
import { renderContentBody } from './render';

vi.mock('$lib/observability', () => ({ logger: { error: vi.fn() } }));

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

// The in-course player emits this output via `{@html}` too (Codex-woj7k), so
// a stored body is a stored-XSS vector on both pages. Markdown passes raw HTML
// through `marked`, so the sanitize pass is the only guard.
describe('renderContentBody sanitises what it renders', () => {
  it('strips a <script> payload from a markdown body', async () => {
    const html = await renderContentBody({
      contentBody: 'ok\n\n<script>alert(1)</script>',
    });
    // Falsifiable: without the sanitize pass the <script> tag survives.
    expect(html).not.toContain('<script');
    expect(html).toContain('ok');
  });

  it('strips an onerror handler from an <img> payload', async () => {
    const html = await renderContentBody({
      contentBody: '<img src="x" onerror="alert(1)">',
    });
    expect(html).not.toContain('onerror');
  });

  it('preserves benign formatting markup', async () => {
    const html = await renderContentBody({ contentBody: 'hello **world**' });
    expect(html).toContain('<strong>world</strong>');
  });
});

describe('renderContentBody failure log (Codex-uuz1g)', () => {
  it('names the content it failed to render', async () => {
    const bad = { type: 'doc', content: [{ type: '__no_such_node__' }] };
    await renderContentBody({ contentBodyJson: bad }, { contentId: 'c_123' });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to render content body',
      expect.objectContaining({ contentId: 'c_123' })
    );
  });
});
