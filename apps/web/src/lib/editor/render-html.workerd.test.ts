// @vitest-environment node
/**
 * render-html.ts inside workerd, the runtime production SSR uses (Codex-yzxu0).
 *
 * Vite runs SSR in Node, which has every API workerd lacks, so a renderer can
 * pass every other test here and still fail on each production page. Until
 * 2026-10, two did, and no stored body showed on any content page:
 * - TipTap's server renderer built a happy-dom window, which needs node:vm.
 *   On workerd that is unenv's stub, which throws "Script.runInContext is not
 *   implemented yet!".
 * - isomorphic-dompurify needs a DOM to sanitise with. On workerd it resolves
 *   to plain DOMPurify, which then has no sanitize().
 *
 * wrangler bundles the test Worker as the deploy bundles the web app, and it
 * runs with the compatibility date and flags apps/web/wrangler.jsonc gives
 * production.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Unstable_DevWorker,
  unstable_dev,
  unstable_readConfig,
} from 'wrangler';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

let worker: Unstable_DevWorker | undefined;

beforeAll(async () => {
  const web = unstable_readConfig({ config: here('../../../wrangler.jsonc') });
  worker = await unstable_dev(here('./__workerd__/render-html-entry.ts'), {
    config: here('./__workerd__/wrangler.jsonc'),
    compatibilityDate: web.compatibility_date,
    compatibilityFlags: web.compatibility_flags,
    local: true,
    logLevel: 'none',
    experimental: { disableExperimentalWarning: true },
  });
}, 60_000);

afterAll(async () => {
  await worker?.stop();
});

interface Rendered {
  html?: string | null;
  error?: string;
}

async function render(body: {
  contentBodyJson?: Record<string, unknown>;
  contentBody?: string;
}): Promise<Rendered> {
  if (!worker) throw new Error('The workerd test Worker did not start');
  const response = await worker.fetch('http://render.test/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return (await response.json()) as Rendered;
}

const text = (value: string, marks?: Record<string, unknown>[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const link = (href: string) => [{ type: 'link', attrs: { href } }];

describe('render-html on workerd', () => {
  it('renders a TipTap body', async () => {
    const { html, error } = await render({
      contentBodyJson: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [text('Title')],
          },
          {
            type: 'paragraph',
            content: [
              text('Hello '),
              text('bold', [{ type: 'bold' }]),
              text(' and '),
              text('a link', link('https://example.com')),
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [text('item')] }],
              },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'js' },
            content: [text('a < b')],
          },
        ],
      },
    });

    expect(error).toBeUndefined();
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('<li><p>item</p></li>');
    expect(html).toContain('<code class="language-js">a &lt; b</code>');
  });

  it('escapes TipTap text and drops a javascript: link', async () => {
    const { html, error } = await render({
      contentBodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              text('<script>alert(1)</script>'),
              text('click', link('javascript:alert(1)')),
            ],
          },
        ],
      },
    });

    expect(error).toBeUndefined();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).toContain('click');
    expect(html).not.toMatch(/href="\s*javascript:/i);
  });

  it('renders a markdown body and strips what is unsafe in it', async () => {
    const { html, error } = await render({
      contentBody: [
        '# Heading',
        '',
        '**bold** [ok](https://example.com) [bad](javascript:alert(1))',
        '',
        '<script>alert(1)</script><img src="x" onerror="alert(1)">',
      ].join('\n'),
    });

    expect(error).toBeUndefined();
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toMatch(/href="\s*javascript:/i);
  });

  it('answers null when nothing is stored', async () => {
    expect(await render({})).toEqual({ html: null });
  });
});
