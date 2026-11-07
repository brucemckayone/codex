// @vitest-environment node
/**
 * The org layout writes back every brand input it binds (Codex-q01h8).
 *
 * The brand editor's preview overwrites most of the `--brand-*` properties
 * `.org-layout` binds with `style:` and flips its two brand attributes, and
 * `clearBrandVars` removes every bound property when it closes. Svelte re-sets
 * either only when its own value changes, so the layout puts them back itself
 * whenever the editor is closed, through `writeBackLayoutBrandInputs`. This file pins the call site: every input the
 * element binds comes from the one record the write-back reads, under its own
 * name, and the layout registers the write-back.
 *
 * A SOURCE test, the weaker instrument: the layout has no render harness (see
 * `navigation-progress-brand-scope.test.ts`); the write-back itself runs in
 * `layout-brand-inputs.svelte.test.ts`. It is read with svelte's own parser,
 * so a comment is not code. Only a bare top-level call counts, the form that
 * registers the effect unconditionally while the layout initialises; a call
 * inside onMount, untrack or a branch fails it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AST, parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(import.meta.dirname, '..', '+layout.svelte'),
  'utf8'
);
const ast = parse(source, { modern: true });
const script = ast.instance?.content.body ?? [];
const carrier = ast.fragment.nodes.find(
  (node): node is AST.RegularElement =>
    node.type === 'RegularElement' &&
    node.attributes.some(
      (a) =>
        a.type === 'Attribute' &&
        a.name === 'class' &&
        Array.isArray(a.value) &&
        a.value.some(
          (v) => v.type === 'Text' && v.data.split(/\s+/).includes('org-layout')
        )
    )
);

/** An attribute's or directive's `{…}` exactly as written, braces included. */
const written = (value: AST.Attribute['value']) =>
  value !== true && !Array.isArray(value)
    ? source.slice(value.start, value.end)
    : undefined;

/** The keys of a top-level `const <name> = $derived({ … })` record. */
function recordKeys(name: string): string[] {
  for (const statement of script) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const { id, init } of statement.declarations) {
      if (id.type !== 'Identifier' || id.name !== name) continue;
      if (
        init?.type !== 'CallExpression' ||
        init.callee.type !== 'Identifier' ||
        init.callee.name !== '$derived'
      )
        return [];
      const [record] = init.arguments;
      if (record?.type !== 'ObjectExpression') return [];
      return record.properties.flatMap((p) =>
        p.type === 'Property' &&
        p.key.type === 'Literal' &&
        typeof p.key.value === 'string'
          ? [p.key.value]
          : []
      );
    }
  }
  return [];
}

describe('the org layout writes back every input it binds', () => {
  it('binds each style input on .org-layout from the one record, under its own name', () => {
    expect(carrier, '.org-layout').toBeDefined();
    const directives = (carrier?.attributes ?? []).filter(
      (a) => a.type === 'StyleDirective'
    );
    expect(directives.length).toBeGreaterThan(0);
    expect(
      directives.filter(
        (d) => written(d.value) !== `{brandInputVars['${d.name}']}`
      )
    ).toEqual([]);
    // The write-back sets no priority, so an `|important` one would come back
    // weaker than Svelte set it.
    expect(directives.filter((d) => d.modifiers.length > 0)).toEqual([]);
    expect(recordKeys('brandInputVars').sort()).toEqual(
      directives.map((d) => d.name).sort()
    );
  });

  it('binds both brand attributes from the record it writes back', () => {
    const names = recordKeys('brandInputAttributes');
    expect(names.sort()).toEqual(['data-org-bg', 'data-org-brand']);
    for (const name of names) {
      const attribute = carrier?.attributes.find(
        (a) => a.type === 'Attribute' && a.name === name
      );
      expect(
        attribute?.type === 'Attribute' ? written(attribute.value) : undefined,
        name
      ).toBe(`{brandInputAttributes['${name}'] ? '' : undefined}`);
    }
  });

  it('registers the write-back once, at the top level, reading both records', () => {
    const imported = script.some(
      (s) =>
        s.type === 'ImportDeclaration' &&
        s.source.value === '$lib/brand-editor' &&
        s.specifiers.some(
          (spec) =>
            spec.type === 'ImportSpecifier' &&
            spec.local.name === 'writeBackLayoutBrandInputs' &&
            spec.imported.type === 'Identifier' &&
            spec.imported.name === 'writeBackLayoutBrandInputs'
        )
    );
    expect(imported, 'imported from $lib/brand-editor').toBe(true);
    const calls = script.flatMap((s) =>
      s.type === 'ExpressionStatement' &&
      s.expression.type === 'CallExpression' &&
      s.expression.callee.type === 'Identifier' &&
      s.expression.callee.name === 'writeBackLayoutBrandInputs'
        ? [s.expression]
        : []
    );
    expect(calls).toHaveLength(1);
    expect(
      calls[0]?.arguments.map((arg) =>
        arg.type === 'ArrowFunctionExpression' && arg.body.type === 'Identifier'
          ? arg.body.name
          : undefined
      )
    ).toEqual(['brandInputVars', 'brandInputAttributes']);
  });
});
