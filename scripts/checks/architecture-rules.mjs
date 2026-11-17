/**
 * The architecture gate's rule registry (G0, Codex-xtcfl). DATA, not prose:
 * `check-architecture.mjs` runs these entries, and `docs/architecture/rules.md`
 * is generated from them, so a rule can't live only in a doc and a doc can't
 * describe a rule that doesn't run.
 *
 * An entry:
 *   id     A1, LAYERS, DOC-LINK… The same ID appears in the runner's output,
 *          the baseline, the rules page and any CLAUDE.md citation, so
 *          searching it finds the rule, its check and its doc.
 *   title  One line, stated as the invariant.
 *   why    Why the rule exists, for the rules page.
 *   scope  { include, exclude } repo-relative globs (default: every file).
 *   match  { kind, ... }: a kind from architecture-matchers.mjs.
 *   fix    The one fix an agent should apply, shown in every failure.
 */
export const RULES = [];
