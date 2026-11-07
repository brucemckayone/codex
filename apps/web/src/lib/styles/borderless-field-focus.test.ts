// @vitest-environment node
/**
 * A field drawn without a border keeps a focus cue that holds 3:1
 * (Codex-c5prp).
 *
 * base.css gives every input two focus cues: its border turns
 * --color-border-focus, and a 3px halo in --color-focus-ring. A field whose
 * component takes the border away keeps only the halo, which the platform's
 * tokens leave at 1.46:1 in light and 1.92:1 in dark, under the 3:1 a focus
 * indicator needs. Both command palettes, the font picker's search and the
 * curriculum's library picker shipped that way.
 *
 * jsdom paints nothing, so the gate reads the components, with svelte's own
 * parser (as reduced-motion.test.ts does). Every text field a component
 * draws borderless must sit in a box marked `data-field-box`, whose border
 * base.css turns --color-border-focus, or the component must draw its own
 * ring for it (an outline on focus), or its own border in a focus token.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseCss } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const STYLES = dirname(fileURLToPath(import.meta.url));
const SRC = dirname(dirname(STYLES));

/** Inputs that take no text, so draw no field. */
const NOT_A_FIELD = new Set([
  'hidden',
  'file',
  'checkbox',
  'radio',
  'range',
  'color',
  'submit',
  'button',
  'image',
  'reset',
]);
const FOCUS = new Set(['focus', 'focus-visible', 'focus-within']);
const FOCUS_TOKEN = /var\(--color-(border-)?focus\)/;

// ── The svelte AST, as far as this gate reads it ──────────────────────────

type Node = { type: string; [key: string]: unknown };
type Attr = { type: string; name?: string; value?: true | Node[] | Node };
type Simple = {
  type: string;
  name?: string;
  args?: { children: Complex[] } | null;
};
type Relative = { type: 'RelativeSelector'; selectors: Simple[] };
type Complex = { type: 'ComplexSelector'; children: Relative[] };
type CssRule = {
  type: string;
  prelude?: { children: Complex[] } | string;
  block?: { children: CssRule[] } | null;
  property?: string;
  value?: string;
};

interface Element {
  name: string;
  classes: Set<string>;
  attrs: Map<string, string | true>;
}
interface Compound {
  tag?: string;
  classes: string[];
  focus: boolean;
}
interface Declared {
  /** Outermost compound first; the last is the element the rule styles. */
  compounds: Compound[];
  property: string;
  value: string;
}

function element(node: Node): Element {
  const classes = new Set<string>();
  const attrs = new Map<string, string | true>();
  for (const a of (node.attributes ?? []) as Attr[]) {
    if (a.type === 'ClassDirective' && a.name) classes.add(a.name);
    if (a.type !== 'Attribute' || !a.name) continue;
    if (a.value === true) {
      attrs.set(a.name, true);
      continue;
    }
    const parts = Array.isArray(a.value) ? a.value : [a.value];
    const text = parts
      .map((p) => (p?.type === 'Text' ? String(p.data) : ' '))
      .join('');
    // A dynamic part reads as a space: the static words still count.
    attrs.set(
      a.name,
      parts.every((p) => p?.type === 'Text') ? text : `${text}\u0000`
    );
    if (a.name === 'class')
      for (const c of text.split(/\s+/)) if (c) classes.add(c);
  }
  return { name: String(node.name), classes, attrs };
}

/** Each field in the markup with the elements around it, nearest last. */
function fields(fragment: Node): { field: Element; around: Element[] }[] {
  const snippets = new Map<string, Node>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      const node = value as Node;
      if (node.type === 'SnippetBlock')
        snippets.set(String((node.expression as Node).name), node.body as Node);
      for (const key of Object.keys(node))
        if (key !== 'metadata') collect(node[key]);
    }
  };
  collect(fragment);

  const out: { field: Element; around: Element[] }[] = [];
  const rendered = new Set<string>();
  const walk = (value: unknown, around: Element[], seen: string[]): void => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v, around, seen);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    // A snippet is read where it is rendered, inside what renders it.
    if (node.type === 'SnippetBlock') return;
    if (node.type === 'RenderTag') {
      const callee = ((node.expression as Node).callee ??
        (node.expression as Node).expression) as Node | undefined;
      const name = callee?.type === 'Identifier' ? String(callee.name) : '';
      const body = snippets.get(name);
      if (body && !seen.includes(name)) {
        rendered.add(name);
        walk(body, around, [...seen, name]);
      }
      return;
    }
    if (node.type === 'RegularElement') {
      const el = element(node);
      if (['input', 'textarea', 'select'].includes(el.name))
        out.push({ field: el, around });
      walk(node.fragment, [...around, el], seen);
      return;
    }
    for (const key of Object.keys(node))
      if (key !== 'metadata') walk(node[key], around, seen);
  };
  walk(fragment, [], []);
  // A snippet handed to another component is drawn inside that component.
  for (const [name, body] of snippets)
    if (!rendered.has(name)) walk(body, [], [name]);
  return out;
}

function compounds(complex: Complex): Compound[] {
  const out: Compound[] = [];
  for (const rel of complex.children) {
    const global = rel.selectors.find(
      (s) => s.type === 'PseudoClassSelector' && s.name === 'global' && s.args
    );
    if (global?.args) {
      out.push(...compounds(global.args.children[0]));
      continue;
    }
    const c: Compound = { classes: [], focus: false };
    for (const s of rel.selectors) {
      if (s.type === 'TypeSelector' && s.name !== '*') c.tag = s.name;
      if (s.type === 'ClassSelector' && s.name) c.classes.push(s.name);
      if (s.type === 'PseudoClassSelector' && s.name && FOCUS.has(s.name))
        c.focus = true;
      if (s.type === 'NestingSelector') c.classes.push('&');
    }
    out.push(c);
  }
  return out;
}

function declarations(
  rules: CssRule[],
  parents: Compound[][] = [[]]
): Declared[] {
  const out: Declared[] = [];
  for (const rule of rules) {
    if (rule.type === 'Atrule') {
      out.push(...declarations(rule.block?.children ?? [], parents));
      continue;
    }
    if (
      rule.type !== 'Rule' ||
      typeof rule.prelude !== 'object' ||
      !rule.prelude
    )
      continue;
    const own = rule.prelude.children.map(compounds);
    const joined = parents.flatMap((parent) =>
      own.map((list) => {
        if (!parent.length) return list;
        const [first, ...rest] = list;
        if (!first?.classes.includes('&')) return [...parent, ...list];
        const last = parent[parent.length - 1];
        const merged: Compound = {
          tag: first.tag ?? last.tag,
          classes: [...last.classes, ...first.classes.filter((c) => c !== '&')],
          focus: last.focus || first.focus,
        };
        return [...parent.slice(0, -1), merged, ...rest];
      })
    );
    for (const child of rule.block?.children ?? []) {
      if (child.type === 'Declaration')
        for (const list of joined)
          out.push({
            compounds: list,
            property: child.property ?? '',
            value: (child.value ?? '').replace(/\s+/g, ' ').trim(),
          });
      else out.push(...declarations([child], joined));
    }
  }
  return out;
}

function matches(c: Compound, el: Element): boolean {
  if (c.tag && c.tag !== el.name) return false;
  if (!c.tag && !c.classes.length) return false;
  return c.classes.every((name) => el.classes.has(name));
}

/**
 * The element `chain` ends at, if the rule styles it: its last compound
 * matches that element and the rest match elements around it, in order.
 * A compound naming neither tag nor class (`[data-theme]`) cannot be checked
 * here and is taken as met.
 */
function styles(d: Declared, chain: Element[]): boolean {
  const target = chain[chain.length - 1];
  const subject = d.compounds[d.compounds.length - 1];
  if (!subject || !matches(subject, target)) return false;
  let i = chain.length - 2;
  for (let k = d.compounds.length - 2; k >= 0; k--) {
    const c = d.compounds[k];
    if (!c.tag && !c.classes.length) continue;
    while (i >= 0 && !matches(c, chain[i])) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

const BORDERLESS = (d: Declared): boolean =>
  ((d.property === 'border' || d.property === 'border-width') &&
    /^(none|0(px)?)(\s|$)/.test(d.value)) ||
  (d.property === 'border' && /\btransparent\b/.test(d.value)) ||
  (d.property === 'border-style' && /^none\b/.test(d.value));

/** A cue the component draws itself, on the field or a box around it. */
const OWN_CUE = (d: Declared): boolean =>
  (d.compounds[d.compounds.length - 1]?.focus ?? false) &&
  ((/^outline(-style|-color)?$/.test(d.property) &&
    !/^(none|0(px)?)\b/.test(d.value)) ||
    (/^border(-[a-z]+)?(-color)?$/.test(d.property) &&
      FOCUS_TOKEN.test(d.value)));

/**
 * A rule that draws a border on the element it styles, on some side: what
 * base.css's `[data-field-box]` rule can colour. A border set to none, 0,
 * hidden or transparent draws nothing to colour.
 */
const DRAWS_BORDER = (d: Declared): boolean =>
  /^border(-(top|right|bottom|left)|-(block|inline)(-(start|end))?)?$/.test(
    d.property
  ) &&
  !/^(none|0(px)?|hidden)(\s|$)/.test(d.value) &&
  !/\btransparent\b/.test(d.value);

type Cue = 'box' | 'own' | 'none';

/** Every borderless text field in one component, and the cue it keeps. */
function census(source: string): { field: string; cue: Cue }[] {
  const ast = parse(source, { modern: true }) as unknown as {
    fragment: Node;
    css: { children: CssRule[] } | null;
  };
  const css = declarations(ast.css?.children ?? []);
  const out: { field: string; cue: Cue }[] = [];
  for (const { field, around } of fields(ast.fragment)) {
    const type = field.attrs.get('type');
    if (typeof type === 'string' && NOT_A_FIELD.has(type)) continue;
    // Not a tab stop: the visible control that forwards to it holds focus.
    if (field.attrs.get('tabindex') === '-1') continue;
    const chain = [...around, field];
    if (!css.some((d) => BORDERLESS(d) && styles(d, chain))) continue;
    const boxes = chain.map((_, i) => chain.slice(0, i + 1));
    // base.css's rule is `[data-field-box]:has(… :focus)`: it reaches a box
    // AROUND the field, never the field itself, and only colours a border
    // that box draws.
    const box = around.some(
      (el, i) =>
        el.attrs.has('data-field-box') &&
        css.some((d) => DRAWS_BORDER(d) && styles(d, around.slice(0, i + 1)))
    );
    out.push({
      field: `<${field.name} class="${[...field.classes].join(' ')}">`,
      cue: box
        ? 'box'
        : css.some((d) => OWN_CUE(d) && boxes.some((c) => styles(d, c)))
          ? 'own'
          : 'none',
    });
  }
  return out;
}

/** The borderless fields in one component left with only the halo. */
function uncued(source: string): string[] {
  return census(source)
    .filter((f) => f.cue === 'none')
    .map((f) => f.field);
}

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return components(path);
    // Stories and test harnesses ship no field.
    return entry.name.endsWith('.svelte') &&
      !/\.(stories|test)\.svelte$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('the gate reads a component as the browser draws it', () => {
  const style = `<style>
    .row { border-bottom: 1px solid var(--color-border); }
    .field { border: none; outline: none; }
  </style>`;

  it('finds a borderless field left with only the halo', () => {
    expect(
      uncued(`<div class="row"><input class="field" /></div>${style}`)
    ).toEqual(['<input class="field">']);
  });

  it('passes it in a box marked data-field-box', () => {
    expect(
      uncued(
        `<div class="row" data-field-box><input class="field" /></div>${style}`
      )
    ).toEqual([]);
  });

  it('does not pass a mark the base.css rule cannot reach or colour', () => {
    // On the field itself: `:has()` only matches a box around it.
    expect(
      uncued(
        `<div class="row"><input class="field" data-field-box /></div>${style}`
      )
    ).toEqual(['<input class="field">']);
    // On a box around it that draws no border.
    expect(
      uncued(
        `<section data-field-box><div class="row"><input class="field" /></div></section>${style}`
      )
    ).toEqual(['<input class="field">']);
    // On a box whose border is turned off.
    expect(
      uncued(
        `<div class="row" data-field-box><input class="field" /></div>${style.replace('.row { border-bottom: 1px solid var(--color-border); }', '.row { border: none; }')}`
      )
    ).toEqual(['<input class="field">']);
  });

  it('follows a snippet to where it is rendered', () => {
    const source = `{#snippet body()}<input class="field" />{/snippet}
      <label class="row" data-field-box>{@render body()}</label>${style}`;
    expect(uncued(source)).toEqual([]);
    expect(uncued(source.replace(' data-field-box', ''))).toEqual([
      '<input class="field">',
    ]);
  });

  it('passes a component that draws its own ring, on the field or around it', () => {
    const ring = `.row:focus-within { outline: 2px solid var(--color-focus); }`;
    expect(
      uncued(
        `<div class="row"><input class="field" /></div>${style.replace('</style>', `${ring}</style>`)}`
      )
    ).toEqual([]);
    const own = `.field:focus-visible { outline: 2px solid var(--color-text); }`;
    expect(
      uncued(
        `<div class="row"><input class="field" /></div>${style.replace('</style>', `${own}</style>`)}`
      )
    ).toEqual([]);
  });

  it('passes its own border cue only in a focus token', () => {
    const cue = (token: string) =>
      `<div class="row"><input class="field" /></div>${style.replace('</style>', `.row:focus-within { border-color: var(${token}); }</style>`)}`;
    expect(uncued(cue('--color-border-focus'))).toEqual([]);
    expect(uncued(cue('--color-focus'))).toEqual([]);
    // The brand's colour as picked holds 3:1 only where the brand does.
    expect(uncued(cue('--color-interactive'))).toEqual([
      '<input class="field">',
    ]);
  });

  it('does not count an outline turned off as a ring', () => {
    const off = `.row input:focus-visible { outline: none; }`;
    expect(
      uncued(
        `<div class="row"><input class="field" /></div>${style.replace('</style>', `${off}</style>`)}`
      )
    ).toEqual(['<input class="field">']);
  });

  it('reads a rule on the field through the box around it', () => {
    const source = `<div class="row"><input /></div><input /><style>.row input { border: 0; }</style>`;
    expect(uncued(source)).toEqual(['<input class="">']);
  });

  it('leaves a bordered field, a hidden input and a field that is not a tab stop alone', () => {
    expect(uncued(`<input class="other" />${style}`)).toEqual([]);
    expect(uncued(`<input type="file" class="field" />${style}`)).toEqual([]);
    expect(uncued(`<input class="field" tabindex="-1" />${style}`)).toEqual([]);
  });
});

describe('every borderless field keeps a focus cue that holds 3:1 (Codex-c5prp)', () => {
  const found = components(SRC).map((path) => {
    const source = readFileSync(path, 'utf8');
    return { file: relative(SRC, path), source, fields: census(source) };
  });
  const cues = (file: string) =>
    found.find((f) => f.file === file)?.fields.map((f) => f.cue);

  it('base.css turns the border of a [data-field-box] the focus colour', () => {
    const source = readFileSync(join(STYLES, 'base.css'), 'utf8');
    type Located = CssRule & { prelude: { start: number; end: number } };
    const rules = (parseCss(source).children as unknown as Located[]).filter(
      (r) =>
        r.type === 'Rule' &&
        source
          .slice(r.prelude.start, r.prelude.end)
          .startsWith('[data-field-box]')
    );
    expect(rules).toHaveLength(1);
    // `:has(… :focus)`: `:focus-within` would only tie a box's scoped resting border.
    expect(source.slice(rules[0].prelude.start, rules[0].prelude.end)).toBe(
      '[data-field-box]:has(:is(input, textarea, select):focus)'
    );
    expect(
      rules[0].block?.children.map((d) => `${d.property}: ${d.value}`)
    ).toEqual(['border-color: var(--color-border-focus)']);
  });

  it('no component draws a borderless field with only the halo', () => {
    const left = found.flatMap((f) =>
      uncued(f.source).map((field) => `${f.file}: ${field}`)
    );
    expect(left).toEqual([]);
  });

  it('still reads every borderless field the census of 2026-11-07 found', () => {
    // A parser change that read no field would pass every gate above.
    expect(cues('lib/components/search/CommandPaletteSearch.svelte')).toEqual([
      'box',
    ]);
    expect(
      cues('lib/components/command-palette/CommandPalette.svelte')
    ).toEqual(['box']);
    expect(cues('lib/components/brand-editor/FontPicker.svelte')).toEqual([
      'box',
    ]);
    expect(
      cues('routes/_org/[slug]/studio/journeys/[id]/curriculum/+page.svelte')
    ).toEqual(['box']);
    // One field, drawn in a <form> or a <label>: a snippet rendered twice.
    expect(cues('lib/components/ui/SearchPill/SearchPill.svelte')).toEqual([
      'box',
      'box',
    ]);
    expect(cues('lib/components/ui/FilterBar/FilterBar.svelte')).toEqual([
      'box',
    ]);
    expect(
      cues('lib/components/studio/content-list/ContentListCommandBar.svelte')
    ).toEqual(['box']);
    expect(
      cues('lib/components/studio/media-library/MediaLibraryToolbar.svelte')
    ).toEqual(['box']);
    expect(
      cues('lib/components/brand-editor/color-picker/ColorInput.svelte')
    ).toEqual(['own']);
    expect(cues('lib/components/brand-studio/BrandStudioRail.svelte')).toEqual([
      'own',
    ]);
    expect(cues('lib/components/studio/content-form/TagsInput.svelte')).toEqual(
      ['own']
    );
    expect(
      cues('lib/components/studio/media-library/MediaPickerDialog.svelte')
    ).toEqual(['own']);
    expect(
      cues('lib/components/studio/media-library/UploadTray.svelte')
    ).toEqual(['own']);
    expect(cues('lib/components/page-builder/editor/TopBar.svelte')).toEqual([
      'own',
    ]);
  });

  it('a marked field is left with only the halo once its mark goes', () => {
    const marked = found.filter((f) =>
      f.fields.some((field) => field.cue === 'box')
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const f of marked)
      expect(
        uncued(f.source.replaceAll(' data-field-box', '')).length,
        f.file
      ).toBeGreaterThan(0);
  });
});
