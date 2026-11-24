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
];
