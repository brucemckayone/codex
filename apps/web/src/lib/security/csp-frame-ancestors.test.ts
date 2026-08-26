import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SVELTE_CONFIG = resolve(__dirname, '../../../svelte.config.js');

/**
 * Extracts a CSP directive's array literal from the raw svelte.config.js
 * source and returns its (unquoted) entries. Mirrors the regex-parsing
 * approach in csp-svelte-hash.test.ts — the config is a plain ESM module
 * that constructs adapter/preprocess objects at import time, so parsing
 * the source text directly (rather than importing the module) keeps this
 * test independent of those side effects.
 */
function extractDirective(config: string, name: string): string[] | null {
  const match = config.match(
    new RegExp(`['"]${name}['"]\\s*:\\s*\\[([^\\]]*)\\]`, 'm')
  );
  if (!match) return null;

  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * Guard tests for the same-origin iframe CSP relaxation (Codex-cijzb
 * WP-1.2).
 *
 * The brand-editor workspace at /studio/brand embeds the org's own public
 * pages in a same-origin <iframe> for live preview (WP-1.3). That requires
 * two independent things to hold in svelte.config.js `kit.csp.directives`:
 *
 *   1. `frame-ancestors` must include 'self' (not 'none') — the FRAMED
 *      side. This lets a same-origin parent embed this page at all.
 *   2. Something must permit same-origin frame-loading — the FRAMING
 *      side. Either an explicit `frame-src`/`child-src` entry, or (if
 *      neither is declared) a `default-src` that includes 'self', since
 *      frame-src falls back to child-src, then default-src, per the CSP3
 *      spec: https://w3c.github.io/webappsec-csp/#directive-frame-src
 *
 * If either regresses, the /studio/brand live-preview iframe silently
 * breaks (CSP violation → blank iframe) instead of failing loudly here.
 */
describe('CSP: same-origin iframe framing (Codex-cijzb WP-1.2)', () => {
  it("frame-ancestors includes 'self' and not 'none'", () => {
    const config = readFileSync(SVELTE_CONFIG, 'utf-8');
    const frameAncestorsMatch = extractDirective(config, 'frame-ancestors');

    expect(
      frameAncestorsMatch,
      'svelte.config.js kit.csp.directives must declare a frame-ancestors directive'
    ).not.toBeNull();

    const frameAncestors = frameAncestorsMatch ?? [];

    expect(
      frameAncestors,
      "frame-ancestors must include 'self' so the /studio/brand live-preview " +
        'iframe (Codex-cijzb WP-1.3) can embed the same-origin public pages. ' +
        'Without it, browsers block ALL framing, including same-origin.'
    ).toContain('self');

    expect(
      frameAncestors,
      "frame-ancestors must NOT include 'none' — that was the pre-WP-1.2 " +
        'value and blocks same-origin framing entirely.'
    ).not.toContain('none');
  });

  it('a same-origin frame is permitted on the framing side (frame-src falling back to child-src/default-src)', () => {
    const config = readFileSync(SVELTE_CONFIG, 'utf-8');
    const frameSrc = extractDirective(config, 'frame-src');
    const childSrc = extractDirective(config, 'child-src');
    const defaultSrc = extractDirective(config, 'default-src');

    // Per the CSP3 fallback chain, the *effective* frame-loading directive
    // is the first of these that is actually declared.
    const effectiveMatch = frameSrc ?? childSrc ?? defaultSrc;

    expect(
      effectiveMatch,
      'None of frame-src, child-src, or default-src is declared in ' +
        'svelte.config.js — with no fallback left, nothing would permit ' +
        '/studio/brand to load any iframe at all.'
    ).not.toBeNull();

    const effective = effectiveMatch ?? [];

    expect(
      effective,
      'The effective frame-loading directive (frame-src, else child-src, ' +
        "else default-src) must include 'self' so /studio/brand can embed " +
        'a same-origin <iframe> of its own org pages.'
    ).toContain('self');
  });
});
