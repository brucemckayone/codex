// @vitest-environment node
/**
 * The listening card's polite live region (`ListenCard.svelte`,
 * `.listen__status`) is a real box. Safari 16 and older drop a
 * `display: contents` element from the accessibility tree, role and all, so
 * "Loading…" and its notes would never be announced. Its column keeps the
 * card's layout with each later line's own top margin in place of `gap`, so
 * the region, empty most of the time, adds no gap.
 *
 * A SOURCE test, the weaker instrument: it proves the rules, not the paint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentRules } from '../testing';

const PATH = join(import.meta.dirname, 'ListenCard.svelte');
const SOURCE = readFileSync(PATH, 'utf8');
const rules = componentRules(PATH);

/** Every rule whose selector list names `name`, whatever else it names. */
const naming = (name: string) =>
  rules.filter((rule) =>
    rule.selector.split(',').some((part) => part.includes(name))
  );

/** The value each rule for exactly `selector` (in a list or alone) gives `property`. */
const decl = (selector: string, property: string) =>
  rules
    .filter(
      (rule) =>
        rule.selector.split(',').some((part) => part.trim() === selector) &&
        rule.decls.has(property)
    )
    .map((rule) => rule.decls.get(property));

describe('ListenCard: the status region', () => {
  it('is the card’s one role="status", on the class its rules name', () => {
    expect(SOURCE.match(/role="status"/g)).toHaveLength(1);
    expect(SOURCE).toMatch(/<div class="listen__status" role="status">/);
  });

  it('is never display: contents, anywhere it is styled', () => {
    const styled = naming('.listen__status');
    expect(styled.length).toBeGreaterThan(0);
    for (const rule of styled)
      expect(rule.decls.get('display'), rule.selector).not.toBe('contents');
    expect(decl('.listen__status', 'display')).toEqual(['grid']);
  });

  it('adds no gap to its column: the gap is each later line’s margin', () => {
    expect(decl('.listen__text', 'gap')).toEqual([]);
    expect(decl('.listen__text', 'row-gap')).toEqual([]);
    expect(decl('.listen__line', 'margin')).toEqual(['0']);
    expect(decl('.listen__time', 'margin-block-start')).toEqual([
      'var(--space-1)',
    ]);
    expect(decl('.listen__note', 'margin-block-start')).toEqual([
      'var(--space-1)',
    ]);
  });
});
