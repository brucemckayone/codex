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
};
