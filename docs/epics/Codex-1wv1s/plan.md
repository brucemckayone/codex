# L1: the rules the lesson sweep found

## Context
- **Where it sits:** after L0 (Codex-rmqfr), which sorted every lesson onto the mechanism ladder in `docs/lessons.md`.
- **What L1 builds:** each row whose home is `todo:Codex-1wv1s "what"` names a rule, test, hook, type or seam that would hold the lesson by machine. L1 builds those homes and points each row at what it built.
- **Why it can't rot:** WF-LESSON resolves a `todo:` home only while this epic is live. At L1's retro, every todo still in the ledger fails CI.
- **Shape:** one list, grouped by mechanism, not a bead per lesson (owner, 25 Nov).

## Work packages

### WP-0: the list (written by L0 WP-3)
- **What:** L0's WP-3 replaces this block with one WP per mechanism:
  - GritQL/biome plugin rules;
  - literal and schema checks;
  - PreToolUse hooks;
  - contract tests;
  - arch and type items.

  Each WP lists its ledger rows, and the WPs are ordered by the ledger's counts and by what each lesson cost.
- Files: `docs/epics/Codex-1wv1s/plan.md`
- Verify: `node scripts/checks/check-architecture.mjs` (WF-EPIC lints this plan)
- Pass when: every `todo:Codex-1wv1s` row in `docs/lessons.md` sits in exactly one WP of this plan.
