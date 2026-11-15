#!/usr/bin/env node
/**
 * Load-failure Retry gate (Codex-if444): a read that failed is retried
 * through the shared retry core, never by hand: LoadFailedAlert, or
 * `createLoadRetry` (load-retry.svelte.ts) under a failure UI of its own.
 *
 * The defect class. A page holds its read as `$derived(getX(id))`. When the
 * read FAILS, kit 2.55 drops the query from its cache, so `refresh()` re-runs
 * the derivation and the page is handed a NEW query, still loading, with a
 * read of its own; the refreshed query fetches again too, and nobody reads
 * that stray result. A hand-written Retry that awaits `X.refresh()` and then
 * looks at the page has waited on the stray read and looks at the new query:
 * Monetisation's and Subscribers' payout alerts called a repeat failure a
 * success and dropped focus to <body>. A load read's `invalidate()` is no
 * better: kit resolves it late (after every live remote query) or early
 * (overtaken, with the data unchanged), and Account → Payments said "We
 * still couldn't…" about a reload that never ran. The core waits for the
 * read the page holds (`createLoadRetry`'s `heldRead`), so:
 *
 *   retry-label      Outside LoadFailedAlert.svelte, no file names
 *                    `money_setup_load_failed_retry` or `…_retrying`. That
 *                    Retry label is the component's; a page that renders it
 *                    has written its own Retry. Comments don't count.
 *   derived-refresh  In a .svelte or .svelte.ts file, a function whose FIRST
 *                    await is the refresh of X, where X is a `$derived` that
 *                    calls a remote function (an import from a `*.remote`
 *                    module) or `loadRead`, and which runs any code after it
 *                    (a read of X or of a `$derived` built from X, a state
 *                    write, a focus move, a `finally`). The refresh may be
 *                    `X.refresh()`, `X?.refresh()`, through a local alias
 *                    (`const query = X`), inside `.catch()`/`Promise.all()`,
 *                    or through a same-file helper that calls it. Also a
 *                    function whose first await is `invalidate()` or
 *                    `invalidateAll()` and that then reads the page's `data`
 *                    prop or a `$derived` built from it.
 *                    Only a Retry is checked. In a component, a function
 *                    its markup presses from a failed state: an `{#if}` that
 *                    holds when it failed (`{#if failed || retrying}`, the
 *                    failed layout kept through a Retry, included), the
 *                    `{:else}` of one that holds when loaded, a `{:catch}`,
 *                    or a handler prop of a component given a failure prop
 *                    (`<Note failed={x} onTryAgain={retry} />`). In a
 *                    .svelte.ts module, a function named for a Retry.
 *   parse            A scanned file that does not parse fails: it can't be
 *                    checked.
 *
 * Why these edges. The awaited promise is the wrong read whatever follows it,
 * so "any code after" catches the copies that only clear a busy flag or move
 * focus (their alert unmounts while the new query loads, and the flag tracks
 * the stray read). "First await" keeps a refresh AFTER a mutation quiet
 * (`await save(); await X.refresh()`): a query the page has just changed has
 * loaded, and kit re-reads a loaded query in place. A refresh inside a
 * callback (`read(query, () => query.refresh())`) is not the function's own
 * await, and a query held outside any `$derived` (`const q = getX()`) is
 * never swapped, so neither is flagged. Nor is one created inside
 * `untrack(…)` (imported from 'svelte') within its derivation: the
 * derivation does not track it, so kit's refresh can't re-run it and the
 * page keeps the query it refreshed.
 *
 * Not checked: a Retry written with `.then()` instead of `await`, a refresh
 * reached through another module, a function that awaits something
 * unrelated before its refresh, a failure prop passed in a spread
 * (`<Note {...noteProps} onTryAgain={retry} />`; only props written out are
 * read), and a failure prop named like a handler (`onboardingFailed`: any
 * `on…` prop is taken as a callback). A failure-named `data-*` or `aria-*`
 * attribute goes to the DOM, so it is never taken as a failure prop.
 *
 * Scanned: apps/web/src, without paraglide/, tests (`*.test.*`, `__tests__/`,
 * `src/tests/`) and fixtures (`__fixtures__/`). LoadFailedAlert.svelte owns
 * the pattern and is exempt from both rules.
 *
 * ALLOWLIST holds the exceptions, each with its one-line, owner-visible reason
 * and the exact number of violations it waives (`expect`). An entry whose
 * count differs FAILS the gate: a new violation can't hide behind a known one,
 * and a fixed file can't keep its waiver.
 *
 * Exported (`collectViolations`) so the node:test suite can point the same
 * scan at fixture trees; `main()` runs only as the CLI entrypoint.
 * `--root <dir>` (or `--root=<dir>`) scans `<dir>/src` instead of
 * apps/web/src, without the real tree's ALLOWLIST. Any other argument exits 2.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The one file that owns the Retry, relative to the scanned `src/`. */
export const OWNER = 'lib/components/studio/LoadFailedAlert.svelte';

/**
 * The exceptions. `file` is relative to apps/web; `expect` is the exact
 * number of violations of `rule` the entry waives in that file; `bead` is the
 * work that removes it, and `reason` says why it is here, in one line. An
 * entry whose file no longer violates is STALE and fails the gate: the bead
 * that fixes a file deletes its line in the same change.
 */
export const ALLOWLIST = [
  {
    file: 'src/lib/components/studio/content-list/NewContentMenu.svelte',
    rule: 'derived-refresh',
    expect: 1,
    bead: 'Codex-a6ofh.3',
    reason:
      'The drafts Try again judges `failedAgain` on the new query; E3 fixes it and deletes this line',
  },
  {
    file: 'src/lib/components/studio/media-library/StudioMediaLibrary.svelte',
    rule: 'derived-refresh',
    expect: 1,
    bead: 'Codex-a6ofh.3',
    reason:
      "retryList judges the stray read's rejection; fixed on E3's branch, which deletes this line",
  },
  {
    file: 'src/lib/components/studio/media-library/MediaPickerDialog.svelte',
    rule: 'derived-refresh',
    expect: 1,
    bead: 'Codex-a6ofh.5',
    reason:
      "retryList's failed block unmounts while the new query loads; goes when the picker moves onto PagedList",
  },
];

/** The Retry label LoadFailedAlert owns. */
const RETRY_LABEL = /\bmoney_setup_load_failed_retry(?:ing)?\b/g;
const REMOTE_MODULE = /\.remote(?:\.[cm]?[jt]s)?$/;
const ALERT_READ_MODULE = /(?:^|\/)alert-read(?:\.[cm]?[jt]s)?$/;
const SCANNED_EXTS = ['.svelte', '.ts', '.js', '.mjs'];
const RUNES_FILE = /\.svelte(?:\.[jt]s)?$/;
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
/** A name or string that says a read failed, in an `{#if}` test. */
const FAILURE_NAME = /fail|error|unread|problem/i;
/** A module's Retry, which has no markup to place it: named for one. */
const RETRY_NAME = /retry|try_?again/i;
/** Svelte's own markup nodes; anything else in the fragment is ESTree. */
const TEMPLATE_TYPES = new Set([
  'Fragment',
  'Text',
  'Comment',
  'RegularElement',
  'Component',
  'SvelteComponent',
  'SvelteElement',
  'SvelteSelf',
  'SvelteFragment',
  'SvelteHead',
  'SvelteBody',
  'SvelteWindow',
  'SvelteDocument',
  'SvelteBoundary',
  'SvelteOptions',
  'SlotElement',
  'TitleElement',
  'IfBlock',
  'EachBlock',
  'AwaitBlock',
  'KeyBlock',
  'SnippetBlock',
  'ExpressionTag',
  'HtmlTag',
  'RenderTag',
  'ConstTag',
  'DebugTag',
  'AttachTag',
  'Attribute',
  'SpreadAttribute',
  'OnDirective',
  'BindDirective',
  'ClassDirective',
  'StyleDirective',
  'UseDirective',
  'TransitionDirective',
  'AnimateDirective',
  'LetDirective',
]);
/** A .svelte.ts module parses as a TypeScript instance script. */
const MODULE_PREFIX = '<script lang="ts">';
const MODULE_SUFFIX = '\n</script>';

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'paraglide') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, files);
    else if (SCANNED_EXTS.some((ext) => entry.name.endsWith(ext)))
      files.push(full);
  }
  return files;
}

function isInside(dir, candidate) {
  const rel = relative(dir, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Tests and fixtures never ship; they drive the alert and its doubles. */
function isExempt(srcRoot, file) {
  const rel = relative(srcRoot, file).split(sep).join('/');
  return (
    rel === OWNER ||
    rel.endsWith('.d.ts') ||
    /\.test\.[^/]+$/.test(rel) ||
    /(?:^|\/)(?:__tests__|__fixtures__)\//.test(rel) ||
    rel.startsWith('tests/')
  );
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++)
    if (source.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * The source with every comment (`//`, `/* *\/`, `<!-- -->`) blanked to
 * spaces, newlines kept, so offsets and lines still match. Strings and
 * template literals are skipped whole, so a `//` inside a URL is not taken
 * for a comment.
 */
export function blankComments(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const stop = end === -1 ? source.length : end + 3;
      blank(i, stop);
      i = stop;
    } else if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === '\\') j++;
        else if (ch !== '`' && source[j] === '\n') break;
        j++;
      }
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

// ── ESTree helpers ─────────────────────────────────────────────────────

function* childNodes(node) {
  for (const key of Object.keys(node)) {
    if (key === 'metadata' || key === 'loc' || key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item.type === 'string') yield item;
    } else if (value && typeof value.type === 'string') yield value;
  }
}

/**
 * Every node under `node`, itself included. `intoFunctions: false` yields a
 * nested function but not what is inside it: it runs on its own.
 */
function* descendants(node, { intoFunctions = true } = {}) {
  yield node;
  for (const child of childNodes(node)) {
    if (!intoFunctions && FUNCTION_TYPES.has(child.type)) yield child;
    else yield* descendants(child, { intoFunctions });
  }
}

/** The nodes a function runs itself: its body, not its nested functions'. */
function ownNodes(fn) {
  return descendants(fn.body, { intoFunctions: false });
}

function isDerivedCall(node) {
  if (node?.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === '$derived';
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === '$derived' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'by'
  );
}

/** The identifier a call is made through: `getX(…)`, or `remote` in `remote.getX(…)`. */
function calleeRoot(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier')
    return callee.object.name;
  return null;
}

/** `X.refresh()` / `X?.refresh()`: the X, or null. */
function refreshedName(call) {
  const { callee } = call;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'refresh' &&
    callee.object.type === 'Identifier'
  )
    return callee.object.name;
  return null;
}

/** What one parsed file binds that the rule needs. */
function collectFacts(programs) {
  const remote = new Set();
  const navigation = new Set();
  /** Local names of Svelte's `untrack`. */
  const untracked = new Set();
  /** @type {Map<string, any>} */
  const derived = new Map();
  const dataProps = new Set();

  for (const program of programs) {
    for (const node of program.body) {
      if (node.type !== 'ImportDeclaration' || node.importKind === 'type')
        continue;
      const from = String(node.source.value);
      for (const spec of node.specifiers) {
        if (spec.importKind === 'type') continue;
        const imported =
          spec.type === 'ImportSpecifier' ? spec.imported.name : null;
        if (REMOTE_MODULE.test(from)) remote.add(spec.local.name);
        else if (ALERT_READ_MODULE.test(from) && imported === 'loadRead')
          remote.add(spec.local.name);
        else if (
          from === '$app/navigation' &&
          (imported === 'invalidate' || imported === 'invalidateAll')
        )
          navigation.add(spec.local.name);
        else if (from === 'svelte' && imported === 'untrack')
          untracked.add(spec.local.name);
      }
    }
    for (const node of descendants(program)) {
      if (node.type !== 'VariableDeclarator' || !node.init) continue;
      if (node.id.type === 'Identifier' && isDerivedCall(node.init))
        derived.set(node.id.name, node.init);
      if (
        node.id.type === 'ObjectPattern' &&
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'Identifier' &&
        node.init.callee.name === '$props'
      ) {
        for (const prop of node.id.properties) {
          if (prop.type !== 'Property' || prop.key.type !== 'Identifier')
            continue;
          if (prop.key.name !== 'data') continue;
          const value =
            prop.value.type === 'AssignmentPattern'
              ? prop.value.left
              : prop.value;
          if (value.type === 'Identifier') dataProps.add(value.name);
        }
      }
    }
  }

  /**
   * Whether a derivation calls a remote read, outside `untrack(…)`: a query
   * created in there is not tracked, so kit's refresh never swaps it.
   */
  const callsRemote = (node) => {
    if (node.type === 'CallExpression') {
      const { callee } = node;
      if (callee.type === 'Identifier' && untracked.has(callee.name))
        return false;
      const root = calleeRoot(callee);
      if (root !== null && remote.has(root)) return true;
    }
    for (const child of childNodes(node)) if (callsRemote(child)) return true;
    return false;
  };
  const queries = new Set(
    [...derived].filter(([, init]) => callsRemote(init)).map(([name]) => name)
  );

  /** `$derived`s built from `seed`, and from those, transitively. */
  const builtFrom = (seed) => {
    const found = new Set(seed);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [name, init] of derived) {
        if (found.has(name)) continue;
        for (const node of descendants(init)) {
          if (node.type === 'Identifier' && found.has(node.name)) {
            found.add(name);
            grew = true;
            break;
          }
        }
      }
    }
    return found;
  };

  return { remote, navigation, derived, queries, dataProps, builtFrom };
}

/** The named functions a program declares: `function f`, `const f = () =>`, `{ f() {} }`. */
function* functionsOf(programs) {
  for (const program of programs) {
    for (const node of descendants(program)) {
      if (node.type === 'FunctionDeclaration' && node.id)
        yield { fn: node, name: node.id.name };
      else if (
        node.type === 'VariableDeclarator' &&
        node.id.type === 'Identifier' &&
        node.init &&
        FUNCTION_TYPES.has(node.init.type)
      )
        yield { fn: node.init, name: node.id.name };
      else if (
        node.type === 'Property' &&
        !node.computed &&
        node.key.type === 'Identifier' &&
        FUNCTION_TYPES.has(node.value?.type)
      )
        yield { fn: node.value, name: node.key.name };
    }
  }
}

/**
 * Whether an `{#if}` test holds in the failed state ('fail'), in the loaded
 * one ('ok'), or neither (null): a name or string that says failure
 * (`connectFailed`, `data.loadFailed`, `query.error`, `previewProblem ===
 * 'failed'`), through `!`, `===`/`!==`, `&&` and `||`. An `||` holds whenever
 * either side does, so one failure side makes it 'fail': `{#if failed ||
 * retrying}` is the failed layout kept mounted through a Retry.
 */
function testPolarity(test) {
  if (!test) return null;
  switch (test.type) {
    case 'Identifier':
      return FAILURE_NAME.test(test.name) ? 'fail' : null;
    case 'Literal':
      return typeof test.value === 'string' && FAILURE_NAME.test(test.value)
        ? 'fail'
        : null;
    case 'MemberExpression':
      if (
        !test.computed &&
        test.property.type === 'Identifier' &&
        FAILURE_NAME.test(test.property.name)
      )
        return 'fail';
      return testPolarity(test.object);
    case 'ChainExpression':
      return testPolarity(test.expression);
    case 'CallExpression':
      return testPolarity(test.callee);
    case 'UnaryExpression': {
      if (test.operator !== '!') return null;
      const inner = testPolarity(test.argument);
      return inner === 'fail' ? 'ok' : inner === 'ok' ? 'fail' : null;
    }
    case 'BinaryExpression': {
      const side =
        testPolarity(test.left) === 'fail' ||
        testPolarity(test.right) === 'fail'
          ? 'fail'
          : null;
      if (test.operator === '===' || test.operator === '==') return side;
      if (test.operator === '!==' || test.operator === '!=')
        return side === 'fail' ? 'ok' : null;
      return null;
    }
    case 'LogicalExpression': {
      const left = testPolarity(test.left);
      const right = testPolarity(test.right);
      if (test.operator === '&&')
        return left === 'fail' || right === 'fail' ? 'fail' : null;
      if (test.operator === '||') {
        if (left === 'fail' || right === 'fail') return 'fail';
        return left === 'ok' && right === 'ok' ? 'ok' : null;
      }
      return null;
    }
    default:
      return null;
  }
}

/** A callback prop or event handler: `onTryAgain`, `onclick`. */
const HANDLER_PROP = /^on/;
/**
 * Passed through to the DOM, not the component's own say: `data-error` on
 * an `<Input>` is a field-validity hook, not a failed read.
 */
const DOM_ATTRIBUTE = /^(?:data|aria)-/;

/**
 * `<Note failed …>`: a component told it shows a failure (not `={false}`).
 * A failure prop is named as an `{#if}` test is (FAILURE_NAME: `failed`,
 * `hasError`, `problem`), never a handler (`onError` is a callback) or a
 * DOM attribute (`data-error`).
 */
function showsFailure(node) {
  if (node.type !== 'Component' && node.type !== 'SvelteComponent')
    return false;
  return node.attributes.some(
    (attr) =>
      attr.type === 'Attribute' &&
      FAILURE_NAME.test(attr.name) &&
      !HANDLER_PROP.test(attr.name) &&
      !DOM_ATTRIBUTE.test(attr.name) &&
      !(
        attr.value?.type === 'ExpressionTag' &&
        attr.value.expression.type === 'Literal' &&
        attr.value.expression.value === false
      )
  );
}

/**
 * What the markup presses from a failed state: the names its handlers there
 * reference, and the functions written inline there. A failed state is the
 * branch of an `{#if}` / `{:else if}` whose test says failure (or the
 * `{:else}` of one that says loaded), an `{#await}`'s `{:catch}`, and the
 * handler props of a component given a failure prop
 * (`<Note failed={x} onTryAgain={retry} />`), which decides itself when to
 * show its Retry.
 */
function pressedFromFailure(fragment) {
  const names = new Set();
  const inline = [];
  const collect = (expr) => {
    for (const node of descendants(expr)) {
      if (node.type === 'Identifier') names.add(node.name);
      if (FUNCTION_TYPES.has(node.type)) inline.push(node);
    }
  };
  const visit = (node, failed) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, failed);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'IfBlock') {
      const polarity = testPolarity(node.test);
      visit(node.consequent, failed || polarity === 'fail');
      visit(node.alternate, failed || polarity === 'ok');
      return;
    }
    if (node.type === 'AwaitBlock') {
      visit(node.pending, failed);
      visit(node.then, failed);
      visit(node.catch, true);
      return;
    }
    // Inside a failed branch its handlers are collected below anyway.
    if (!failed && showsFailure(node)) {
      for (const attr of node.attributes) {
        if (attr.type === 'Attribute' && HANDLER_PROP.test(attr.name))
          collect(attr);
      }
    }
    // An ESTree expression inside the markup: a handler, a prop, a tag.
    if (!TEMPLATE_TYPES.has(node.type)) {
      if (failed) collect(node);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'metadata' || key === 'parent') continue;
      visit(node[key], failed);
    }
  };
  visit(fragment, false);
  return { names, inline };
}

/** Local aliases of a query in one function: `const query = X`. */
function aliasesIn(fn, queries) {
  const aliases = new Map();
  for (const node of ownNodes(fn)) {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init?.type === 'Identifier' &&
      queries.has(node.init.name)
    )
      aliases.set(node.id.name, node.init.name);
  }
  return aliases;
}

/** The query whose refresh `expr` calls (not inside a callback), or null. */
function refreshIn(expr, queries, aliases, helpers) {
  for (const node of descendants(expr, { intoFunctions: false })) {
    if (node.type !== 'CallExpression') continue;
    const name = refreshedName(node);
    if (name !== null) {
      if (queries.has(name)) return { query: name, via: null };
      if (aliases.has(name)) return { query: aliases.get(name), via: name };
    }
    if (node.callee.type === 'Identifier' && helpers.has(node.callee.name))
      return {
        query: helpers.get(node.callee.name),
        via: `${node.callee.name}()`,
      };
  }
  return null;
}

function invalidateIn(expr, navigation) {
  for (const node of descendants(expr, { intoFunctions: false })) {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      navigation.has(node.callee.name)
    )
      return node.callee.name;
  }
  return null;
}

/**
 * The functions that are a Retry: in a component, what its markup presses
 * from a failed state (by name, or written inline there); in a .svelte.ts
 * module, which has no markup, a function named for one.
 */
function retryFunctions(programs, fragment) {
  const named = [...functionsOf(programs)];
  if (!fragment) return named.filter(({ name }) => RETRY_NAME.test(name));
  const pressed = pressedFromFailure(fragment);
  return [
    ...named.filter(({ name }) => pressed.names.has(name)),
    ...pressed.inline.map((fn) => ({ fn, name: null })),
  ];
}

/**
 * The derived-refresh findings of one file. `fragment` is a component's
 * markup (null for a module); `shift` maps an AST offset back to the file's
 * own source.
 */
function checkPrograms(programs, fragment, source, shift, report) {
  const facts = collectFacts(programs);
  const { queries, navigation, dataProps, builtFrom } = facts;
  if (queries.size === 0 && (navigation.size === 0 || dataProps.size === 0))
    return;

  // Same-file helpers that refresh a query themselves (one level).
  const helpers = new Map();
  for (const { fn, name } of functionsOf(programs)) {
    if (helpers.has(name)) continue;
    const aliases = aliasesIn(fn, queries);
    for (const node of ownNodes(fn)) {
      if (node.type !== 'CallExpression') continue;
      const target = refreshedName(node);
      const query = queries.has(target) ? target : aliases.get(target);
      if (query) {
        helpers.set(name, query);
        break;
      }
    }
  }

  const fromData = builtFrom(dataProps);
  const seen = new Set();
  for (const { fn } of retryFunctions(programs, fragment)) {
    if (seen.has(fn)) continue;
    seen.add(fn);
    const own = [...ownNodes(fn)];
    const awaits = own
      .filter((node) => node.type === 'AwaitExpression')
      .sort((a, b) => a.start - b.start);
    const first = awaits[0];
    if (!first) continue;
    const after = own.filter(
      (node) =>
        node.start >= first.end &&
        (node.type === 'Identifier' ||
          node.type === 'CallExpression' ||
          FUNCTION_TYPES.has(node.type))
    );
    if (after.length === 0) continue;

    const aliases = aliasesIn(fn, queries);
    const refresh = refreshIn(first.argument, queries, aliases, helpers);
    if (refresh) {
      const watched = builtFrom([refresh.query]);
      for (const [alias, query] of aliases)
        if (query === refresh.query) watched.add(alias);
      const read = after.find(
        (node) => node.type === 'Identifier' && watched.has(node.name)
      );
      const derivedLine = lineOf(
        source,
        shift(facts.derived.get(refresh.query).start)
      );
      report(
        shift(first.start),
        `awaits the refresh of \`${refresh.query}\` (a $derived remote read, line ${derivedLine})` +
          `${refresh.via ? ` through \`${refresh.via}\`` : ''}, then ` +
          `${read ? `reads \`${read.name}\`` : 'acts on the result'}. A failed read is dropped by kit, so this ` +
          'waits on the stray read while the page holds a NEW query. Use LoadFailedAlert ' +
          '(lib/components/studio/LoadFailedAlert.svelte), with `bind:retrying` to keep a failed layout, ' +
          'or createLoadRetry (lib/components/studio/load-retry.svelte.ts) under a failure UI of its own'
      );
      continue;
    }

    const invalidator = invalidateIn(first.argument, navigation);
    if (invalidator && fromData.size > 0) {
      const read = after.find(
        (node) => node.type === 'Identifier' && fromData.has(node.name)
      );
      if (!read) continue;
      report(
        shift(first.start),
        `awaits \`${invalidator}()\`, then reads \`${read.name}\` from the page's load. Kit resolves it ` +
          'late (after every live query) or early (overtaken, data unchanged), so it is never the answer. ' +
          'Use loadRead (lib/components/studio/alert-read.ts) with LoadFailedAlert or createLoadRetry'
      );
    }
  }
}

function parsePrograms(file, source) {
  if (file.endsWith('.svelte')) {
    const ast = parse(source, { modern: true, filename: file });
    return {
      programs: [ast.module?.content, ast.instance?.content].filter(Boolean),
      fragment: ast.fragment,
      shift: (offset) => offset,
    };
  }
  // A `</script` in the module (a doc comment's example) would close the
  // wrapper: the same length, so offsets hold.
  const body = source.replaceAll('</script', '<_script');
  const ast = parse(`${MODULE_PREFIX}${body}${MODULE_SUFFIX}`, {
    modern: true,
    filename: file,
  });
  return {
    programs: [ast.instance?.content].filter(Boolean),
    fragment: null,
    shift: (offset) => offset - MODULE_PREFIX.length,
  };
}

function scanFile(file, source, report) {
  const code = blankComments(source);
  for (const match of code.matchAll(RETRY_LABEL)) {
    report(
      match.index,
      'retry-label',
      `renders LoadFailedAlert's Retry label (\`${match[0]}\`) outside it: a hand-written load-failure Retry. ` +
        'Mount LoadFailedAlert instead, or build the failure UI on createLoadRetry (lib/components/studio/load-retry.svelte.ts) with labels of its own'
    );
  }
  if (!RUNES_FILE.test(file)) return;
  let parsed;
  try {
    parsed = parsePrograms(file, source);
  } catch (error) {
    report(
      0,
      'parse',
      `does not parse, so it cannot be checked: ${String(error?.message ?? error).split('\n')[0]}`
    );
    return;
  }
  checkPrograms(
    parsed.programs,
    parsed.fragment,
    source,
    parsed.shift,
    (offset, detail) => report(offset, 'derived-refresh', detail)
  );
}

/**
 * Waive what the allowlist names, exactly as many times as each entry
 * expects. An entry that waives nothing is stale; one that waives a
 * different number is miscounted. Both fail.
 */
function applyAllowlist(found, allowlist) {
  const counts = new Map(allowlist.map((a) => [a, 0]));
  const violations = found.filter((v) => {
    const entry = allowlist.find((a) => a.file === v.file && a.rule === v.rule);
    if (entry) counts.set(entry, counts.get(entry) + 1);
    return !entry;
  });
  const stale = allowlist.filter((a) => counts.get(a) === 0);
  const miscounted = allowlist
    .filter((a) => counts.get(a) > 0 && counts.get(a) !== a.expect)
    .map((a) => ({ ...a, found: counts.get(a) }));
  return {
    violations,
    allowlisted: found.length - violations.length,
    stale,
    miscounted,
  };
}

/**
 * Core scan, pure over the tree it is pointed at. Paths in the result are
 * relative to `cwd`, with forward slashes, as the allowlist spells them.
 *
 * @returns {{ violations: {file:string,line:number,rule:string,detail:string}[],
 *   allowlisted: number, stale: typeof ALLOWLIST,
 *   miscounted: (typeof ALLOWLIST[number] & { found: number })[], filesScanned: number }}
 */
export function collectViolations({
  srcRoot = join(WEB_ROOT, 'src'),
  cwd = WEB_ROOT,
  allowlist = ALLOWLIST,
} = {}) {
  if (!existsSync(srcRoot))
    throw new Error(`Load-retry gate: scan root does not exist: ${srcRoot}`);
  const files = walkFiles(srcRoot).filter(
    (file) => isInside(srcRoot, file) && !isExempt(srcRoot, file)
  );
  const found = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(cwd, file).split(sep).join('/');
    scanFile(file, source, (offset, rule, detail) =>
      found.push({ file: name, line: lineOf(source, offset), rule, detail })
    );
  }
  return { ...applyAllowlist(found, allowlist), filesScanned: files.length };
}

function usage(why) {
  console.error(
    `Load-retry gate: ${why} Usage: check-load-retry.mjs [--root <dir>]`
  );
  process.exit(2);
}

/** `--root <dir>` / `--root=<dir>`: the tree to scan instead of apps/web, with no allowlist. */
function optionsFrom(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') root = argv[++i] ?? '';
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
    else usage(`unknown argument '${arg}'.`);
    if (!root) usage('--root needs a directory.');
  }
  if (root === null) return { allowlist: ALLOWLIST };
  const dir = resolve(root);
  return { srcRoot: join(dir, 'src'), cwd: dir, allowlist: [] };
}

/**
 * The gate's verdict on a scan: one line per failure. A violation, a STALE
 * allowlist entry (its file no longer violates) and a miscounted one each
 * fail it, so a fixed file can't linger on the list.
 */
export function failureLines({ violations, stale, miscounted }) {
  return [
    ...violations.map((v) => `${v.file}:${v.line} ${v.rule}: ${v.detail}`),
    ...stale.map(
      (a) =>
        `${a.file} ${a.rule}: allowlisted (${a.bead}) but no longer violates. Delete its ALLOWLIST entry.`
    ),
    ...miscounted.map(
      (a) =>
        `${a.file} ${a.rule}: allowlisted (${a.bead}) for ${a.expect} violation(s) but has ${a.found}. ` +
        'Fix a new one; re-pin `expect` only when one was removed.'
    ),
  ];
}

function main(argv = process.argv.slice(2)) {
  const options = optionsFrom(argv);
  const result = collectViolations(options);
  const { violations, allowlisted, stale, miscounted, filesScanned } = result;

  if (filesScanned === 0) {
    console.error(
      'Load-retry gate scanned 0 files: the scan root is misconfigured. Failing closed.'
    );
    process.exit(1);
  }

  const failures = failureLines(result);
  for (const line of failures) console.error(line);
  if (failures.length > 0) {
    console.error(
      `\n${violations.length} violation(s), ${stale.length} stale and ${miscounted.length} miscounted allowlist entr${
        stale.length + miscounted.length === 1 ? 'y' : 'ies'
      }. ` +
        'A read that failed is retried through LoadFailedAlert or createLoadRetry (a remote query as it is, or loadRead for load data). ' +
        'See the header of apps/web/scripts/check-load-retry.mjs.'
    );
    process.exit(1);
  }

  console.log(
    `OK: no hand-written load-failure Retry in ${filesScanned} file(s) ` +
      `(${allowlisted} known violation(s) allowlisted, in ${options.allowlist.length} entries).`
  );
}

/**
 * Whether this file is the process's entry. Compared as real paths: Node
 * resolves import.meta.url through symlinks but not argv[1], so a plain
 * comparison skips main() under a symlinked checkout and exits 0 unchecked.
 */
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntrypoint()) main();
