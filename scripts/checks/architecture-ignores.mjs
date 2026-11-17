/**
 * Inline exceptions for the architecture gate, and they EXPIRE (G0 WP-7,
 * Codex-xtcfl.7).
 *
 * pstack's correction skill: "Exceptions go on the offending line with a
 * reason, an expiry date, and a human's approval." This repo's suppressions
 * live forever, so an exception granted for one urgent fix quietly becomes the
 * rule. Here a directive on the line ABOVE a hit names one rule, a date, an
 * owner and a reason, and the gate fails:
 *   - once the date has passed (the exception was temporary by definition),
 *   - when it suppresses nothing (the code moved; the exception must go too),
 *   - when it is malformed or names a rule the registry doesn't define.
 * The exact syntax is documented in docs/architecture/rules.md#exceptions.
 *
 * Only line-level violations can be excepted. A measuring rule (SIZE,
 * DOC-BUDGET) has no offending line, so its exceptions are baseline counts.
 *
 * The keyword is assembled from parts throughout, so this file, its test and
 * the generated rules page are never read as directives themselves.
 */
import { blankCode } from './architecture-matchers.mjs';

export const IGNORE_KEYWORD = ['arch', 'ignore'].join('-');

/** A directive is a comment line: `//`, `#`, `/*`, a JSDoc `*`, or `<!--`. */
const DIRECTIVE = new RegExp(
  `^\\s*(?://|#|/\\*+|\\*|<!--)\\s*${IGNORE_KEYWORD}\\b(.*)$`
);

const FIELDS =
  /^\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\s+until=(\d{4}-\d{2}-\d{2})\s+by=(\S+)\s+(?:—|-{1,2})\s+(\S.*?)\s*(?:\*\/|-->)?\s*$/;

/**
 * Every directive in a file. In markdown only the `<!-- -->` form counts, and
 * code fences and spans are blanked first, so a documented example is not a
 * directive.
 *
 * @returns {{ file: string, line: number, ok: boolean, ruleId?: string,
 *   until?: string, by?: string, reason?: string, raw?: string,
 *   used?: boolean }[]}
 */
export function parseIgnores(file, text) {
  const isMarkdown = file.endsWith('.md');
  const lines = (isMarkdown ? blankCode(text) : text).split('\n');
  const found = [];
  lines.forEach((line, i) => {
    const m = DIRECTIVE.exec(line);
    if (!m) return;
    if (isMarkdown && !/^\s*<!--/.test(line)) return;
    const f = FIELDS.exec(m[1]);
    found.push(
      f
        ? {
            file,
            line: i + 1,
            ok: true,
            ruleId: f[1],
            until: f[2],
            by: f[3],
            reason: f[4],
            used: false,
          }
        : { file, line: i + 1, ok: false, raw: line.trim() }
    );
  });
  return found;
}

/**
 * Drop the hits a valid directive on the line above excuses, marking each
 * directive that did. Returns the remaining hits.
 */
export function applyIgnores(ruleId, hits, directives) {
  if (!directives || hits.length === 0) return hits;
  return hits.filter((hit) => {
    const excuse = directives.find(
      (d) => d.ok && d.ruleId === ruleId && d.line === hit.line - 1
    );
    if (!excuse) return true;
    excuse.used = true;
    return false;
  });
}

/**
 * The problems with the directives themselves.
 *
 * @param {Map<string, ReturnType<typeof parseIgnores>>} directivesByFile
 * @param {{ ranOn: (ruleId: string, file: string) => boolean,
 *   known: Set<string>, measuring: Set<string>, today: string }} ctx
 */
export function ignoreProblems(directivesByFile, ctx) {
  const problems = [];
  const push = (d, why) =>
    problems.push({
      type: 'ignore',
      ruleId: d.ruleId ?? '?',
      file: d.file,
      line: d.line,
      why,
    });
  for (const directives of directivesByFile.values()) {
    for (const d of directives) {
      if (!d.ok) {
        push(
          d,
          `malformed ${IGNORE_KEYWORD}: it needs a rule ID, until=YYYY-MM-DD, by=<owner> and "— <reason>"`
        );
      } else if (!ctx.known.has(d.ruleId)) {
        push(d, `names rule ${d.ruleId}, which the registry doesn't define`);
      } else if (ctx.measuring.has(d.ruleId)) {
        push(
          d,
          `${d.ruleId} measures a whole file, so it can't be excepted inline; its baseline count is the exception`
        );
      } else if (d.until < ctx.today) {
        push(
          d,
          `expired on ${d.until} (granted by ${d.by}). Fix the violation, or renew the date with a fresh reason`
        );
      } else if (!d.used && ctx.ranOn(d.ruleId, d.file)) {
        push(d, `excuses no ${d.ruleId} violation on the next line; remove it`);
      }
    }
  }
  return problems;
}
