/**
 * What the architecture gate guarantees, and what it doesn't: the spec a
 * review judges it against (owner, 19 Nov 2026). Five review rounds without a
 * spec kept widening the guarantee, and each round's fixes grew the code the
 * next round reviewed. So:
 *
 *   - each clause states what holds and, as plainly, what is OUTSIDE it;
 *   - each clause names the self-tests that prove it, and the self-test fails
 *     when one is missing, so a claim can't outlive its proof;
 *   - a review finding is a FAILING TEST against a clause. A shape a clause
 *     puts outside is not a finding; a clause that should cover more is a
 *     spec change, which the owner decides.
 *
 * The threat model under every clause is an honest agent's eager mistake. An
 * agent that sets out to forge (dropping its attribution line, rewriting the
 * CI step that runs the gate) is not stopped by any check; review is the
 * backstop for that.
 */

export const GUARANTEES = [
  {
    id: 'S1',
    title: 'Money calls are found',
    holds:
      "In A1's scope, every member call `.transfers.create(`, `.transfers.createReversal(`, `.refunds.create(` or `.payouts.create(` is found, an optional call (`create?.(`) included: inside a template's interpolation, in a callback, split across lines, after a nested template or a regex (one that starts a line or follows a brace-less `if (…)` head too). Text in a comment, a string or a template's own text is never a call. Comments and strings are read by ONE scanner, so they can't disagree about where a template ends.",
    outside: [
      'a call through a stored reference (`const t = stripe.transfers; t.create(`) or a computed member (`stripe["transfers"]`)',
      'code biome would not accept',
    ],
    tests: [
      'A1 ignores the owner modules, tests and comments',
      'A1 sees optional chaining and a call split across lines',
      'A1 sees a money call inside an interpolation, after a nested template, and after a regex holding a quote',
      'A1 keys: a multi-line string above the call keeps its function, and a string never matches',
      'a URL in a nested template, a comment-like template or a regex at the start of a line hides no call',
      'A1 sees an optional call and a regex after a brace-less if',
    ],
  },
  {
    id: 'S2',
    title: 'A key names where its violation sits',
    holds:
      "A line-level violation's key names the function, method (a `#private` one too), class field, route or callback it sits in, read from biome's indentation, and from the violation's own line for a one-line arrow (`const pay = (p) => …`), so a fix in one named place can't pay for a new violation in another. A parenthesised value (`const paid = (await x()).map(`) and a call to a name starting `function` are no declarations. Routes are read in a worker's source only, from a registration on one name (`app.post(`) or chained (`.post(`). A misread name can only merge two keys; it never hides a violation.",
    outside: [
      'two functions with the same name in one file',
      'code biome has not formatted',
      "in a worker's source, a call shaped like a route registration on one name (`api.post('/x', …)`), which is read as a route",
    ],
    tests: [
      'a call key names its function, so a fix in one cannot pay for a call in another',
      'the enclosing name survives a multi-line signature and destructured parameters',
      'routes in the form biome writes get their own keys; a header read or a cache get names nothing',
      'a method head needs its body: a call or an arrow callback is no method',
      'a wrapped or arrow return type still names its method, and a chained, assigned or constant route names itself',
      'a key names a one-line arrow, a #private method, a parenthesised value and functionsOf(); routes are read only in a worker',
    ],
  },
  {
    id: 'S3',
    title: 'Every rate limit a route uses is read',
    holds:
      "In a worker's route files, every use of `procedure`, `multipartProcedure`, `binaryUploadProcedure` or `rateLimit` (bare, or through an `import * as` namespace of `@codex/worker-utils` or `@codex/security`) is a direct call whose options the gate reads, an object key (judged by the code before it, however far back), or an entry of an import list. Any other use fails as unreadable, and so does a dynamic `import(…)` or `require(…)` whose argument is not a quoted literal naming another module (a limiter module, a template with a substitution, a variable). A preset with no binding in every environment of the worker's wrangler.jsonc fails.",
    outside: [
      'a limiter reached through another module of this repo that re-exports it',
    ],
    tests: [
      'RATE-LIMIT-BINDING: the default preset, every env, every limiter, and what it cannot read',
      'RATE-LIMIT-BINDING fails what it cannot read, and follows what it can',
      'RATE-LIMIT-BINDING: every alias form fails; reading a property passes',
      'RATE-LIMIT-BINDING: any use but a call, a key or an import entry fails',
      'RATE-LIMIT-BINDING: a key is judged by the code before it, and a computed or template import is unreadable',
    ],
  },
  {
    id: 'S4',
    title: 'A CLAUDE.md pays for what it imports',
    holds:
      "DOC-BUDGET counts the words of every import a CLAUDE.md or AGENTS.md makes, read with Claude Code's own grammar (2.1.330: an `@` at the start of a text run or after whitespace, then every non-space character, cut at `#`; code blocks, code spans and HTML comments skipped; emphasis and a link's label read), that resolves to a tracked file relative to the importing file (any number of `./` and `../`, into a dot-folder, with or without an extension), up to 5 hops, each file once. A path keeps its punctuation, as Claude Code keeps it: `@README.` names `README.`.",
    outside: [
      'at commit time, an edit to the imported file alone: CI judges the importer',
      'an import of a file outside the repository (`@~/…`, `@/…`)',
      "an import Claude Code skips that this still counts (in a table, an HTML block or an indented code block): the budget's safe side",
    ],
    tests: [
      'DOC-BUDGET counts the words a CLAUDE.md imports',
      'DOC-BUDGET follows an import up two folders, into a dot-folder or without an extension, to 5 hops',
      'DOC-BUDGET reads imports as Claude Code does: route characters, emphasis, a full stop and a parenthesis',
    ],
  },
  {
    id: 'S5',
    title: 'Debt only shrinks',
    holds:
      "A violation whose key isn't pinned, or a size above its pin, fails. A fix fails the commit that touches its file until it is banked, and the pull request that made it. `--lower` only lowers or removes. In a pull request a file may grow no further than the base measured unless the owner signed its pin: growing into a pin above what the base measured needs the same countersign as raising it. That sign covers the pin's stale headroom, and every run lists what it covers.",
    outside: [
      'a release PR or a push to dev or main: there, unbanked fixes and growth into a stale pin are notices',
    ],
    tests: [
      'one more of a pinned key fails as more',
      'a fix cannot pay for a new violation in the same file',
      '--lower only lowers or removes; it never raises or adds',
      '--ci in a PR: a fix this change made blocks wherever it is; one dev left behind is a notice',
      '--ci in a PR: headroom a fix left unbanked on dev cannot be spent',
      'growing into a stale pin is signed like a raise, and a release PR only notes it',
      'the base copy judges growth into a stale pin, and a trunk push notes it',
    ],
  },
  {
    id: 'S6',
    title: 'What loosens the gate is a closed list',
    holds:
      "These, and only these, are loosening items: (1) a raised or added baseline pin, or growth into one (S5); (2) a new, copied, moved or renewed exception; (3) the gate's own code: every tracked file in `scripts/checks/` but the baseline, `.github/workflows/static_analysis.yml`, `.husky/pre-commit`, gate.sh, and a calling workflow's triggers, concurrency or static-analysis job; (4) what another gate runs: a file a gate command runs with node, tsx, ts-node or vite-node (also behind `VAR=value`, `env`, `cross-env`, `dotenv … --`, `time`, `nice` or `exec`, or as a `./file.mjs`), with what it imports and preloads (`--import ./x.mjs`) and its tracked `--env-file`; every pnpm script a gate command reaches, with its `pre`/`post` scripts (a bare `pnpm <name>` with no such script runs <name> as a command, as `pnpm exec` does); every task in a gate's turbo task's `dependsOn` closure, read from the root and every package `turbo.json`, at each package's `turbo.json` and as each package's script (added, changed or deleted); every workspace package's install lifecycle scripts; the root `turbo.json`; `pnpm-workspace.yaml`'s `packages:` list (in any YAML form) and its `scriptShell`, `shellEmulator`, `ignoreScripts` and `enablePrePostScripts`; `.npmrc`; `.pnpmfile.cjs`; a gate's declared `files`; and a rise in a gate's `ratchets`; (5) Biome's reach: any `biome.json`, `biome.jsonc`, `.biome.json` or `.biome.jsonc` and the local files each `extends`, and any `.gitignore` or `.ignore`, at any depth, compared at its own path (a move is a new file there), unless the change only deletes plain lines or adds `!` lines. A gate command the gate can't resolve to tracked files and scripts (a first word that is no listed leaf binary, a `NODE_OPTIONS` preload, a pnpm built-in), and a manifest it derives parts from but can't parse, are registry errors, never a pass.",
    outside: [
      'tool versions: a devDependency or lockfile bump, a patch under `patches/`, a key of pnpm-workspace.yaml but the five above',
      "a package's own tsconfig, a tool's own config (`vite.config.*`), and any other file a tool reads that this list doesn't name",
      "a package preset a Biome config extends, a symlink's target, and an env file a wrapper loads (`dotenv -e`)",
      "the allowlists inside the other gates' own scripts: they are gate files, so every edit to one asks, a shrink included",
      'CI environment variables and runner images',
    ],
    tests: [
      'a raised pin needs a G0-RAISE trailer in a commit, with a real reason',
      'a new exception and a change to the gate itself need one too',
      'a pnpm script a gate runs is part of the gate',
      'any file in the gate folder is gate code, and a gate part that is no file is a registry error',
      'what a gate runs is derived from its commands, followed as a shell would, plus what it declares',
      'a calling workflow is part of the gate only where the gate depends on it',
      'a nested biome config, a new .gitignore line or a package turbo.json is part of the gate',
      'an ignore file loosens by a new rule, a lost negation, a new order or a move; a .ignore and a .biome.json count',
      'a deleted turbo-task script, a pre/post or lifecycle script, the root turbo.json and .npmrc are gate parts',
      'a gate command the reader cannot resolve is a registry error; the forms it can are followed',
      "the command reader follows tsx, wrappers, preloads and pnpm's exec fallback; anything else is a registry error",
      'pnpm-workspace.yaml is read in every YAML form, and a manifest the gate cannot parse is a registry error',
      "every task typecheck reaches counts in every package; the workspace script settings and a Biome config's local extends are gate parts",
    ],
  },
  {
    id: 'S7',
    title: 'A countersign covers exactly what the owner signed',
    holds:
      "A `G0-RAISE: KEY@hash — reason` trailer counts only in a commit in base..HEAD with no `Co-Authored-By: Claude` line, and a reason of three words or more with no `<placeholder>`. It covers its item only at that hash. A hash is taken over a canonical form (a pin's keys sorted, JSON keys sorted, a whole JSON file parsed), so re-sorting signs nothing away; any other change to the item, a tightening included, asks again. Every exception the change adds, copies, moves or renews is listed under its hash.",
    outside: ['a forged trailer in a commit without its attribution line'],
    tests: [
      "the gate's own pasted output, or an agent's trailer, is not a countersign",
      'a countersign covers what it signed: loosening the same item after it needs a new one',
      'a hash binds the countersign: an amend, or a cherry-pick onto another change, is asked again',
      'a countersign needs a three-word reason, and covers only its own entry',
      'a pin hashes in canonical order, a path with a space can be signed, and every exception a hash covers is listed',
    ],
  },
  {
    id: 'S8',
    title: 'The pull request into dev judges; the base copy judges with it',
    holds:
      "A pull request into dev fails on anything unsigned. A push to dev or main, and a release PR from this repository's dev into main, only note it. When a change edits the gate folder (`scripts/checks/` and the runner's entry folders, not just the baseline), the base commit's copy of the gate also judges the countersigns and the growth into stale pins, finding the base itself, and lists what its own rules find. A base that holds the gate's baseline or rules page with no runner at any listed entry path fails the run (exit 2). The owner's sign past a base copy that can't run covers only that base copy's code and the gate code it was signed for, the calling workflows' gate parts included.",
    outside: [
      'the `edited` pull_request event (a base switched after CI ran)',
      "a change to only static_analysis.yml, .husky/pre-commit, gate.sh or a caller job: it runs no base copy, whose code would be the change's own",
      'a merge queue: no caller triggers on merge_group, and WP-6 makes the static-analysis job itself the required check',
    ],
    tests: [
      'a push to dev, or a release PR, only notes an unsigned loosening',
      "when a change edits the gate, the base's copy of the gate judges it too",
      'a PR whose base is HEAD itself is an error, not a pass',
      "a base copy that can't run is an error the owner can sign past",
      'ciBase knows its events and stops on any other',
      'ciBase: a pull request from dev is a release',
      'a base that holds the gate where no entry path looks is an error; a baseline-only change runs no base copy',
      'the sign past a base copy covers the calling workflows and survives a dev move',
    ],
  },
  {
    id: 'S9',
    title: 'Exit codes',
    holds:
      "0: everything passed. 1: a violation, or an unsigned loosening. 2: the gate can't run: a registry error, a git error, a gate command it can't read, a base it can't find. A crash is never 0 or 1.",
    outside: [],
    tests: [
      'a gate that cannot run exits 2, never 0 or 1',
      'a broken gate module exits 2, not 1',
      'a malformed rule is an error, never a silently skipped rule',
    ],
  },
  {
    id: 'S10',
    title: 'An epic keeps its lifecycle in git (W0)',
    holds:
      'Every `docs/epics/<id>/epic.md` has front matter with only the known fields: an `id` equal to its folder, a `title`, and a `status` that is planned, active, shipped, retro-done or abandoned. A live epic names a `plan` that exists beside it, unless `legacy: true` (adopted by W0, its plan predates it). A shipped or retro-done epic lists at least one PR, an abandoned one gives a `reason`, and a retro-done one has its `retro.md`. Every `### WP-N` block of a `plan.md` has a Files:, a Verify: and a Pass when: line, a block ending at the next heading, and a plan.md never sits in a folder without an epic.md. At retro-done or abandoned the folder holds only epic.md and retro.md (DOC-PLAN).',
    outside: [
      'whether a status only moved forward, which needs the base branch (a PR rule, S13)',
      'whether the plan is any good, or a Pass when line is true: the owner reviews the plan',
      'an epic that never got a folder: CI cannot see beads, so the bd-close hook catches it at close time (S12)',
      'docs/epics/_template/, whose placeholders the self-test fills in and checks',
    ],
    tests: [
      'WF-EPIC: a valid epic.md and plan.md pass, and so do the templates once filled in',
      'WF-EPIC: a bad status, an id that is not the folder, a missing plan, an unknown field and a shipped epic with no PR each fail',
      "WF-EPIC: every WP in a plan names its Files, Verify and Pass when, and one WP can't borrow the next one's line",
      'WF-EPIC: a legacy epic needs no plan, an abandoned one needs a reason, and a retro-done one needs its retro.md',
      "DOC-PLAN: a finished epic's folder holds only epic.md and retro.md",
    ],
  },
  {
    id: 'S11',
    title: "A retro's lessons land somewhere CI can see (W0)",
    holds:
      'Every `docs/epics/<id>/retro.md` has a `## Lessons` section whose first table has Lesson, Verdict and Home columns and at least one row. Every row has a lesson, and its Home resolves: `rule:<ID>` names a rule or CI gate in the registry, `adr:NNNN` has a `docs/adr/NNNN-*.md`, `test:<path>` exists, `skill:<name> "phrase"` and `claude-md:<path> "phrase"` find the phrase (whitespace collapsed) in that skill\'s markdown or that CLAUDE.md/AGENTS.md, and `prose-only:` gives a reason for each of arch, type, rule, test and hook. Anything else, including a bd memory or a memory file, is not a home.',
    outside: [
      'whether the verdict is right, or a phrase actually states the lesson: the owner reviews the retro PR',
      'a lesson the retro leaves out of its table',
      'retros written before W0 (docs/epics/retros/), and the 69 epics closed before it',
    ],
    tests: [
      'WF-LESSON: a lessons table whose every home resolves passes, and so does the template once filled in',
      'WF-LESSON: an unknown rule, a missing ADR, a missing test file and an unknown kind of home each fail',
      "WF-LESSON: a skill or CLAUDE.md home must contain the lesson's phrase",
      'WF-LESSON: a prose-only home names why every stronger rung failed',
      'WF-LESSON: a retro with no lessons table, or an empty one, fails',
    ],
  },
  {
    id: 'S12',
    title:
      'An epic is closed in beads only after its retro, or as abandoned (W0)',
    holds:
      "In a Claude Code session on a checkout that carries the tracked `.claude/settings.json`, every Bash call goes first to `scripts/checks/bd-close-guard.mjs`. It finds each bd call in the command line (after ; && || | or a newline, inside ( ), $( ) and backticks, behind env assignments, a wrapper such as command, env, xargs or sudo, a path to bd, and sh -c), reading bd's flags as bd does. It exits 2, with the reason on stderr, when `bd close`, `bd done` or `bd update … --status closed` names an open epic whose `docs/epics/<id>/epic.md` (in the command's checkout, or that checkout's origin/dev) is not retro-done or abandoned; when a close names no id, since bd then closes the last touched issue; when `bd epic close-eligible` runs without --dry-run; and when bd can't say whether an id is an epic. CI proves the guard with bd stubbed, and that settings.json still runs it on every Bash call, with no `if` filter and not async.",
    outside: [
      'bd commands the guard does not parse: `bd sql`, `batch`, `import`, `supersede` and `duplicate`',
      'a bd call built at run time: `eval`, a variable or alias holding bd, a script file that calls bd',
      'a human closing an epic in their own shell, or a session with hooks disabled: the guard is agent-side',
      'whether the retro it trusts is any good: WF-LESSON (S11) and the owner review the retro',
    ],
    tests: [
      'WF-BD-CLOSE: a command line splits into its simple commands, quotes and substitutions resolved',
      'WF-BD-CLOSE: bd is found behind env assignments, wrappers, a path and sh -c',
      'WF-BD-CLOSE: close, done and update --status closed name their ids; flag values are not ids',
      'WF-BD-CLOSE: bd epic close-eligible, and a close with no id, are refused outright',
      'WF-BD-CLOSE: closing an epic whose epic.md is missing or not done is refused, with the reason',
      'WF-BD-CLOSE: a retro-done or abandoned epic, a closed one, a non-epic and an unknown id pass',
      'WF-BD-CLOSE: when bd cannot answer, a close is refused, never waved through',
      'WF-BD-CLOSE: a command without bd never asks bd anything',
      'WF-BD-CLOSE: bd -C checks the epic in that checkout',
      'WF-BD-CLOSE: epic.md is read from the checkout and from its origin/dev',
      'WF-BD-CLOSE: the hook exits 2 with the reason on stderr for an epic, and 0 for a task',
      'WF-BD-CLOSE: the hook refuses when bd fails, and passes when bd finds none of the ids',
      'WF-BD-CLOSE: the hook ignores other tools, other commands and a payload that is not JSON',
      'WF-BD-CLOSE: the tracked .claude/settings.json runs the guard on every Bash call',
      'WF-BD-CLOSE: the wiring check fails when the hook is gone, narrowed, made async or the file is broken',
    ],
  },
  {
    id: 'S13',
    title:
      'A pull request into dev names its bead, carries its review tally and owes no retro (W0)',
    holds:
      "The PR rules run only under `check-architecture.mjs --pr-rules`, in `.github/workflows/pr-rules.yml` on each pull request into dev when it opens and whenever its commits, body or labels change; `--ci` (static-analysis) and commit time never run them, because a PR kind and `when: 'pr'` must go together. WF-PR-LINK: an `Epic:` line in the body, or else the branch, names a Codex- bead; an Epic: line or a WP's dotted id must reach, walking up, an epic folder with an epic.md, and an undotted branch id passes as a standalone bead. WF-REVIEW: the body's `## Review` block gives `reviewed: <sha>`, `rounds:` of at least 1, `found:` and `open:` counts, open never above found and 0C/0H/0M, each `wontfix:` with a reason; the reviewed commit is in base..head, and when it is not the head, `fixes through:` names the exact head. WF-RETRO-DEBT: an epic.md that says shipped on the base, dated from the base's first-parent history, more than 7 days ago, fails the PR unless the PR moves it to retro-done or abandoned, or carries the hotfix label (a notice); a shipped epic it can't date fails; and no PR moves an epic's status backward or deletes its epic.md. WF-ONE-PR notes the author's other open PRs into dev and never fails. A release PR (dev into main) is exempt from all four.",
    outside: [
      'whether the tally is honest, or the review it claims happened: the owner spot-checks tallies (page 6 §5)',
      "a PR that loosens these rules in its own copy of the gate: that edits scripts/checks/ or pr-rules.yml, which static-analysis's --ci fails until the owner countersigns, judged by the base's copy",
      'a PR merged while pr-rules is not a required check: the ruleset makes it one after W0 merges (WP-6)',
      'which bead a standalone undotted id names, or whether it is an epic: CI cannot see beads',
    ],
    tests: [
      'WF-PR-LINK: a branch or an Epic: line naming a bead passes, and a WP walks up to its epic folder',
      'WF-PR-LINK: a PR that names no bead, or a WP or Epic: line with no epic folder above it, fails',
      'WF-REVIEW: a tally for the head with nothing open passes, and so does one with a reasoned wontfix',
      'WF-REVIEW: a missing tally, an open MEDIUM, open beyond found and a wontfix with no reason each fail',
      'WF-REVIEW: commits after the reviewed one need fixes through: the exact head',
      "WF-REVIEW: a reviewed commit that isn't in the branch, or isn't a commit at all, fails",
      'WF-RETRO-DEBT: an epic shipped over 7 days ago blocks; the retro PR and a hotfix pass, the hotfix with a notice',
      "WF-RETRO-DEBT: a PR can't move an epic's status backward, or delete its epic.md, to dodge the debt",
      'WF-ONE-PR: another open PR by the same author is a notice, never a failure',
      'a release PR (dev into main) is exempt from every PR rule',
      "static-analysis never runs a PR rule, and a PR kind can't run without when: 'pr'",
      "pr-rules.yml runs --pr-rules, unconditionally, on every event that changes a PR's commits, body or labels",
      '--pr-rules judges a real repository from --pr-event, and --pr-event needs --pr-rules',
    ],
  },
];
