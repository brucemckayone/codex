import { describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/observability';
import { renderContentBody } from './render';

vi.mock('$lib/observability', () => ({ logger: { error: vi.fn() } }));

/**
 * renderContentBody under Node (jsdom): what it renders, what it strips, and
 * that a body it cannot render degrades to null with a log.
 *
 * Node cannot show whether the renderers run in production. workerd lacks
 * APIs Node has, and until Codex-yzxu0 every production render threw while a
 * "window is undefined" test here passed. render-html.workerd.test.ts runs
 * the renderers inside workerd.
 */

const paragraphDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Liberty body' }] },
  ],
};

describe('renderContentBody', () => {
  it('renders a TipTap JSON body to sanitized HTML', async () => {
    const html = await renderContentBody(
      { contentBodyJson: paragraphDoc },
      { contentId: 'c1' }
    );
    expect(html).toContain('Liberty body');
    expect(html).toContain('<p>');
  });

  it('renders legacy markdown when there is no JSON body', async () => {
    const html = await renderContentBody(
      { contentBody: '# Heading' },
      { contentId: 'c1' }
    );
    expect(html).toContain('Heading');
  });

  it('returns null when there is no body at all', async () => {
    expect(await renderContentBody({}, { contentId: 'c1' })).toBeNull();
  });

  it('soft-degrades to null instead of throwing when the doc cannot render', async () => {
    // Unknown node type makes ProseMirror's fromJSON throw; the loader must
    // never 500 because of one malformed body.
    const bad = { type: 'doc', content: [{ type: '__no_such_node__' }] };
    await expect(
      renderContentBody({ contentBodyJson: bad }, { contentId: 'c1' })
    ).resolves.toBeNull();
  });
});

// The in-course player emits this output via `{@html}` too (Codex-woj7k), so
// a stored body is a stored-XSS vector on both pages. Markdown passes raw HTML
// through `marked`, so the sanitize pass is the only guard.
describe('renderContentBody sanitises what it renders', () => {
  it('strips a <script> payload from a markdown body', async () => {
    const html = await renderContentBody(
      { contentBody: 'ok\n\n<script>alert(1)</script>' },
      { contentId: 'c1' }
    );
    // Falsifiable: without the sanitize pass the <script> tag survives.
    expect(html).not.toContain('<script');
    expect(html).toContain('ok');
  });

  it('strips an onerror handler from an <img> payload', async () => {
    const html = await renderContentBody(
      { contentBody: '<img src="x" onerror="alert(1)">' },
      { contentId: 'c1' }
    );
    expect(html).not.toContain('onerror');
  });

  it('preserves benign formatting markup', async () => {
    const html = await renderContentBody(
      { contentBody: 'hello **world**' },
      { contentId: 'c1' }
    );
    expect(html).toContain('<strong>world</strong>');
  });
});

describe('renderContentBody failure log (Codex-uuz1g)', () => {
  it('names the content it failed to render', async () => {
    const bad = { type: 'doc', content: [{ type: '__no_such_node__' }] };
    await renderContentBody(
      { contentBodyJson: bad },
      { contentId: 'c_123', surface: 'course-player' }
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to render content body',
      expect.objectContaining({ contentId: 'c_123', surface: 'course-player' })
    );
  });
});
