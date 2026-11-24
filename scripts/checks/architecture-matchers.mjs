/**
 * The matcher kinds the architecture gate's rules are built from (G0,
 * Codex-xtcfl). A rule names ONE kind in `match.kind`; a new rule is a new
 * registry entry, and a new kind is the exception.
 *
 * A kind is either
 *   - per-file: `file(rule, path, text, ctx)` -> { found, hits }, called once
 *     for every file in the rule's scope (at commit time, every STAGED file in
 *     scope), or
 *   - whole-repo: `whole(rule, { source, subjects })` -> Map<path, { found,
 *     hits }>, for rules whose answer depends on more than one file (the
 *     package graph). At commit time it runs only when the commit touches its
 *     scope.
 *
 * `found` is a violation count unless the kind MEASURES something (`unit` is
 * set), in which case it is the measurement itself and `defaultAllowed` is the
 * limit for a file the baseline doesn't pin. `hits` are
 * { line, text } pairs for the message.
 *
 * Matchers read only through `ctx.source`, never the filesystem, so the same
 * rule checks the working tree, the git index or a self-test fixture.
 */
import { regexCanStart, regexEnd } from './check-data-access-contract.mjs';
import { WORKFLOW_EPIC_MATCHERS } from './workflow-epic.mjs';

/** 1-based line of each offset, computed once per file. */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const textOf = (line) => {
    const end = text.indexOf('\n', starts[line - 1]);
    return text.slice(starts[line - 1], end === -1 ? undefined : end).trim();
  };
  return { lineOf, textOf };
}

function globalCopy(pattern) {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  );
}

/** Lines in a file, the way `wc -l` counts a file that ends in a newline. */
export function countLines(text) {
  if (text === '') return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n += 1;
  return text.endsWith('\n') ? n : n + 1;
}

// ---------------------------------------------------------------------------
// Docs helpers (ported from the 2026-11-15 docs census, which was calibrated:
// after its exemptions, four of five remaining hits in a sample were real)
// ---------------------------------------------------------------------------

/** Per-source caches: the directory set and the README's listed targets. */
const dirCache = new WeakMap();

/** Every directory that holds a tracked file, so a link to a folder resolves. */
function directoriesOf(source) {
  let dirs = dirCache.get(source);
  if (!dirs) {
    dirs = new Set();
    for (const f of source.files) {
      let at = f.lastIndexOf('/');
      while (at > 0) {
        const dir = f.slice(0, at);
        if (dirs.has(dir)) break;
        dirs.add(dir);
        at = dir.lastIndexOf('/');
      }
    }
    dirCache.set(source, dirs);
  }
  return dirs;
}

/**
 * Normalise `a/b/../c/./d` without touching the filesystem. A `..` that climbs
 * above the repo root yields a path no tracked file can have, so it can't
 * resolve by accident.
 */
function normalise(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return '\0above-the-repo-root';
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

function dirname(file) {
  const at = file.lastIndexOf('/');
  return at === -1 ? '' : file.slice(0, at);
}

/**
 * Code blanked (offsets kept), so an example isn't judged as a link: fenced
 * blocks, then inline spans on one line. Fences follow CommonMark: a CLOSING
 * fence carries no info string, so "```typescript" inside a "```markdown"
 * block doesn't close it. A naive ```…``` pairing got that wrong and judged an
 * SQL example (`ON t(creator_id)`) as a dead link. Without the inline pass,
 * `row[0](x)` in a code span read as one too.
 */
export function blankCode(text) {
  const blank = (code) => code.replace(/[^\n\r]/g, ' ');
  const lines = text.split('\n');
  let fence = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (
        open &&
        !(open[1][0] === '`' && line.slice(open[0].length).includes('`'))
      ) {
        fence = open[1];
        lines[k] = blank(line);
      }
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
      fence = null;
    lines[k] = blank(line);
  }
  return lines.join('\n').replace(/`[^`\n]+`/g, blank);
}

/** The heads whose `)` a brace-less body follows: a `/` there is a regex. */
const CONTROL_HEADS = new Set(['if', 'for', 'while', 'with']);

/**
 * One pass over JS/TS source with ONE grammar for comments, strings and
 * templates, so they can't disagree. Two passes did: the comment blanker
 * didn't nest templates and read the `//` of `https://` in
 * ``${a ? `https://${h}` : ''}`` as a comment, blanking the closing backticks,
 * and the string masker that ran after it then masked the rest of the file, so
 * a money call below it was never seen (review round 5).
 *
 *   code     comments blanked to spaces, everything else as written
 *   masked   comments blanked, and the inside of every string and template's
 *            text replaced by x (quotes kept), so a bracket, comma or paren in
 *            a string can't change how the code around it is read
 *
 * Offsets and newlines are kept in both, so lines match the file. A
 * template's `${…}` is CODE, read with the same rules (a template nested in it
 * is masked in turn, and a comment in it is a comment): a money call inside an
 * interpolation is still a call. A regex literal is skipped whole, so a quote
 * or backtick in one opens nothing. A `/` that starts a line is a regex or a
 * comment, never a division: biome breaks a binary expression after its
 * operator. An unterminated ' or " is an apostrophe the scan stepped into, not
 * a string, so it masks nothing.
 *
 * Also returns the (1-based) lines that START inside a template or string:
 * their indentation is the string's (or a dedented interpolation's), not the
 * code's.
 */
export function scanSource(source) {
  const code = source.split('');
  const masked = source.split('');
  const startsInside = new Set();
  let line = 1;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (source[k] !== '\n') {
        code[k] = ' ';
        masked[k] = ' ';
      } else line += 1;
    }
  };
  const mask = (k) => {
    if (k < source.length && source[k] !== '\n') masked[k] = 'x';
  };
  const startsLine = (at) => {
    let k = at - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k -= 1;
    return k < 0 || source[k] === '\n';
  };
  // `if (s) /`/.exec(s);`: a `/` after the `)` that closes an if, for, while
  // or with head starts a brace-less body, so it is a regex, not a division.
  const afterControlHead = (at) => {
    let k = at - 1;
    while (k >= 0 && /\s/.test(masked[k])) k -= 1;
    if (masked[k] !== ')') return false;
    for (let depth = 0; k >= 0; k--) {
      if (masked[k] === ')') depth += 1;
      else if (masked[k] === '(' && --depth === 0) break;
    }
    let end = k - 1;
    while (end >= 0 && /\s/.test(masked[end])) end -= 1;
    let start = end;
    while (start >= 0 && /[\w$]/.test(masked[start])) start -= 1;
    return CONTROL_HEADS.has(masked.slice(start + 1, end + 1).join(''));
  };

  // Code, from i to the end or (in an interpolation) to the `}` closing it.
  const scanCode = (inInterpolation) => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '\n') {
        line += 1;
        if (inInterpolation) startsInside.add(line);
        i += 1;
      } else if (c === '/' && source[i + 1] === '/') {
        const end = source.indexOf('\n', i);
        const stop = end === -1 ? source.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (
        c === '/' &&
        (regexCanStart(masked, i) || startsLine(i) || afterControlHead(i)) &&
        regexEnd(source, i) !== -1
      ) {
        i = regexEnd(source, i);
      } else if (c === "'" || c === '"') {
        scanQuoted(c);
      } else if (c === '`') {
        scanTemplate();
      } else {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (inInterpolation && depth === 0) return;
          depth -= 1;
        }
        i += 1;
      }
    }
  };

  const scanQuoted = (q) => {
    let continued = 0; // lines a backslash-newline carries the string onto
    let j = i + 1;
    while (j < source.length && source[j] !== q && source[j] !== '\n') {
      if (source[j] === '\\') {
        if (source[j + 1] === '\n') continued += 1;
        j += 2;
      } else j += 1;
    }
    if (source[j] !== q) {
      i += 1; // unterminated: not a string
      return;
    }
    for (let k = i + 1; k < j; k++) mask(k);
    for (let n = 0; n < continued; n++) {
      line += 1;
      startsInside.add(line);
    }
    i = j + 1;
  };

  const scanTemplate = () => {
    i += 1;
    while (i < source.length) {
      const c = source[i];
      if (c === '`') {
        i += 1;
        return;
      }
      if (c === '\\') {
        mask(i);
        if (source[i + 1] === '\n') {
          line += 1;
          startsInside.add(line);
        } else mask(i + 1);
        i += 2;
      } else if (c === '$' && source[i + 1] === '{') {
        i += 2;
        scanCode(true);
        i += 1; // the closing }
      } else if (c === '\n') {
        line += 1;
        startsInside.add(line);
        i += 1;
      } else {
        mask(i);
        i += 1;
      }
    }
  };

  scanCode(false);
  return { code: code.join(''), masked: masked.join(''), startsInside };
}

const NOT_A_NAME = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'await',
  'async',
  'new',
  'typeof',
  'else',
  'do',
  'try',
  'with',
  'super',
  'this',
  'void',
  'yield',
  'throw',
  'case',
  'delete',
  'in',
  'of',
  'instanceof',
]);
/** Words that can't name a method even in method position: `if (x) {`. */
const CONTROL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'function',
  'return',
  'do',
  'else',
  'try',
  'await',
  'typeof',
  'void',
  'yield',
  'throw',
  'case',
  'in',
  'of',
  'instanceof',
]);
const MODIFIERS =
  '(?:(?:public|private|protected|static|async|override|readonly|get|set)\\s+)*';
/** A declaration that names a function: the key stops here. */
const STRONG = [
  // `function` as a word: `functionsOf(list)` is a call, not `function sOf(`
  /(?:^|\s)function(?![\w$])\s*\*?\s*([\w$]+)\s*[<(]/,
  /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\b[^=]*=\s*(?:async\s+)?(?:function\b|[\w$]+\s*=>|<)/,
  // a class field holding a function: `pay = async () => {`, `#pay = () =>`
  new RegExp(
    `^${MODIFIERS}(#?[\\w$]+)\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[\\w$]+\\s*=>)`
  ),
  /(?:^|\s)class\s+([\w$]+)/,
];
/**
 * `const pay = (` is a function only when that parenthesis is a parameter
 * list, its `)` followed by an optional return type and `=>`. `const paid =
 * (await pending()).map(` is a parenthesised value.
 */
const CONST_PAREN =
  /^((?:export\s+)?(?:const|let|var)\s+([\w$]+)\b[^=]*=\s*(?:async\s+)?)\(/;
const ARROW_AFTER_PARAMS = /^\s*(?::.*?)?=>/;
/** A method's head up to its `(`: `async payOut(`, `get counts(`, `*items(`, `#pay(`. */
const METHOD_HEAD = new RegExp(
  `^${MODIFIERS}\\*?\\s*(#?[\\w$]+)\\s*(?:<[^>]*>)?\\s*\\(`
);
/**
 * What follows a method's parameter list: an optional return type, then its
 * body. The type may hold an arrow (`(): () => void {`); only an arrow right
 * before the brace makes it an arrow function's body instead.
 */
const METHOD_BODY = /^\s*(?::.*)?\{\s*$/;
const ARROW_BODY = /=>\s*\{\s*$/;
/** A return type biome wrapped: `): Promise<` here, `> {` further down. */
const WRAPPED_TYPE = /^\s*:.*[<([{,|&]\s*$/;
const TYPE_CLOSE = /^\s*[>)\]}].*\{\s*$/;
/** A name that narrows the key but isn't a declaration: keep walking past it. */
const WEAK = [
  // a property holding a function: `handler: async (ctx) => {`
  /^([\w$]+)\s*:\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/,
  // a callback passed to a call: `retry(() => {`, `await db.transaction(async (tx) => {`
  /^(?:await\s+|return\s+)?([\w$]+(?:\.[\w$]+)*)\s*\(.*(?:=>|\bfunction\b)/,
];
/**
 * A route registration that starts its line: `app.post('/refund', …`, biome's
 * `app.post(` with the path on the next line, a chained `.post('/payout', …`,
 * or, at the top level only, an assigned `export const r = app.post(…`. The
 * path is a literal starting with / or a CONSTANT_NAME, so `cache.get('payout',
 * …)` names nothing. The receiver is one name (`app`, `router`): a property
 * chain (`this.cache.get(KEY, …)`) is no router. Routes are read only in a
 * worker's source (ROUTE_FILE): in a service, `api.post('/payouts', …)` is an
 * HTTP call, and reading it as a route dropped the method around it out of the
 * key (review round 6).
 */
const ROUTE_HEAD =
  /^(\s*)((?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*|export\s+default\s+)?(?:[\w$]+)?\.(get|post|put|patch|delete|all)\(\s*(?:(['"`])(\/[^'"`]*)\4|([A-Z][A-Z0-9_]*)\s*,)?/;
const ROUTE_FILE = /^workers\/[^/]+\/src\//;
const ROUTE_PATH = /^\s*(?:(['"`])(\/[^'"`]*)\1|([A-Z][A-Z0-9_]*)\s*,)/;

/**
 * Where the parenthesis opened at (line, col) closes, in masked text: the
 * line it closes on and what follows it there. Masked text holds no string,
 * so every paren is code.
 */
function afterParens(maskedLines, line, col) {
  let depth = 0;
  for (let l = line; l < maskedLines.length; l++) {
    const text = maskedLines[l];
    for (let c = l === line ? col : 0; c < text.length; c++) {
      if (text[c] === '(') depth += 1;
      else if (text[c] === ')') {
        depth -= 1;
        if (depth === 0) return { line: l, rest: text.slice(c + 1) };
      }
    }
  }
  return null;
}

/** The method a line declares, if it is a method head: its body follows the parameters. */
function methodName(maskedLines, i) {
  const text = maskedLines[i];
  const m = METHOD_HEAD.exec(text.trimStart());
  if (!m || CONTROL.has(m[1])) return null;
  const indent = text.length - text.trimStart().length;
  const after = afterParens(maskedLines, i, indent + m[0].length - 1);
  if (after === null) return null;
  const body = (rest) => METHOD_BODY.test(rest) && !ARROW_BODY.test(rest);
  if (body(after.rest)) return m[1];
  if (!WRAPPED_TYPE.test(after.rest)) return null;
  // The type closes on the first later line back at the head's indent.
  for (let l = after.line + 1; l < maskedLines.length; l++) {
    const next = maskedLines[l];
    if (next.trim() === '' || next.length - next.trimStart().length > indent) {
      continue;
    }
    return TYPE_CLOSE.test(next) && !ARROW_BODY.test(next) ? m[1] : null;
  }
  return null;
}

/** The route a line registers, reading biome's next-line path too. */
function routeName(lines, i) {
  const head = ROUTE_HEAD.exec(lines[i] ?? '');
  if (!head || (head[2] && head[1] !== '')) return null;
  let path = head[5] ?? head[6];
  for (let k = i + 1; path === undefined && k < lines.length; k++) {
    if (lines[k].trim() === '') continue;
    const next = ROUTE_PATH.exec(lines[k]);
    path = next?.[2] ?? next?.[3] ?? null;
  }
  return path ? `${head[3].toUpperCase()} ${path}` : null;
}

/** The function, class or class field a (masked, trimmed) line declares. */
function declaredName(maskedLines, i, text) {
  for (const pattern of STRONG) {
    const name = pattern.exec(text)?.[1];
    if (name && !NOT_A_NAME.has(name)) return name;
  }
  const paren = CONST_PAREN.exec(text);
  if (!paren || NOT_A_NAME.has(paren[2])) return null;
  const line = maskedLines[i];
  const indent = line.length - line.trimStart().length;
  const after = afterParens(maskedLines, i, indent + paren[1].length);
  return after && ARROW_AFTER_PARAMS.test(after.rest) ? paren[2] : null;
}

/**
 * The function, method or class a line sits in, read from the code's
 * indentation: biome formats every source file, so each less-indented line
 * above is an ancestor. Lines that start inside a string are skipped (their
 * indentation is the string's). Weak names (a `handler:` property, a callback
 * passed to a call) narrow the key and the walk goes on to the declaration or
 * the route that names it. A call's KEY carries this name, so a fix in one
 * function can't pay for a new call in another.
 *
 * `before` is the hit line's masked text up to the match: a declaration that
 * starts there (`export const pay = (p) => stripe.transfers.create(p);`, how
 * biome writes a short arrow) names the key. `file` decides whether routes are
 * read (a worker's source only).
 */
export function enclosingName(
  maskedLines,
  lineNo,
  { startsInside = new Set(), lines = maskedLines, file = '', before } = {}
) {
  if (before !== undefined && !startsInside.has(lineNo)) {
    const own = declaredName(maskedLines, lineNo - 1, before.trim());
    if (own) return own;
  }
  const routes = ROUTE_FILE.test(file);
  const indentOf = (l) => l.length - l.trimStart().length;
  // A line that starts inside a template (a dedented `${…}` line) takes its
  // place from the code line the template starts on: that line is the
  // nearest ancestor candidate.
  let from = lineNo;
  while (from > 1 && startsInside.has(from)) from -= 1;
  let limit = indentOf(maskedLines[from - 1] ?? '') + (from === lineNo ? 0 : 1);
  // A line that starts with a closer (`}> {` ending a multi-line signature,
  // `} catch (e) {`) belongs to a construct whose head is further up, at the
  // same indent.
  let headPending = false;
  let weak = null;
  const named = (stop) => (weak ? `${stop}/${weak}` : stop);
  const start = from === lineNo ? lineNo - 2 : from - 1;
  for (let i = start; i >= 0 && (limit > 0 || headPending); i--) {
    const line = maskedLines[i];
    if (line.trim() === '' || startsInside.has(i + 1)) continue;
    const indent = indentOf(line);
    if (indent > limit || (indent === limit && !headPending)) continue;
    limit = indent;
    const text = line.trim();
    headPending = /^[)\]}>]/.test(text);
    if (headPending) continue;
    const route = routes ? routeName(lines, i) : null;
    if (route) return named(route);
    const declared = declaredName(maskedLines, i, text);
    if (declared) return named(declared);
    const method = methodName(maskedLines, i);
    if (method) return named(method);
    if (!weak) {
      for (const pattern of WEAK) {
        const name = pattern.exec(text)?.[1];
        if (name && !NOT_A_NAME.has(name)) {
          weak = name;
          break;
        }
      }
    }
  }
  return weak ?? '(top level)';
}

const LINK = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const ANGLE_LINK = /\[[^\]]*\]\(<([^>\n]+)>[^)]*\)/g;
// `[label]: target`. A label starting with ^ is a footnote (`[^1]: text`),
// whose "target" is prose, not a link.
const REFERENCE_DEFINITION =
  /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm;
const HREF = /\bhref="([^"\n]+)"/g;

/**
 * Every link target in (code-blanked) markdown: inline `[x](y)`, `[x](<y z>)`,
 * a reference definition `[x]: y`, and an HTML `href="y"`.
 */
function linksIn(body) {
  const links = [];
  for (const m of body.matchAll(LINK)) {
    if (!m[1].startsWith('<')) links.push({ raw: m[1], index: m.index });
  }
  for (const m of body.matchAll(ANGLE_LINK))
    links.push({ raw: m[1], index: m.index });
  for (const m of body.matchAll(REFERENCE_DEFINITION)) {
    links.push({ raw: m[1] ?? m[2], index: m.index });
  }
  for (const m of body.matchAll(HREF))
    links.push({ raw: m[1], index: m.index });
  return links;
}

/**
 * The repo path a markdown link points at, or null when it isn't a repo link
 * (a URL, a mailto:, an in-page #anchor, an autolink, a {{placeholder}}).
 */
function linkTarget(file, raw) {
  const url = raw.split('#')[0];
  // A URL, an autolink, or a template placeholder such as {{report_url}}.
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || /[<{]/.test(url)) {
    return null;
  }
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep the raw form; a malformed escape is simply a path that won't resolve
  }
  return decoded.startsWith('/')
    ? normalise(decoded)
    : normalise(`${dirname(file)}/${decoded}`);
}

function resolves(source, target) {
  return source.has(target) || directoriesOf(source).has(target);
}

const PATH_EXT =
  'svelte\\.ts|svelte\\.js|test\\.ts|ts|js|mjs|cjs|svelte|md|json|jsonc|sql|yml|yaml|toml|css|html|py|sh|grit';

/** A repo path written out in prose: a known top-level folder plus an extension. */
const CITED_PATH = new RegExp(
  `(?<![\\w/.-])((?:\\.claude|apps|packages|workers|docs|scripts|config|e2e|infrastructure|design|\\.github)/[\\w./@+\\-\\[\\]()]+?\\.(?:${PATH_EXT}))(?::\\d+(?:[-–]\\d+)?)?(?![\\w])`,
  'g'
);

/**
 * Placeholders and generated files the census learned to skip: `[domain]`,
 * `<name>`, globs, `{a,b}`, "my-feature" examples, and paraglide output that
 * exists only after a compile.
 */
/**
 * A bracketed path is a SvelteKit route (`routes/_org/[slug]/+page.svelte`),
 * not a placeholder, when the repo tracks a folder with that bracketed name.
 * Those are judged like any other path.
 */
function isRealRoutePath(source, path) {
  if (!path.includes('[') || /[*<{]/.test(path)) return false;
  // The bracket itself must be a tracked folder name, so `packages/[domain]/`
  // (a placeholder) stays exempt while `routes/[slug]/` is judged.
  const upToBracket = path.slice(0, path.indexOf('[') + 1);
  return source.files.some((f) => f.startsWith(upToBracket));
}

function isPlaceholderPath(path) {
  return (
    /[*<{[]/.test(path) || path.includes('/my-') || path.includes('paraglide')
  );
}

/**
 * A CLAUDE.md's imports, read as Claude Code reads them (2.1.330, the
 * import scan in its CLAUDE.md loader): an `@` at the start of a text run or
 * after whitespace, then every non-space character (`\ ` is an escaped space),
 * cut at `#`, starting `./`, `~/`, `/` or one of `[A-Za-z0-9._-]`. Code
 * blocks, code spans and HTML comments are skipped. Claude Code scans
 * markdown's text runs, so emphasis (`_see @docs/x.md_`) and a link's label
 * hold imports too. A path keeps its punctuation, as Claude Code keeps it:
 * `@README.` names `README.`, and `(@docs/x.md)` is no import. Relative to
 * the importing file; it counts only when it names a tracked file, so a
 * package name (`@codex/database`) imports nothing, and an address
 * (`a@b.com`) is no import at all. Claude Code skips an import in a table or
 * an HTML block; this counts it, on the budget's safe side.
 */
const CLAUDE_IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
const EMPHASIS = /(^|[\s\p{P}])([*_]{1,3})(?=\S)(.*?\S)\2(?=$|[\s\p{P}])/gmu;
function claudeImports(body) {
  let text = blankCode(body)
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, ' $1 ');
  for (let was = ''; was !== text; ) {
    was = text;
    text = text.replace(EMPHASIS, (_m, lead, _d, inner) => `${lead} ${inner} `);
  }
  const paths = [];
  for (const m of text.matchAll(CLAUDE_IMPORT)) {
    const path = m[1].split('#')[0].replaceAll('\\ ', ' ');
    if (/^(?:\.\/|~\/|\/.|[A-Za-z0-9._-])/.test(path)) paths.push(path);
  }
  return paths;
}
/** How deep Claude Code follows imports. */
const MAX_IMPORT_HOPS = 5;

export const MATCHERS = {
  // The epic lifecycle kinds (W0) live in their own module.
  ...WORKFLOW_EPIC_MATCHERS,
  /**
   * A regex over source code with its comments blanked out. Blanking (not
   * deleting) keeps every offset, so reported lines match the file. Without
   * it A1 counted 7 money calls on dev instead of 1: five JSDoc lines and a
   * CLAUDE.md line describe the calls they forbid.
   */
  call: {
    validate(rule) {
      if (!(rule.match.pattern instanceof RegExp)) {
        throw new Error(`rule ${rule.id}: match.pattern must be a RegExp`);
      }
    },
    file(rule, path, text) {
      const { lineOf, textOf } = lineIndex(text);
      // Matched on string-masked code: a log line or an error message that
      // names the API is not a call.
      const { masked, startsInside } = scanSource(text);
      const maskedLines = masked.split('\n');
      const lines = text.split('\n');
      const hits = [];
      for (const m of masked.matchAll(globalCopy(rule.match.pattern))) {
        const line = lineOf(m.index);
        const call = m[0].replace(/\s+/g, '');
        const before = masked.slice(
          masked.lastIndexOf('\n', m.index) + 1,
          m.index
        );
        const name = enclosingName(maskedLines, line, {
          startsInside,
          lines,
          file: path,
          before,
        });
        hits.push({ line, text: textOf(line), key: `${name}>${call}` });
      }
      return { found: hits.length, hits };
    },
  },

  /**
   * A file's length. The baseline pins each file over `newFileMax` at its
   * size; any other file may grow up to `newFileMax`.
   */
  'line-count': {
    unit: 'lines',
    validate(rule) {
      if (
        !Number.isInteger(rule.match.newFileMax) ||
        rule.match.newFileMax < 1
      ) {
        throw new Error(
          `rule ${rule.id}: match.newFileMax must be a positive integer`
        );
      }
    },
    defaultAllowed: (rule) => rule.match.newFileMax,
    file(_rule, _path, text) {
      return { found: countLines(text), hits: [] };
    },
  },

  /**
   * Workspace dependency edges against a layer map. Reads `dependencies` and
   * `peerDependencies` only: a devDependency (test-utils in a test) is not an
   * architectural edge. A package may depend on any package in a lower layer.
   * Inside one layer it may depend on an EARLIER package when the layer is
   * `ordered` (foundation, whose order is a fact of today's graph), otherwise
   * only along a listed `sameLayerEdges` entry, so a new edge is a visible
   * decision with a reason. Every `workers/*` and `apps/*` package sits in an
   * implicit top layer that nothing may depend on.
   */
  'package-graph': {
    validate(rule) {
      const { layers, sameLayerEdges } = rule.match;
      if (!Array.isArray(layers) || layers.length === 0) {
        throw new Error(
          `rule ${rule.id}: match.layers must be a non-empty array`
        );
      }
      const placed = new Set();
      for (const layer of layers) {
        for (const name of layer.packages ?? []) {
          if (placed.has(name)) {
            throw new Error(`rule ${rule.id}: ${name} is in two layers`);
          }
          placed.add(name);
        }
      }
      for (const edge of sameLayerEdges ?? []) {
        if (!placed.has(edge.from) || !placed.has(edge.to) || !edge.reason) {
          throw new Error(
            `rule ${rule.id}: same-layer edge ${edge.from} -> ${edge.to} needs two placed packages and a reason`
          );
        }
      }
    },
    whole(rule, { source, subjects }) {
      const { layers, sameLayerEdges = [] } = rule.match;
      const layerOf = new Map();
      const rankOf = new Map();
      layers.forEach((layer, i) => {
        layer.packages.forEach((name, k) => {
          layerOf.set(name, i);
          rankOf.set(name, k);
        });
      });
      const appLayer = layers.length;
      const workspace = new Set();
      const appNames = new Set();
      for (const file of subjects) {
        try {
          const { name } = JSON.parse(source.read(file));
          if (!name) continue;
          workspace.add(name);
          if (/^(workers|apps)\//.test(file)) appNames.add(name);
        } catch {
          // reported below, as the file's own hit
        }
      }
      const out = new Map();
      for (const file of subjects) {
        const text = source.read(file);
        const { lineOf } = lineIndex(text);
        const lineOfKey = (name) => {
          const at = text.indexOf(`"${name}"`);
          return at === -1 ? 1 : lineOf(at);
        };
        let pkg;
        try {
          pkg = JSON.parse(text);
        } catch {
          out.set(file, {
            found: 1,
            hits: [{ line: 1, text: 'package.json does not parse' }],
          });
          continue;
        }
        const isApp = /^(workers|apps)\//.test(file);
        const self = pkg.name;
        const selfLayer = isApp ? appLayer : layerOf.get(self);
        const hits = [];
        if (selfLayer === undefined) {
          hits.push({
            line: lineOfKey('name'),
            text: `${self} is not in the layer map; place it in a layer`,
            key: 'unplaced',
          });
        } else {
          // Any workspace package counts, prefixed or not: eight of nine
          // workers and apps/web are unprefixed, and depending on one is the
          // upward edge this rule exists to stop.
          const declared = {
            ...pkg.dependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
          };
          const deps = Object.keys(declared).filter(
            (d) =>
              d.startsWith('@codex/') ||
              workspace.has(d) ||
              String(declared[d]).startsWith('workspace:')
          );
          for (const dep of deps) {
            const depLayer = layerOf.get(dep);
            let problem = null;
            if (appNames.has(dep)) {
              problem =
                'is an app (a worker or apps/*); nothing may depend on one';
            } else if (depLayer === undefined) {
              problem = 'is not in the layer map (a new package)';
            } else if (depLayer > selfLayer) {
              problem = `is in layer ${depLayer}, above this package's layer ${selfLayer}`;
            } else if (depLayer === selfLayer) {
              const allowed = layers[selfLayer].ordered
                ? rankOf.get(dep) < rankOf.get(self)
                : sameLayerEdges.some((e) => e.from === self && e.to === dep);
              if (!allowed) {
                problem = layers[selfLayer].ordered
                  ? `is later in the ordered layer ${selfLayer}`
                  : `is in the same layer ${selfLayer}, with no listed edge`;
              }
            }
            if (problem) {
              hits.push({
                line: lineOfKey(dep),
                text: `"${dep}" ${problem}`,
                key: dep,
              });
            }
          }
        }
        out.set(file, { found: hits.length, hits });
      }
      return out;
    },
  },
  /** A relative markdown link resolves to a tracked file or folder. */
  'md-link': {
    file(_rule, file, text, { source }) {
      const body = blankCode(text);
      const { lineOf } = lineIndex(text);
      const hits = [];
      for (const { raw, index } of linksIn(body)) {
        const target = linkTarget(file, raw);
        if (target === null || resolves(source, target)) continue;
        hits.push({
          line: lineOf(index),
          text: `(${raw}) does not resolve`,
          key: raw,
        });
      }
      return { found: hits.length, hits };
    },
  },

  /**
   * A repo path cited in prose exists. A path relative to the doc's own
   * package (`src/x.ts` written as `packages/a/src/x.ts` from inside it) counts
   * when it resolves against any ancestor folder of the doc.
   */
  'md-path': {
    file(_rule, file, text, { source }) {
      const { lineOf } = lineIndex(text);
      const parts = file.split('/');
      const bases = [];
      for (let i = parts.length - 1; i > 0; i--)
        bases.push(parts.slice(0, i).join('/'));
      const hits = [];
      for (const m of text.matchAll(CITED_PATH)) {
        const path = m[1].replace(/\.+$/, '');
        if (source.has(path) || bases.some((b) => source.has(`${b}/${path}`)))
          continue;
        if (isPlaceholderPath(path) && !isRealRoutePath(source, path)) continue;
        hits.push({
          line: lineOf(m.index),
          text: `${path} does not exist`,
          key: path,
        });
      }
      return { found: hits.length, hits };
    },
  },

  /**
   * A doc is listed in the index: the index links to it, or to a folder that
   * holds it (so a section can list a whole folder).
   */
  'doc-index': {
    validate(rule) {
      if (typeof rule.match.index !== 'string') {
        throw new Error(
          `rule ${rule.id}: match.index must name the index file`
        );
      }
    },
    file(rule, file, _text, { source }) {
      const { index } = rule.match;
      if (!source.has(index)) {
        return {
          found: 1,
          hits: [{ line: 1, text: `${index} does not exist`, key: 'no-index' }],
        };
      }
      const listed = new Set();
      for (const { raw } of linksIn(blankCode(source.read(index)))) {
        const target = linkTarget(index, raw);
        if (target !== null) listed.add(target);
      }
      // Walk up to, but not into, the index's own folder: a link to that
      // folder (or above it) would list every doc and check nothing.
      const home = dirname(index);
      let at = file;
      while (at && at !== home && at !== '.') {
        if (listed.has(at)) return { found: 0, hits: [] };
        at = dirname(at);
      }
      return {
        found: 1,
        hits: [{ line: 1, text: `not linked from ${index}`, key: 'unlisted' }],
      };
    },
  },

  /** Lines that mention a forbidden string (DOC-SESSION: a gitignored folder). */
  cite: {
    validate(rule) {
      if (typeof rule.match.text !== 'string' || rule.match.text === '') {
        throw new Error(
          `rule ${rule.id}: match.text must be a non-empty string`
        );
      }
    },
    file(rule, _file, text) {
      const { lineOf, textOf } = lineIndex(text);
      const hits = [];
      // One hit per citation, so a second one added to a line already pinned
      // is seen: its token is the key.
      let at = text.indexOf(rule.match.text);
      while (at !== -1) {
        const line = lineOf(at);
        // Sentence punctuation and markdown emphasis are not part of the path,
        // so rewording the prose around a pinned citation keeps its key.
        const token = /^[^\s'"`)\]>]*/
          .exec(text.slice(at))[0]
          .replace(/[.,;:!?*_]+$/, '');
        hits.push({ line, text: textOf(line).slice(0, 160), key: token });
        at = text.indexOf(rule.match.text, at + rule.match.text.length);
      }
      return { found: hits.length, hits };
    },
  },

  /** A file's word count (whitespace-separated), against a per-file budget. */
  'word-count': {
    unit: 'words',
    validate(rule) {
      const { budgets, defaultBudget } = rule.match;
      if (!Number.isInteger(defaultBudget) || typeof budgets !== 'object') {
        throw new Error(
          `rule ${rule.id}: match needs budgets and an integer defaultBudget`
        );
      }
    },
    defaultAllowed: (rule, file) =>
      rule.match.budgets[file] ?? rule.match.defaultBudget,
    // Claude Code loads a CLAUDE.md's `@path` imports into the same session
    // (relative to the importing file, up to 5 hops), so their words count
    // against the importer's budget: moving text into an import saves nothing.
    file(_rule, file, text, { source }) {
      const words = (t) => t.split(/\s+/).filter(Boolean).length;
      const seen = new Set([file]);
      let found = 0;
      const count = (at, body, depth) => {
        found += words(body);
        if (depth === MAX_IMPORT_HOPS) return;
        for (const path of claudeImports(body)) {
          // `~/` and `/` name files outside the repository (S4 outside).
          if (/^[~/]/.test(path)) continue;
          const target = normalise(`${dirname(at)}/${path}`);
          if (!source?.has(target) || seen.has(target)) continue;
          seen.add(target);
          count(target, source.read(target), depth + 1);
        }
      };
      count(file, text, 0);
      return { found, hits: [] };
    },
  },
  /**
   * Two lists that can't be derived from one another must agree: every item a
   * rule NEEDS (with the file and line that needs it) must be in the list it
   * HAS for the same group. "If a list can't be derived, make the build fail
   * when the lists disagree" (pstack). The rule supplies both extractors, so a
   * new pair of lists is a registry entry, not a new kind.
   *
   *   need(source, subjects) -> [{ group, item, file, line, text }]
   *   have(source, subjects) -> Map<group, { file, items: Set<item> }>
   */
  'lists-agree': {
    validate(rule) {
      if (
        typeof rule.match.need !== 'function' ||
        typeof rule.match.have !== 'function'
      ) {
        throw new Error(
          `rule ${rule.id}: lists-agree needs need() and have() functions`
        );
      }
    },
    whole(rule, { source, subjects }) {
      const have = rule.match.have(source, subjects);
      const out = new Map();
      for (const need of rule.match.need(source, subjects)) {
        const list = have.get(need.group);
        if (list?.items.has(need.item)) continue;
        const entry = out.get(need.file) ?? { found: 0, hits: [] };
        entry.found += 1;
        entry.hits.push({
          line: need.line,
          text: `${need.text}: ${need.item} is missing from ${list?.file ?? `${need.group} (no list found)`}`,
          key: need.item,
        });
        out.set(need.file, entry);
      }
      return out;
    },
  },
  /**
   * A generated file equals what its generator renders now. The hit is the
   * first line that differs, so the message points at the drift.
   */
  generated: {
    validate(rule) {
      const { file, render } = rule.match;
      if (typeof file !== 'string' || typeof render !== 'function') {
        throw new Error(
          `rule ${rule.id}: generated needs a file and a render() function`
        );
      }
    },
    whole(rule, { source }) {
      const { file, render } = rule.match;
      const want = render();
      if (!source.has(file)) {
        return new Map([
          [
            file,
            {
              found: 1,
              hits: [{ line: 1, text: `${file} is missing`, key: 'missing' }],
            },
          ],
        ]);
      }
      const have = source.read(file);
      if (have === want) return new Map([[file, { found: 0, hits: [] }]]);
      const a = have.split('\n');
      const b = want.split('\n');
      let line = 0;
      while (line < a.length && line < b.length && a[line] === b[line])
        line += 1;
      return new Map([
        [
          file,
          {
            found: 1,
            hits: [
              {
                line: line + 1,
                text: `differs from the registry from here: ${JSON.stringify((a[line] ?? '').slice(0, 80))}`,
                key: 'drift',
              },
            ],
          },
        ],
      ]);
    },
  },
};
