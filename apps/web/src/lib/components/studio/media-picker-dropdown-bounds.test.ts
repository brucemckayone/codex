/**
 * MediaPicker's menu must stay INSIDE the viewport (Codex-1g5lh.8, geometry half).
 *
 * WHY THIS IS A SOURCE-TEXT GUARD AND NOT A MEASUREMENT. Two independent walls:
 *
 *   1. Vitest stubs CSS imports by default (`test.css` is unset), and a
 *      `.svelte` file's `<style>` block reaches the browser as one of those
 *      imports — so nothing this component declares is in the document when the
 *      test runs, and `getComputedStyle(list).maxHeight` reads `''` for a fixed
 *      or a broken value alike.
 *   2. jsdom has no layout engine. `clientHeight`, `scrollHeight` and every
 *      `getBoundingClientRect()` field are 0 for every element, so "the list is
 *      shorter than the viewport and scrolls internally" is not a question jsdom
 *      can be asked. A test that measured them would pass on ANY stylesheet,
 *      including none — the exact fake geometry test this file refuses to be.
 *
 * So this asserts the DECLARATIONS instead, scoped to the two rules that carry
 * the fix, and says plainly what it is: a regression pin on the CSS contract,
 * not evidence about pixels. Real geometry — the menu fitting a laptop viewport
 * at 100% zoom — was not verified in this change and is listed as unverified in
 * the PR.
 *
 * WHAT REGRESSES WITHOUT IT. The list previously carried `max-height: 260px`,
 * which bounded the OPTIONS but not the search header + list + library-link
 * footer stack around them, and did not shrink for a short viewport at all. The
 * fix moves the cap onto the wrapper as a `min(…dvh, …rem)` and lets the list
 * flex inside it — which only works while `min-height: 0` is present, because a
 * flex item's default `min-height: auto` refuses to shrink below its content and
 * would silently restore the unbounded stack.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'MediaPicker.svelte'), 'utf8');

/**
 * The body of one CSS rule, so a declaration that lives in a DIFFERENT rule of
 * a 600-line component cannot satisfy an assertion about this one.
 */
function rule(selector: string): string {
  const at = SOURCE.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`MediaPicker no longer declares ${selector}`);
  const close = SOURCE.indexOf('}', at);
  if (close === -1) throw new Error(`${selector} rule is unterminated`);
  return SOURCE.slice(at, close);
}

describe('MediaPicker menu — bounded height, internal scroll', () => {
  it('caps the whole menu against the viewport, not against a row count', () => {
    const dropdown = rule('.picker-dropdown');
    expect(
      dropdown,
      'the menu has no max-height — a long media library makes it overrun the viewport (Codex-1g5lh.8)'
    ).toMatch(/max-height:\s*min\(/);
    // A viewport unit is the load-bearing half: a pure `rem` cap is still taller
    // than a short viewport (a laptop at 150% browser zoom is ~500 CSS px tall).
    expect(
      dropdown,
      'the cap is not viewport-relative, so it cannot adapt to a short viewport or high zoom'
    ).toMatch(/max-height:\s*min\([^)]*d?vh/);
  });

  it('lays the menu out as a column so header and footer can be pinned', () => {
    const dropdown = rule('.picker-dropdown');
    expect(dropdown).toMatch(/display:\s*flex/);
    expect(dropdown).toMatch(/flex-direction:\s*column/);
  });

  it('scrolls the OPTION LIST internally rather than the page', () => {
    const list = rule('.dropdown-list');
    expect(
      list,
      'the option list does not scroll — overflow escapes the menu and takes the page scroll with it'
    ).toMatch(/overflow-y:\s*auto/);
    expect(
      list,
      "the list is missing `min-height: 0` — a flex item's default `min-height: auto` refuses to shrink below its content, so the wrapper's max-height is ignored and the menu grows to fit every option again"
    ).toMatch(/min-height:\s*0/);
  });

  it('does not chain a flick past the last option into the page behind it', () => {
    expect(rule('.dropdown-list')).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('pins the search header and library-link footer', () => {
    // Without these the two chrome rows shrink alongside the list when the cap
    // engages, and the "Go to media library" escape hatch collapses to nothing.
    expect(rule('.dropdown-search')).toMatch(/flex-shrink:\s*0/);
    expect(rule('.dropdown-footer')).toMatch(/flex-shrink:\s*0/);
  });

  it('keeps the height cap free of raw px', () => {
    // Repo rule: no hardcoded CSS values. The previous `max-height: 260px` was
    // the one px literal in this component's layout; `rem`/`dvh` scale with the
    // user's font size and viewport, a px cap does neither.
    const dropdown = rule('.picker-dropdown');
    const list = rule('.dropdown-list');
    expect(dropdown).not.toMatch(/max-height:[^;]*px/);
    expect(list).not.toMatch(/max-height:[^;]*px/);
  });
});
