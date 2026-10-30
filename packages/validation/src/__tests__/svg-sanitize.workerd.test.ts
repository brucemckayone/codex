/**
 * sanitizeSvgContent inside workerd, where the API workers run it
 * (Codex-kcr87).
 *
 * The other tests here run under Node, which has APIs workerd lacks. Until
 * 2026-10 they all passed while every SVG logo upload threw in production:
 * this package's build bundled DOMPurify's browser copy, which has no
 * sanitize() without a window ("(intermediate value).default.sanitize is not
 * a function").
 *
 * wrangler bundles the test Worker as a worker deploy does, with the
 * compatibility date and flags organization-api (which sanitises org logos)
 * runs with.
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
  const runsIt = unstable_readConfig({
    config: here('../../../../workers/organization-api/wrangler.jsonc'),
  });
  worker = await unstable_dev(here('./__workerd__/svg-sanitize-entry.ts'), {
    config: here('./__workerd__/wrangler.jsonc'),
    compatibilityDate: runsIt.compatibility_date,
    compatibilityFlags: runsIt.compatibility_flags,
    local: true,
    logLevel: 'none',
    experimental: { disableExperimentalWarning: true },
  });
}, 60_000);

afterAll(async () => {
  await worker?.stop();
});

interface Sanitized {
  svg?: string;
  errorName?: string;
  error?: string;
}

async function sanitize(svg: string): Promise<Sanitized> {
  if (!worker) throw new Error('The workerd test Worker did not start');
  const response = await worker.fetch('http://sanitize.test/', {
    method: 'POST',
    body: svg,
  });
  return (await response.json()) as Sanitized;
}

/** As Illustrator exports a logo: coloured by a stylesheet of class rules. */
const ILLUSTRATOR_LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 40">
  <defs>
    <style>.cls-1{fill:#e30613;}.cls-2{fill:url(#grad);stroke:#000;stroke-width:2px;}</style>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#00f"/>
    </linearGradient>
  </defs>
  <path class="cls-1" d="M0 0h40v40H0z"/>
  <circle class="cls-2" cx="70" cy="20" r="15"/>
  <text x="5" y="35" style="font-family:Inter;font-size:8px;fill:#333">Brand</text>
</svg>`;

const ATTACKS = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <script type="text/ecmascript"><![CDATA[alert(3)]]></script>
  <a href="javascript:alert(4)"><rect width="5" height="5"/></a>
  <use href="https://evil.example/x.svg#a"/>
  <use xlink:href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>
  <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
  <image href="https://evil.example/p.png"/>
  <rect width="10" height="10" fill="url(https://evil.example/t.svg#p)" onclick="alert(5)" style="background:url(javascript:alert(6))"/>
  <animate attributeName="href" to="javascript:alert(7)"/>
  <set attributeName="onmouseover" to="alert(8)"/>
  <style>@import url(https://evil.example/x.css);</style>
  <circle cx="5" cy="5" r="2" fill="#0f0"/>
</svg>`;

describe('sanitizeSvgContent on workerd', () => {
  it("keeps an Illustrator logo's colours, moved off its stylesheet", async () => {
    const { svg, error } = await sanitize(ILLUSTRATOR_LOGO);

    expect(error).toBeUndefined();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox="0 0 100 40"');
    expect(svg).toMatch(/<path [^>]*fill="#e30613"/);
    expect(svg).toMatch(/<circle [^>]*fill="url\(#grad\)"/);
    expect(svg).toMatch(/<circle [^>]*stroke="#000"/);
    expect(svg).toContain('<linearGradient id="grad"');
    expect(svg).toMatch(/<text [^>]*font-family="Inter"[^>]*>Brand<\/text>/);
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('class=');
    expect(svg).not.toContain('style=');
  });

  it('drops every script, handler, outside reference and embed', async () => {
    const { svg, error } = await sanitize(ATTACKS);

    expect(error).toBeUndefined();
    for (const unsafe of [
      '<script',
      'alert(',
      'onload',
      'onclick',
      'javascript:',
      'data:',
      'evil.example',
      'foreignObject',
      '<iframe',
      '<image',
      '<a ',
      '<animate',
      '<set',
      '@import',
      'style=',
    ]) {
      expect(svg).not.toContain(unsafe);
    }
    // What was safe to draw is still drawn.
    expect(svg).toMatch(/<circle [^>]*fill="#0f0"/);
  });

  it('gives a file without the SVG namespace one, so it renders as an image', async () => {
    const { svg, error } = await sanitize(
      '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'
    );

    expect(error).toBeUndefined();
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  // A ZodError is answered 422, as the uploader's to fix (mapErrorToResponse).
  it('refuses markup with nothing of an <svg> left in it, as a validation error', async () => {
    const { errorName, error } = await sanitize(
      '<script>alert("XSS")</script>'
    );

    expect(errorName).toBe('ZodError');
    expect(error).toContain('empty content');
  });

  it('refuses markup it cannot parse, as a validation error', async () => {
    const { errorName, error } = await sanitize('<svg><rect></svg>');

    expect(errorName).toBe('ZodError');
    expect(error).toContain('not valid SVG markup');
  });
});
