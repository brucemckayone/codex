/**
 * The rules that keep every dialog on the screen, read from the source.
 *
 * jsdom applies no component CSS and CI runs no browser against Storybook,
 * so without this a revert of any of them stayed green (Codex-vlphc review
 * G4-L4): the clamp on a `maxHeight` and its fallback (707596f49,
 * 1a911de74), each placement's cap and room, the vh fallback for an engine
 * without dvh (e907b41e4), the Body-less panel that scrolls as a whole
 * (70b5d8079), and the Toolbar's cap (71d4e7d72, af38511d0). What they do
 * on screen was measured in Chromium and WebKit; this pins that they are
 * there. Read with svelte's own parser, which drops the comments.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

type CssNode = {
  type: string;
  name?: string;
  property?: string;
  value?: string;
  prelude?: { start: number; end: number } | string;
  block?: { children: CssNode[] } | null;
};

type Rule = {
  /** The selector, every space removed. */
  selector: string;
  /** The at-rules around it, outermost first, every space removed. */
  within: string[];
  /** Each property's values, in source order. */
  decls: Map<string, string[]>;
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const bare = (s: string) => s.replace(/\s+/g, '');

function rulesOf(file: string): Rule[] {
  const source = readFileSync(join(import.meta.dirname, file), 'utf8');
  const css = parse(source, { modern: true }).css;
  const rules: Rule[] = [];
  const visit = (children: CssNode[], within: string[]) => {
    for (const node of children) {
      if (node.type === 'Rule' && typeof node.prelude === 'object') {
        const decls = new Map<string, string[]>();
        for (const d of node.block?.children ?? [])
          if (d.type === 'Declaration')
            decls.set(d.property ?? '', [
              ...(decls.get(d.property ?? '') ?? []),
              squash(d.value ?? ''),
            ]);
        rules.push({
          selector: bare(source.slice(node.prelude.start, node.prelude.end)),
          within,
          decls,
        });
        visit(node.block?.children ?? [], within);
      } else if (node.type === 'Atrule') {
        visit(node.block?.children ?? [], [
          ...within,
          bare(
            `@${node.name}${typeof node.prelude === 'string' ? node.prelude : ''}`
          ),
        ]);
      }
    }
  };
  visit((css?.children ?? []) as unknown as CssNode[], []);
  return rules;
}

const content = rulesOf('DialogContent.svelte');
const toolbar = rulesOf('DialogToolbar.svelte');

/** The one value `property` takes in the one rule for `selector` (inside `within`). */
function value(
  rules: Rule[],
  selector: string,
  property: string,
  within: string[] = []
): string | undefined {
  const matching = rules.filter(
    (r) => r.selector === bare(selector) && r.within.join() === within.join()
  );
  // Of two rules with one selector the later wins the cascade: reading
  // the first would pass over what the browser applies.
  expect(matching.length, `rules for ${selector}`).toBeLessThanOrEqual(1);
  const values = matching[0]?.decls.get(property);
  return values?.length === 1 ? values[0] : undefined;
}

const PHONE = ['@media(--below-sm)'];

describe("DialogContent's caps", () => {
  it('clamps a maxHeight to the room, and falls back to the default cap', () => {
    expect(value(content, '.dialog-content', '--dialog-max')).toBe(
      'min(var(--dialog-max-height, var(--dialog-default-max)), var(--dialog-room))'
    );
    expect(value(content, '.dialog-content', 'max-height')).toBe(
      'var(--dialog-default-max)'
    );
  });

  // [selector, at-rules, default cap, room]; undefined: not set there.
  const placements: [
    string,
    string[],
    string | undefined,
    string | undefined,
  ][] = [
    [
      '.dialog-content',
      [],
      'calc(85 * var(--dialog-dvh))',
      'calc(100 * var(--dialog-dvh) - 2 * var(--space-4))',
    ],
    [
      ".dialog-content[data-placement='top'], .dialog-content[data-placement='bottom']",
      [],
      'calc(70 * var(--dialog-dvh))',
      undefined,
    ],
    [
      ".dialog-content[data-placement='top']",
      [],
      undefined,
      'calc(100 * var(--dialog-dvh) - 15vh - var(--space-4))',
    ],
    [
      ".dialog-content[data-placement='bottom']",
      [],
      undefined,
      'calc(100 * var(--dialog-dvh) - 2 * var(--space-2))',
    ],
    [
      ".dialog-content[data-variant='drawer']",
      [],
      'calc(100 * var(--dialog-dvh))',
      'calc(100 * var(--dialog-dvh))',
    ],
    [
      ".dialog-content[data-variant='drawer'][data-floating]",
      [],
      'calc(100 * var(--dialog-dvh) - var(--space-6))',
      'calc(100 * var(--dialog-dvh) - var(--space-6))',
    ],
    [
      ".dialog-content[data-variant='drawer'][data-sheet]",
      PHONE,
      'calc(90 * var(--dialog-dvh))',
      undefined,
    ],
    [
      ".dialog-content[data-variant='drawer'][data-sheet][data-floating]",
      PHONE,
      'calc(85 * var(--dialog-dvh))',
      'calc(100 * var(--dialog-dvh) - var(--space-2))',
    ],
  ];
  it.each(
    placements
  )('%s has its cap and its room, in --dialog-dvh', (selector, within, cap, room) => {
    expect(value(content, selector, '--dialog-default-max', within)).toBe(cap);
    expect(value(content, selector, '--dialog-room', within)).toBe(room);
  });

  // A cap property set anywhere else overrides a row above with every row
  // still green: a later `.dialog-content { max-height: none }`, or
  // `--dialog-default-max: none` on a size (review G5-C-L4). So the rules
  // that set one are exactly these, each setting exactly these.
  it('sets a cap only in the rules above, each once', () => {
    const CAPS = [
      'max-height',
      '--dialog-max',
      '--dialog-default-max',
      '--dialog-room',
      '--dialog-dvh',
    ];
    const key = (selector: string, within: string[]) =>
      [bare(selector), ...within].join(' ');
    const found = content
      .map((r) => ({
        rule: key(r.selector, r.within),
        sets: CAPS.filter((p) => r.decls.has(p)),
      }))
      .filter((r) => r.sets.length > 0);
    const expected = [
      { rule: key('.dialog-content', []), sets: CAPS },
      {
        rule: key('.dialog-content', ['@supportsnot(height:1dvh)']),
        sets: ['--dialog-dvh'],
      },
      ...placements
        .filter(([selector]) => selector !== '.dialog-content')
        .map(([selector, within, cap, room]) => ({
          rule: key(selector, within),
          sets: CAPS.filter(
            (p) =>
              (p === '--dialog-default-max' && cap) ||
              (p === '--dialog-room' && room)
          ),
        })),
    ];
    const order = (a: { rule: string }, b: { rule: string }) =>
      a.rule.localeCompare(b.rule);
    expect(found.sort(order)).toEqual(expected.sort(order));
  });

  it('takes vh where an engine has no dvh', () => {
    expect(value(content, '.dialog-content', '--dialog-dvh')).toBe('1dvh');
    expect(
      value(content, '.dialog-content', '--dialog-dvh', [
        '@supportsnot(height:1dvh)',
      ])
    ).toBe('1vh');
  });

  it('scrolls a clipping panel with no Body as a whole', () => {
    expect(
      value(
        content,
        ".dialog-content:is([data-variant='dialog'], [data-floating]):not(:has(> :global(.dialog-body), > :global(.dialog-form) > :global(.dialog-body)))",
        'overflow-y'
      )
    ).toBe('auto');
  });
});

describe("DialogToolbar's cap", () => {
  const CAPPED = ".dialog-toolbar:not([data-flush], [data-layout='drawer'])";
  const rule = toolbar.find((r) => r.selector === bare(CAPPED));

  // Row and column both: the rule names no direction.
  it('caps a stacked and a wrapped bar alike, at a third of the screen', () => {
    expect(rule?.within).toEqual([]);
    expect(rule?.decls.get('max-height')).toEqual(['33vh', '33dvh']);
    expect(rule?.decls.get('overflow-y')).toEqual(['auto']);
    expect(rule?.decls.get('overscroll-behavior-y')).toEqual(['contain']);
  });

  // A scroller clips at its padding box: the band it is pulled up into is
  // exactly a focus ring's reach, so a field's ring at the top still shows
  // (review G4-U-N1).
  it('pulls the bar up into a band the focus ring fits', () => {
    expect(rule?.decls.get('--toolbar-ring')).toEqual([
      'calc(var(--border-width-thick) + var(--space-0-5))',
    ]);
    expect(rule?.decls.get('margin-top')).toEqual([
      'calc(-1 * var(--toolbar-ring))',
    ]);
    expect(rule?.decls.get('padding-top')).toEqual(['var(--toolbar-ring)']);
  });

  it('is the only rule that caps the bar', () => {
    const capped = toolbar.filter((r) => r.decls.has('max-height'));
    expect(capped.map((r) => r.selector)).toEqual([bare(CAPPED)]);
  });
});
