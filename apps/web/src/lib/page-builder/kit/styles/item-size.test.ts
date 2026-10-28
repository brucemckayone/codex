// @vitest-environment node
/**
 * The item size (`--lp-size-item`): an item of a list that carries its
 * section, a step above the lead it sits beside and short of a title.
 *
 *   1. It is derived once, on the kit's root, from the lead and the title, so
 *      every Type's own steps flow into it and no sheet restates it.
 *   2. The problem's signs (statement and split), the guide's credentials as
 *      a list and the figures' labels are set in it. A credential drawn as a
 *      chip keeps the body's, and the list layout's signs, already a title
 *      and more, keep theirs.
 *   3. A figure's cell is a query container, so the token's `cqi` read there
 *      would measure the cell: the list reads it against the section into a
 *      registered length, which the labels take. No Style or Type sizes a
 *      label over it.
 *   4. Grid quotes are left at the lead.
 *
 * A SOURCE test, the weaker instrument: it proves the rules, not the paint.
 * Read with svelte's own parser, which drops the comments.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { type CssRule, componentRules, sheetRules } from '../blocks/testing';

const STYLES = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(STYLES);
const ITEM = 'var(--lp-size-item)';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(css|svelte)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );

type Placed = CssRule & { file: string };
const RULES: Placed[] = files(KIT).flatMap((path) =>
  (path.endsWith('.css') ? sheetRules(path) : componentRules(path)).map(
    (rule) => ({ ...rule, file: relative(KIT, path) })
  )
);
const where = (rule: Placed) => `${rule.file}: ${rule.selector}`;
const rulesIn = (file: string) => RULES.filter((rule) => rule.file === file);
const sized = (file: string, selector: string) =>
  rulesIn(file)
    .filter((rule) => rule.selector === selector && rule.within.length === 0)
    .map((rule) => rule.decls.get('font-size'));

/** A component's `@property` registrations, by name. */
function registered(file: string): Map<string, Map<string, string>> {
  type Node = {
    type: string;
    name?: string;
    prelude?: string;
    property?: string;
    value?: string;
    block?: { children: Node[] } | null;
  };
  const source = readFileSync(join(KIT, file), 'utf8');
  const nodes = (parse(source, { modern: true }).css?.children ??
    []) as unknown as Node[];
  return new Map(
    nodes
      .filter((node) => node.type === 'Atrule' && node.name === 'property')
      .map((node) => [
        String(node.prelude).trim(),
        new Map(
          (node.block?.children ?? [])
            .filter((d) => d.type === 'Declaration')
            .map((d) => [d.property ?? '', (d.value ?? '').trim()])
        ),
      ])
  );
}

describe('the item size', () => {
  it('is derived once, on the kit’s root, halfway from the lead to a title', () => {
    const declared = RULES.filter((rule) => rule.decls.has('--lp-size-item'));
    expect(declared.map(where)).toEqual(['styles/kit.css: .lp']);
    expect(declared[0].within).toEqual([]);
    expect(declared[0].decls.get('--lp-size-item')).toBe(
      'calc((var(--lp-size-lead) + var(--lp-size-title)) / 2)'
    );
  });

  it('sets the problem’s signs in it beside the lead, and leaves the list’s larger signs alone', () => {
    const block = 'blocks/problem/ProblemBlock.svelte';
    expect(sized(block, '.problem__strip li')).toEqual([ITEM]);
    expect(sized(block, '.problem__signs li')).toEqual([ITEM]);
    expect(sized(block, '.problem__lines li')).toEqual([
      'var(--lp-size-title)',
    ]);
    // No sheet sizes the signs over the block.
    expect(
      RULES.filter(
        (rule) =>
          rule.file !== block &&
          /\.problem__(strip|signs) li$/.test(rule.selector) &&
          rule.decls.has('font-size')
      ).map(where)
    ).toEqual([]);
  });

  it('sets a credential in it as a list, and as a chip in the body’s', () => {
    const block = 'blocks/instructor/Credentials.svelte';
    expect(sized(block, '.creds')).toEqual(['var(--lp-size-body)']);
    expect(sized(block, ".creds[data-variant='ledger']")).toEqual([ITEM]);
    expect(
      rulesIn(block)
        .filter(
          (rule) =>
            rule.selector.includes("[data-variant='chips']") &&
            rule.decls.has('font-size')
        )
        .map(where)
    ).toEqual([]);
    expect(
      RULES.filter(
        (rule) =>
          rule.file !== block &&
          /\.creds\b/.test(rule.selector) &&
          rule.decls.has('font-size')
      ).map(where)
    ).toEqual([]);
  });

  it('sets a figure’s label in it, read against the section, not its cell', () => {
    const block = 'blocks/stats/StatsBlock.svelte';
    const rules = rulesIn(block);
    const rule = (selector: string) =>
      rules.find((r) => r.selector === selector && r.within.length === 0);
    // The cell is a container; the list is not, so it reads the section.
    expect(rule('.stat')?.decls.get('container-type')).toBe('inline-size');
    expect(rule('.stats__list')?.decls.has('container-type')).toBe(false);
    expect(rule('.stats__list')?.decls.get('--_stat-label')).toBe(ITEM);
    expect(rule('.stat__label')?.decls.get('font-size')).toBe(
      'var(--_stat-label)'
    );
    // Registered as a length, so it is computed where the list declares it.
    expect(
      Object.fromEntries(registered(block).get('--_stat-label') ?? [])
    ).toEqual({
      syntax: "'<length>'",
      inherits: 'true',
      'initial-value': '0px',
    });
  });

  it('is the label’s size in every Style and Type: none sizes it over the block', () => {
    const stray = RULES.filter(
      (rule) =>
        rule.file !== 'blocks/stats/StatsBlock.svelte' &&
        /\.stat__label$/.test(rule.selector) &&
        rule.decls.has('font-size')
    ).map(where);
    expect(stray).toEqual([]);
    // Calibrated: Bold's Type still sets the label's weight and measure.
    expect(
      RULES.filter(
        (rule) =>
          rule.file === 'styles/style-bold.css' &&
          rule.selector ===
            ":is(.lp, #lp-style)[data-lp-type-facet='bold'] .stat__label"
      ).map((rule) => [...rule.decls.keys()])
    ).toEqual([['max-inline-size', 'font-weight', '--lp-measure-unit']]);
  });

  it('leaves a grid quote at the lead', () => {
    const voice = rulesIn('blocks/testimonials/Voice.svelte');
    expect(
      voice
        .find((rule) => rule.selector === '.voice')
        ?.decls.get('--lp-size-quote')
    ).toBe('var(--lp-size-lead)');
    expect(
      voice.filter((rule) => rule.decls.get('--lp-size-quote') === ITEM)
    ).toEqual([]);
  });
});
