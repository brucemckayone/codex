# L0: the lesson sweep (sort every lesson onto the mechanism ladder, ledger in git, memory shrinks)

> **Changed in implementation (2026-11-25).**
> - **WP-1 creates `docs/lessons.md`**, seeded with four rows that CI already holds. The rule's scope names the file, and the generated rules page then cites it, so DOC-PATH needs the file to exist. WP-1 also links it from `docs/README.md`.
> - **The verdict explainer in the retro template is a list, not a table.** The first table under `## Lessons` is the lessons table.
> - **Completeness rule, revised.** A source must appear in at least one row. One memory file can hold several lessons, so "0 doubled sources" was wrong. A memory file can be deleted only when every row naming it has a home other than `todo:` or `prose-only:`.

## Context
- **Where it sits:** step 4 of G0 → D1 → W0 → **L0** → G1. Owner 2026-11-25: "Start L0 planning now".
- **The problem:** about 510 lesson sources live outside CI, so most are advice:
  - 385 feedback memories, 61 reference memories, 66 bd memories, and the root CLAUDE.md's 23 MUST/NEVER rules;
  - 246k words of memory in all;
  - MEMORY.md sits at its hard read limit, so the tail of the index goes silently unread.
- **Page 6's sample (16 Nov):** 11 of 15 lessons could be held by a machine, and only 2 genuinely need judgement.
- **The outcome:**
  - every lesson sits on one rung of the ladder, with a home CI can resolve, or a pending home tied to one live follow-up epic;
  - the memory store shrinks to what really is judgement.
- **Builds on W0's WF-LESSON** (`scripts/checks/workflow-lessons.mjs`), which already proves a retro's homes resolve. L0 widens it to one ledger.

## Decisions
| Decision | Choice | Source |
|---|---|---|
| What L0 delivers | Sort, ledger, and memory shrink. Every arch/type/rule/test/hook verdict goes to ONE follow-up epic, L1, as one list grouped by mechanism, not a bead per lesson | owner 25 Nov; page 6 |
| Where the ledger lives | `docs/lessons.md`, one table checked by WF-LESSON, with a pending home `todo:<epic-id> "what"` that resolves only while that epic is live | owner 25 Nov |
| Memory after sorting | Delete each memory file, and `bd forget` each key, whose rows all have real homes, after the owner approves the list. Prose-only and todo lessons stay. MEMORY.md is re-indexed | owner 25 Nov |
| Who sorts | 3 agents in parallel, each with a third. I merge and dedupe; WF-LESSON proves the homes; the owner reviews a local page grouped by verdict | owner 25 Nov |
| The ladder | arch, type, rule, test, hook, plus `already` (something in git holds it today) and `prose-only`, which must say why each stronger rung failed | page 6 (16 Nov) + page 7 (17 Nov) |
| Project memories (78) | Out of the sweep: they hold epic state, not lessons | follows from the sources |

## The ledger (`docs/lessons.md`)
```
## Lessons
| Lesson | Verdict | Home | Source |
|---|---|---|---|
| VersionedCache without waitUntil loses every write | rule | todo:Codex-<L1> "new VersionedCache({…}) with no waitUntil" | mem:feedback_…, bd:… |
| Fix the shared component, not the page | already | rule:DIALOG-STRUCTURE | mem:feedback_fix_the_shared_component… |
| Never fan out studio route loads | prose-only | prose-only: arch: …; type: …; rule: …; test: …; hook: … | mem:feedback_dont_fan_out… |
```
- **Verdict:** one of `arch`, `type`, `rule`, `test`, `hook`, `already` or `prose-only`. The same words replace the retro template's free text.
- **Verdict and Home agree:**
  - `prose-only` takes a `prose-only:` home;
  - `already` takes a real home (`rule:`, `test:`, `adr:`, `skill:`, `claude-md:`);
  - a ladder verdict takes a machine home once built (`rule:`, `test:`, `adr:` for arch), or `todo:` until then.
- **`todo:<epic-id> "what"`** resolves only while `docs/epics/<epic-id>/epic.md` exists and is not retro-done or abandoned. At L1's retro, every leftover todo fails CI, so the list can't rot.
- **Source** names every memory file (`mem:`), bd key (`bd:`) or `CLAUDE.md` the row stands for. A duplicate lesson is one row with several sources. Source drives the shrink.
- **Outside CI** (it goes in spec S11):
  - whether every memory lesson has a row: memory lives outside git, so a local completeness script checks that once, in WP-2;
  - whether a verdict is right: the owner reviews.

## Work packages (one epic, ONE PR; branch `feat/Codex-rmqfr-lesson-sweep` off W0's branch; the PR opens after W0 merges, then merge dev in, never rebase)

### WP-1: the ledger format in WF-LESSON
- **What:**
  - WF-LESSON's scope widens to `docs/lessons.md`, which WP-1 creates with four seed rows;
  - a `todo:` home kind;
  - the verdict vocabulary, and verdict/home agreement;
  - an optional Source column;
  - the retro template's Verdict column uses the vocabulary;
  - spec S11 widened (holds and outside);
  - FIRES and tests.
- Files: `scripts/checks/workflow-lessons.mjs`, `scripts/checks/workflow-epic.mjs`, `scripts/checks/architecture-rules.mjs`, `scripts/checks/architecture-spec.mjs`, `scripts/checks/check-architecture.test.mjs`, `docs/epics/_template/retro.md`, `.claude/skills/codex-epic-retro/SKILL.md`, `docs/lessons.md`, `docs/README.md`, `docs/architecture/rules.md` (generated)
- Verify: `node --test scripts/checks/check-architecture.test.mjs`; `node scripts/checks/check-architecture.mjs`
- Pass when:
  - each of these fails:
    - a todo pointing at a missing epic;
    - a todo pointing at a retro-done epic;
    - a verdict outside the vocabulary;
    - `prose-only` with a `rule:` home;
    - `already` with a todo;
  - a valid ledger passes;
  - the self-test is green.

### WP-2: the sweep
- **Steps:**
  1. Create the L1 epic first (bead id only), so todo rows can name it.
  2. Build the inventory each agent gets:
     - the ladder;
     - RULES and GATES ids and titles;
     - the biome rules in force;
     - the test and check scripts;
     - the skills list;
     - CLAUDE.md MUST/NEVERs;
     - the ledger's existing rows.
  3. 3 general-purpose agents each sort a third of the ~510 sources into rows, written to their own scratch folders. They are read-only on the repo and on memory, and are told about the RECURRED duplicates and the doc rules a row must pass:
     - DOC-PATH: a cited repo path exists;
     - DOC-SESSION: no session-notes path.
  4. Merge, and dedupe repeats into one row with several sources.
  5. Write `docs/lessons.md`.
  6. Run WF-LESSON until green.
- Files: `docs/lessons.md`
- Verify:
  - `node scripts/checks/check-architecture.mjs`;
  - a local completeness script (scratchpad) checks every source file and bd key appears in at least one row's Source.
- Pass when:
  - WF-LESSON is green on the ledger;
  - the completeness script reports 0 missing sources;
  - every todo names the L1 epic.

### WP-3: the L1 epic (one list, grouped by mechanism)
- **What:**
  - `docs/epics/<L1>/epic.md` (planned) and `plan.md`;
  - WPs grouped by mechanism, not by lesson: GritQL/biome plugin rules, literal and schema checks, PreToolUse hooks, contract tests, and the arch/type items;
  - each WP lists its ledger rows, with Files, Verify and Pass when;
  - a bd epic with one bead per WP, not per lesson;
  - priority from the ledger's counts and the cost of what each lesson caught.
- Files: `docs/epics/<L1>/epic.md`, `docs/epics/<L1>/plan.md`
- Verify: `node scripts/checks/check-architecture.mjs` (WF-EPIC lints the plan)
- Pass when:
  - every todo row in the ledger is in exactly one L1 WP;
  - WF-EPIC is green.

### WP-4: the owner's review
- **What:** a local gitignored page in the session-notes folder, listed in its pricing-sources index:
  - counts per verdict, with rows grouped by verdict;
  - the prose-only reasons in full;
  - the deletion list (memory files and bd keys whose every row has a real home);
  - filters.

  The owner corrects rows in chat, and I apply the corrections and re-run WF-LESSON.
- Files: the local page (gitignored); `docs/lessons.md` (corrections)
- Verify: the page title and port are checked before sharing the link; WF-LESSON is green after the corrections
- Pass when: the owner approves the ledger and the deletion list.

### WP-5: ship
- **Steps:**
  1. codex-review: one round, since this is tooling, with the tally in the PR body.
  2. The PR opens after W0 merges and the slot is free.
  3. Merge dev in.
  4. The full gate.
  5. **The owner countersigns** the gate-edit lines.
- Files: the PR body
- Verify: CI green on both static-analysis and pr-rules
- Pass when: merged to dev.

### WP-6: the memory shrink (after merge)
- **Steps:**
  1. Back up first: a tarball of the memory dir and `bd memories` output in `~/.claude/projects/-Users-brucemckay-development-Codex/memory-archive/<date>/`.
  2. Delete the approved memory files.
  3. `bd forget` the approved keys.
  4. Re-index MEMORY.md and the topic files.
- Files: memory dir (outside git); bd memories
- Verify:
  - the backup restores (list its contents);
  - every MEMORY.md link resolves;
  - no deleted file's lesson is missing from the ledger (the completeness script, re-run).
- Pass when:
  - only prose-only and todo lessons remain in memory;
  - MEMORY.md is under its read limit.

## Verification (end to end)
- `node --test scripts/checks/check-architecture.test.mjs` is green, with new fixtures for the todo home and verdict agreement.
- `check-architecture.mjs` is green with `docs/lessons.md` in WF-LESSON's scope.
- The completeness script reports 0 missing sources against all ~510.
- A planted todo pointing at L1, after L1 is moved to retro-done in a scratch copy, fails WF-LESSON.
- After the shrink, MEMORY.md is under its read limit and the backup restores.

## Out of scope
- Building any L1 rule. That is L1, built next in priority order.
- Shrinking the root CLAUDE.md, whose MUST/NEVERs get rows here. Cutting it to its 1,500-word budget once rules hold them is L1's or a later epic's.
- The 78 project memories (epic state).
- New lessons after L0. They land through retro.md tables (codex-epic-retro, W0). Agents still write memory, and CI can't see it.

## Open questions
None blocking. The L1 priority order is set in WP-3 from the ledger and shown on the WP-4 page.

## Beads
- Epic Codex-rmqfr (P1, labels `guardrails, workflow, lessons`) with children `.1` to `.6`.
- Dependencies: 1→2, 2→3, {2,3}→4, 4→5, 5→6.
- L1 is created in WP-2 as a planned epic with no WPs until WP-3.
