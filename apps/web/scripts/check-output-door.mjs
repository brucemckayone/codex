#!/usr/bin/env node
/**
 * Output-door gate: a ShaderHero renderer reaches "the screen" only through
 * `bindOutput(gl)` in ShaderHero/output-target.ts.
 *
 * The defect class. Every preset ends its frame by drawing into whatever output
 * is bound. The brand shader stack's compositor (`ShaderHero/compositor/`)
 * renders a preset into its own scene framebuffer, attached through
 * `setOutputTarget`; every renderer that comes back with `bindOutput(gl)` draws
 * into it. One raw `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` would draw that
 * preset to the canvas behind the compositor's back: no error, no failing test,
 * just a wrong picture. The compositor's own frame pass detaches the target and
 * reaches the canvas through `bindOutput` too, so it needs no exception.
 *
 *   raw-null-bind  Under ShaderHero/, outside output-target.ts, a call of
 *                  `bindFramebuffer` (also `?.(`) whose first argument names
 *                  FRAMEBUFFER or DRAW_FRAMEBUFFER (any receiver: `gl.`,
 *                  `gl!.`, `gl?.`, a cast, a destructured constant) or their
 *                  enum values (0x8D40 / 36160, 0x8CA9 / 36009), and whose
 *                  second argument can be `null`, `undefined` or `void 0`
 *                  (WebIDL turns undefined into null): the whole argument or
 *                  one branch of it (`fbo ?? null`, `cond ? null : fbo`).
 *                  READ_FRAMEBUFFER is allowed: a null read target does not
 *                  change where anything draws.
 *   unscannable    A file the scanner cannot read to its end (a string,
 *                  comment, template, regex or `<script>` left open) fails:
 *                  it can't be checked. The message names the line it opened.
 *   no-door        The scanned tree has no output-target.ts, or (the real
 *                  tree) fewer than MIN_SOURCES files: the sources moved and
 *                  the gate would pass while reading nothing.
 *
 * Comments don't count. They are blanked by a small tokenizer that knows
 * strings, template literals (with `${}`) and regex literals, so a `/*` in a
 * line comment, a string or a regex cannot hide the code after it (the
 * first version of this gate stripped comments with a regex and lost the
 * rest of the file after a `// src/**\/*.ts`). A `/` is a regex after an
 * operator, an opening bracket, a keyword like `return`, or the `)` of an
 * `if`/`while`/`for`/`with`/`for await`; after a name (a property named like
 * a keyword included: `Symbol.for(k) / 2`), a number, a closing bracket or a
 * postfix `!`/`++`/`--` it divides. It reads each character once.
 *
 * A .svelte file is read by Svelte's own parser (`svelte/compiler` parse):
 * its module and instance scripts are scanned, and nothing else. Two hand-
 * written markup readers before it went blind on a `<!--` that Svelte reads
 * as text (in a script, then in an attribute above the script). A file Svelte
 * cannot parse fails as unscannable: it would not build either.
 *
 * Not checked: a target or null held in a variable (`const t = null;
 * bind(.., t)`), a call through an alias (`gl['bindFramebuffer']`,
 * `.call(gl, ...)`), markup expressions in a .svelte file (`onclick={...}`,
 * a `<svelte:head>` script), and code outside ShaderHero/.
 *
 * Scanned: apps/web/src/lib/components/ui/ShaderHero, .ts and .svelte, without
 * `__tests__/` and `*.test.ts`. `--root <dir>` (or `--root=<dir>`) scans that
 * directory instead (the node:test suite points it at fixture trees). Any
 * other argument exits 2. Exported (`collectViolations`, `blankComments`,
 * `scanSource`) for the tests; `main()` runs only as the CLI entrypoint.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { isEntrypoint } from '../../../scripts/checks/is-entrypoint.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HERO_DIR = join(WEB_ROOT, 'src/lib/components/ui/ShaderHero');
/** The one file allowed to bind null: the door itself. */
const DOOR = 'output-target.ts';
/** The real tree has 66 sources; fewer than this means they moved. */
const MIN_SOURCES = 20;
/** After the `)` of one of these, a `/` starts a regex (`if (x) /re/.test(x)`). */
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'with']);

/**
 * After one of these (or nothing), a `/` starts a regex, not a division. The
 * spread `...` is one token here: `[.../re/.exec(s)]`.
 */
const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^', '...']);
const REGEX_AFTER_WORDS = new Set([
  'return',
  // `export default /re/`; a property named `default` is a name (dotted).
  'default',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

/** `text` with every character but a newline turned into a space. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/** A character that continues a JS name: `π` and `ä` as well as `\w`. */
const NAME_CHAR = /[\p{ID_Continue}$\u200c\u200d]/u;

/**
 * The source with its comments blanked (same length, newlines kept, so an
 * offset in the result is an offset in the file). Strings, template
 * literals and regex literals are kept as they are. Returns `{ code, open,
 * at }`: `open` names what was still open at the end of the file (a string,
 * a comment, a template, a regex), or null, and `at` is where it opened.
 */
export function blankComments(source) {
  let out = '';
  let i = 0;
  // The last significant token, to tell a regex from a division.
  let prev = '';
  // The name just read, if only space or comments followed it; whether a `.`
  // came before it (`Symbol.for` is a property, not a keyword); and the name
  // before it (`for await`). Kept as the scan goes, so each character is read
  // once: re-reading the output for the last word made a scan quadratic.
  let word = '';
  let dotted = false;
  let before = '';
  let inWord = false;
  // A line break since the last token. JS and TypeScript take no postfix
  // `!`, `++` or `--` across one, so `a\n!/re/.test(s)` starts with a prefix
  // not, and a regex follows it.
  let newline = false;
  // Brace depth of each `${` we are inside, innermost last.
  const templates = [];
  let braces = 0;
  // For each open `(`: whether it is an `if`/`while`/`for`/`with` condition.
  const parens = [];
  // Where the last template literal opened, for the unscannable message.
  let templateAt = 0;
  const n = source.length;

  /** A token that is not a name: no word stands before what follows. */
  const endToken = () => {
    word = '';
    before = '';
    dotted = false;
    inWord = false;
    newline = false;
  };
  /** The name just read is a keyword (not a property named like one). */
  const keyword = () => !dotted && REGEX_AFTER_WORDS.has(word);
  // Whether the last token ends an operand (a name that is not a keyword, a
  // closing bracket) on this line: what a postfix `!`, `++` or `--` needs.
  const operand = () =>
    !newline && (prev === ')' || prev === ']' || (prev === 'x' && !keyword()));

  // Scan a template literal body from `i` (just past its opening backtick or
  // a closing `}` of `${}`) to its end or its next `${`.
  const templateBody = () => {
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        out += c;
        i++;
        return 'closed';
      }
      if (c === '$' && source[i + 1] === '{') {
        out += '${';
        i += 2;
        templates.push(braces);
        braces = 0;
        return 'expr';
      }
      out += c;
      i++;
    }
    return 'eof';
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(source.slice(i, stop));
      i = stop;
      inWord = false;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1)
        return {
          code: out + blank(source.slice(i)),
          open: 'block comment',
          at: i,
        };
      out += blank(source.slice(i, end + 2));
      if (source.slice(i, end + 2).includes('\n')) newline = true;
      i = end + 2;
      inWord = false;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      if (j >= n || source[j] !== c)
        return { code: out + source.slice(i), open: 'string', at: i };
      out += source.slice(i, j + 1);
      i = j + 1;
      prev = 'x';
      endToken();
      continue;
    }
    if (c === '`') {
      templateAt = i;
      out += c;
      i++;
      endToken();
      const state = templateBody();
      if (state === 'eof')
        return { code: out, open: 'template', at: templateAt };
      prev = state === 'closed' ? 'x' : '{';
      continue;
    }
    // A postfix `!` (TypeScript's non-null), `++` or `--` after an operand
    // leaves an operand: `w! / 2` and `i++ / 2` divide.
    if (c === '!' && next !== '=' && operand()) {
      out += c;
      i++;
      endToken();
      continue;
    }
    if ((c === '+' || c === '-') && next === c && operand()) {
      out += c + c;
      i += 2;
      endToken();
      continue;
    }
    if (c === '.' && next === '.' && source[i + 2] === '.') {
      out += '...';
      i += 3;
      prev = '...';
      endToken();
      continue;
    }
    if (c === '(') {
      parens.push(
        !dotted &&
          (CONTROL_WORDS.has(word) || (word === 'await' && before === 'for'))
      );
      out += c;
      i++;
      prev = c;
      endToken();
      continue;
    }
    if (c === ')') {
      // The `)` of an `if (…)` ends a condition, not an operand.
      const control = parens.pop() ?? false;
      out += c;
      i++;
      prev = control ? ';' : ')';
      endToken();
      continue;
    }
    if (c === '/') {
      // After an operator, an opening bracket, or a keyword like `return`, a
      // `/` starts a regex; after a name, a number or a closing bracket it
      // divides.
      const isRegex =
        prev === '' || REGEX_AFTER.has(prev) || (prev === 'x' && keyword());
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && source[j] !== '\n') {
          const d = source[j];
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          j++;
        }
        if (j >= n || source[j] !== '/')
          return { code: out + source.slice(i), open: 'regex', at: i };
        j++;
        while (j < n && /[a-z]/i.test(source[j])) j++;
        out += source.slice(i, j);
        i = j;
        prev = 'x';
        endToken();
        continue;
      }
    }
    if (c === '{') braces++;
    if (c === '}') {
      if (braces === 0 && templates.length > 0) {
        // The end of a `${}`: back into the template it came from.
        braces = templates.pop();
        out += c;
        i++;
        endToken();
        const state = templateBody();
        if (state === 'eof')
          return { code: out, open: 'template', at: templateAt };
        prev = state === 'closed' ? 'x' : '{';
        continue;
      }
      braces--;
    }
    // One code point: a name may hold a character outside the BMP.
    const ch = String.fromCodePoint(source.codePointAt(i) ?? 0);
    out += ch;
    i += ch.length;
    if (NAME_CHAR.test(ch)) {
      if (!inWord) {
        before = word;
        // After `.` or `#` (`this.#delete`) a name is a property, never a
        // keyword.
        dotted = prev === '.' || prev === '#';
        word = ch;
        newline = false;
      } else word += ch;
      inWord = true;
      prev = 'x';
    } else if (/\s/.test(ch)) {
      inWord = false;
      if (ch === '\n') newline = true;
    } else {
      prev = c;
      endToken();
    }
  }
  if (templates.length > 0)
    return { code: out, open: 'template', at: templateAt };
  return { code: out, open: null, at: 0 };
}

/**
 * A .svelte file as code: its module and instance scripts, as Svelte's own
 * parser finds them, kept; everything else blanked with its newlines kept.
 * Returns `{ code }`, or `{ error }` when Svelte cannot parse the file.
 */
function svelteScripts(source) {
  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch (err) {
    const at = Array.isArray(err?.position) ? err.position[0] : 0;
    const why = String(err?.message ?? err).split('\n')[0];
    return {
      error: `Svelte cannot parse it at line ${lineOf(source, at)} (${why}), so it would not build either`,
    };
  }
  let code = blank(source);
  for (const script of [ast.module, ast.instance]) {
    if (!script) continue;
    const { start, end } = script.content;
    code = code.slice(0, start) + source.slice(start, end) + code.slice(end);
  }
  return { code };
}

/** Why a file cannot be scanned, naming the line the open thing started on. */
function describeOpen(text, { open, at }) {
  const hint = open === 'regex' ? ' (a division read as a regex?)' : '';
  return `a ${open} opened at line ${lineOf(text, at)} is never closed${hint}`;
}

/** The argument texts of the call whose `(` is at `open`, or null if unclosed. */
function callArguments(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        args.push(code.slice(start, i));
        return args
          .map((a) => a.trim())
          .filter((a, k, all) => a !== '' || k < all.length - 1);
      }
    } else if (c === ',' && depth === 1) {
      args.push(code.slice(start, i));
      start = i + 1;
    } else if ((c === "'" || c === '"' || c === '`') && depth > 0) {
      // A string argument: skip it so a comma or paren inside it is not read.
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      i = j;
    }
  }
  return null;
}

const DRAW_TARGET =
  /(?<![\w$])(?:DRAW_)?FRAMEBUFFER\b|^\s*\(?\s*(?:0x8d40|36160|0x8ca9|36009)\b/i;
/** A null anywhere in the target: the whole argument or one branch of it. */
const NULL_TARGET = /(?<![\w$.])(?:null|undefined|void\s+0)(?![\w$])/;

function lineOf(code, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (code[i] === '\n') line++;
  return line;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules')
        walk(full, files);
    } else if (
      /\.(ts|svelte)$/.test(entry.name) &&
      !/\.test\.ts$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Scan one file's text. `name` decides .svelte handling. */
export function scanSource(name, source) {
  let text = source;
  if (name.endsWith('.svelte')) {
    const read = svelteScripts(source);
    if (read.error) return { violations: [], unscannable: read.error };
    text = read.code;
  }
  const blanked = blankComments(text);
  if (blanked.open)
    return { violations: [], unscannable: describeOpen(text, blanked) };
  const { code } = blanked;
  const violations = [];
  for (const m of code.matchAll(/\bbindFramebuffer\s*(?:\?\.\s*)?\(/g)) {
    const args = callArguments(code, m.index + m[0].length - 1);
    if (!args || args.length < 2) continue;
    if (DRAW_TARGET.test(args[0]) && NULL_TARGET.test(args[1])) {
      violations.push({
        line: lineOf(code, m.index),
        call: `bindFramebuffer(${args.slice(0, 2).join(', ')})`.replace(
          /\s+/g,
          ' '
        ),
      });
    }
  }
  return { violations, unscannable: null };
}

/**
 * Every raw null bind under `heroDir`. Returns `{ violations, unscannable,
 * filesScanned, doorFound }`, each violation `{ file, line, call }` with
 * `file` relative to `heroDir`.
 */
export function collectViolations({ heroDir = HERO_DIR } = {}) {
  const violations = [];
  const unscannable = [];
  let filesScanned = 0;
  let doorFound = false;
  for (const full of walk(heroDir)) {
    const file = relative(heroDir, full).split(sep).join('/');
    if (file === DOOR) {
      doorFound = true;
      continue;
    }
    filesScanned++;
    const result = scanSource(file, readFileSync(full, 'utf8'));
    for (const v of result.violations) violations.push({ file, ...v });
    if (result.unscannable)
      unscannable.push({ file, reason: result.unscannable });
  }
  return { violations, unscannable, filesScanned, doorFound };
}

function parseArgs(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) root = argv[++i];
    else if (a.startsWith('--root=')) root = a.slice('--root='.length);
    else return { error: `unknown argument: ${a}` };
  }
  return { root };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`check-output-door: ${args.error}`);
    process.exit(2);
  }
  const heroDir = args.root ? resolve(args.root) : HERO_DIR;
  const { violations, unscannable, filesScanned, doorFound } =
    collectViolations({ heroDir });
  // A tree with no door, or a real tree that shrank, is the wrong tree: the
  // gate would print OK while reading nothing that renders.
  const tooFew = !args.root && filesScanned < MIN_SOURCES;
  if (!doorFound || tooFew) {
    console.error(
      `check-output-door: ${doorFound ? `only ${filesScanned} source(s)` : `no ${DOOR}`} under ${heroDir}. ` +
        'The ShaderHero sources moved: point HERO_DIR in apps/web/scripts/check-output-door.mjs at them (or, after a cull, lower MIN_SOURCES).'
    );
    process.exit(1);
  }
  for (const u of unscannable)
    console.error(`ShaderHero/${u.file}: cannot scan (${u.reason})`);
  for (const v of violations)
    console.error(`ShaderHero/${v.file}:${v.line}  ${v.call}`);
  if (violations.length > 0 || unscannable.length > 0) {
    console.error(
      `\n${violations.length} raw null framebuffer bind(s), ${unscannable.length} unscannable file(s). ` +
        'A renderer reaches the screen through bindOutput(gl) from ShaderHero/output-target.ts: ' +
        "a null bind draws to the canvas behind the Showreel compositor's back. " +
        'See the header of apps/web/scripts/check-output-door.mjs.'
    );
    process.exit(1);
  }
  console.log(
    `OK: no raw null framebuffer bind in ${filesScanned} ShaderHero source(s).`
  );
}

if (isEntrypoint(import.meta.url)) main();
