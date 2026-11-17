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
function lineIndex(text) {
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
};
