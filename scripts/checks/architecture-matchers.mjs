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
import { tokenize } from './check-data-access-contract.mjs';

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

/** Normalise `a/b/../c/./d` without touching the filesystem. */
function normalise(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
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
  const blank = (code) => code.replace(/[^\n]/g, ' ');
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

const LINK = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

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
function isPlaceholderPath(path) {
  return (
    /[*<{[]/.test(path) || path.includes('/my-') || path.includes('paraglide')
  );
}

export const MATCHERS = {
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
    file(rule, _path, text) {
      const { code } = tokenize(text);
      const { lineOf, textOf } = lineIndex(text);
      const hits = [];
      for (const m of code.matchAll(globalCopy(rule.match.pattern))) {
        const line = lineOf(m.index);
        hits.push({ line, text: textOf(line) });
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
          });
        } else {
          const deps = Object.keys({
            ...pkg.dependencies,
            ...pkg.peerDependencies,
          }).filter((d) => d.startsWith('@codex/'));
          for (const dep of deps) {
            const depLayer = layerOf.get(dep);
            let problem = null;
            if (depLayer === undefined) {
              problem = 'is not in the layer map (an app, or a new package)';
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
              hits.push({ line: lineOfKey(dep), text: `"${dep}" ${problem}` });
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
      for (const m of body.matchAll(LINK)) {
        const target = linkTarget(file, m[1]);
        if (target === null || resolves(source, target)) continue;
        hits.push({
          line: lineOf(m.index),
          text: `(${m[1]}) does not resolve`,
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
        if (isPlaceholderPath(path)) continue;
        if (source.has(path) || bases.some((b) => source.has(`${b}/${path}`)))
          continue;
        hits.push({ line: lineOf(m.index), text: `${path} does not exist` });
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
          hits: [{ line: 1, text: `${index} does not exist` }],
        };
      }
      const listed = new Set();
      for (const m of blankCode(source.read(index)).matchAll(LINK)) {
        const target = linkTarget(index, m[1]);
        if (target !== null) listed.add(target);
      }
      let at = file;
      while (at) {
        if (listed.has(at)) return { found: 0, hits: [] };
        at = dirname(at);
      }
      return {
        found: 1,
        hits: [{ line: 1, text: `not linked from ${index}` }],
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
      let at = text.indexOf(rule.match.text);
      let lastLine = 0;
      while (at !== -1) {
        const line = lineOf(at);
        if (line !== lastLine)
          hits.push({ line, text: textOf(line).slice(0, 160) });
        lastLine = line;
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
    file(_rule, _file, text) {
      const words = text.split(/\s+/).filter(Boolean).length;
      return { found: words, hits: [] };
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
          [file, { found: 1, hits: [{ line: 1, text: `${file} is missing` }] }],
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
              },
            ],
          },
        ],
      ]);
    },
  },
};
