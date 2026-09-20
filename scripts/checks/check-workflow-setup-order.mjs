#!/usr/bin/env node
/**
 * Workflow setup-order gate (Codex-2g7jj).
 *
 * WHY THIS FILE EXISTS. On 2026-09-15 a production deploy failed at step 2 with
 * "Unable to locate executable file: pnpm", and nothing reached production —
 * migrations, secrets and all 9 worker deploys skipped. The cause was an action
 * bump, not a code change: PR #505 moved `actions/setup-node` v4 -> v5, and v5
 * added `package-manager-cache` with `default: true`. That input auto-detects
 * the package manager from package.json's `packageManager` field (this repo:
 * pnpm@10.18.3) and resolves its store directory INSIDE the action — so
 * setup-node now needs pnpm already on PATH. Under v4 no such input existed, so
 * running `pnpm/action-setup` AFTER `setup-node` was harmless.
 *
 * Nine workflows survived the bump. Two did not, and they were exactly the two
 * that no CI job executes:
 *
 *   deploy-production.yml   workflow_run, off a successful push to main
 *   seed-dev-db.yml         workflow_dispatch only, behind a confirm gate
 *
 * The seven survivors all set `cache: 'pnpm'`, which v4 already required, and
 * that had forced them to install pnpm first. So the ordering invariant was
 * being held by a side effect of an unrelated input, in the files CI happens to
 * run. Green CI meant "not run" — again.
 *
 * This gate asserts the invariant DIRECTLY, over every workflow file, including
 * the ones nothing executes. It is the only check of the three on the bead that
 * catches a SEMANTIC ordering defect: the broken form is valid YAML with valid
 * inputs, so a schema linter (actionlint, option 2) passes it.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 * For every job in .github/workflows/*.yml, every `actions/setup-node` step
 * must be preceded, IN THE SAME JOB, by a `pnpm/action-setup` step.
 *
 * Two exemptions, both principled rather than cosmetic:
 *
 *   1. `package-manager-cache: false` on the setup-node step. This switches the
 *      auto-detection off, so the action never looks for pnpm. It is the
 *      documented escape hatch and the correct declaration for a job that has
 *      no lockfile to cache.
 *
 *   2. The job never runs `actions/checkout`. With no repo in the workspace
 *      there is no package.json to detect a package manager from, so nothing
 *      resolves a pnpm store path. Without this exemption the gate would demand
 *      a pointless pnpm install in checkout-less utility jobs, and a gate that
 *      demands pointless work gets switched off — at which point the invariant
 *      is a convention again.
 *
 * Job scoping is the load-bearing part. A file-level "some pnpm line precedes
 * some setup-node line" check passes on a file where job A installs pnpm and
 * job B, with no pnpm of its own, runs setup-node — which is a broken job in a
 * file that looks fine. Runners share nothing between jobs. testing.yml carries
 * four independent pnpm/setup-node pairs, so this is the realistic shape here,
 * not a hypothetical.
 *
 * ============================================================================
 * PARSING, AND WHY IT IS NOT A GREP
 * ============================================================================
 *
 * There is no YAML parser in this dependency tree and this gate must keep
 * running in the static-analysis job with zero install beyond the repo's own,
 * so the scanner below is indentation-based — same approach as the
 * `tokenize()` in check-data-access-contract.mjs.
 *
 * The one thing a line scan MUST get right here is block scalars. testing.yml
 * is 1300+ lines and much of it is `run: |` shell. A `uses: actions/setup-node`
 * written inside a shell block — in an echo, or commented out — is not a step,
 * and a scanner that counts it reports a defect that does not exist, or worse
 * credits a pnpm step that does not exist. `skipBlockScalar` therefore consumes
 * every line more indented than a `key: |` / `key: >` header before scanning
 * resumes. The self-test asserts exactly this in both directions.
 *
 * Reusable-workflow jobs (`uses:` at JOB level, no `steps:`) are not steps
 * either; testing.yml calls static_analysis.yml that way.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SETUP_NODE = 'actions/setup-node';
export const PNPM_SETUP = 'pnpm/action-setup';
export const CHECKOUT = 'actions/checkout';
export const PM_CACHE_INPUT = 'package-manager-cache';

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === '';
/** A whole-line comment. An inline `# ...` is handled where values are read. */
const isComment = (line) => line.trimStart().startsWith('#');

/** `key: |`, `key: >-`, `key: |+2` … the header of a block scalar. */
const BLOCK_SCALAR_RE = /^\s*[^\s:#][^:]*:\s*[|>][+-]?\d*\s*(#.*)?$/;

/**
 * Advance past a block scalar's body: every following line that is blank or
 * indented deeper than the header. Returns the index of the first line that is
 * still structural YAML.
 */
function skipBlockScalar(lines, headerIndex) {
  const headerIndent = indentOf(lines[headerIndex]);
  let i = headerIndex + 1;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    if (indentOf(lines[i]) > headerIndent) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

/** Strip a trailing inline comment and surrounding quotes from a scalar value. */
function scalarValue(raw) {
  let v = raw.trim();
  const hash = v.indexOf(' #');
  if (hash !== -1) v = v.slice(0, hash).trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1) v = v.slice(1, -1);
  else if (v.startsWith('"') && v.endsWith('"') && v.length > 1) v = v.slice(1, -1);
  return v.trim();
}

/**
 * Parse a workflow into its jobs and, for each, the ordered `uses:` steps.
 *
 * Exported for the self-test, which points it at fixture sources rather than
 * the real tree.
 */
export function parseWorkflowJobs(source) {
  const lines = source.split('\n');
  const jobs = [];

  let i = 0;
  let jobsIndent = null;
  let jobNameIndent = null;
  let current = null;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line) || isComment(line)) {
      i += 1;
      continue;
    }
    if (BLOCK_SCALAR_RE.test(line)) {
      i = skipBlockScalar(lines, i);
      continue;
    }

    const indent = indentOf(line);
    const trimmed = line.trim();

    if (jobsIndent === null) {
      if (/^jobs:\s*(#.*)?$/.test(trimmed) && indent === 0) jobsIndent = indent;
      i += 1;
      continue;
    }

    // A key at the job-name level opens a new job. The first such key fixes the
    // level; anything shallower ends the `jobs:` block entirely.
    const jobKey = /^([A-Za-z0-9_][\w.-]*):\s*(#.*)?$/.exec(trimmed);
    if (jobKey && indent > jobsIndent && (jobNameIndent === null || indent === jobNameIndent)) {
      jobNameIndent = indent;
      current = { name: jobKey[1], line: i + 1, steps: [] };
      jobs.push(current);
      i += 1;
      continue;
    }
    if (indent <= jobsIndent && !isBlank(line)) {
      // Dedented out of `jobs:` (a top-level key after it).
      current = null;
      jobsIndent = null;
      jobNameIndent = null;
      continue;
    }

    // Inside a job: a step is a sequence item carrying `uses:`. A job-level
    // `uses:` (reusable workflow call) has no leading `-` and is not a step.
    if (current) {
      const stepUses = /^-\s+uses:\s*(.+)$/.exec(trimmed);
      const stepOther = /^-\s+/.test(trimmed);
      if (stepUses) {
        current.steps.push(readStepInputs(lines, i, indentOf(line), scalarValue(stepUses[1]), i + 1));
        i = advancePastStep(lines, i, indentOf(line));
        continue;
      }
      if (stepOther) {
        // A step that leads with `name:` — its `uses:` sits in the same block.
        const stepIndent = indentOf(line);
        const end = advancePastStep(lines, i, stepIndent);
        let uses = null;
        let usesLine = i + 1;
        for (let k = i; k < end; k += 1) {
          const m = /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(lines[k]);
          if (m && !BLOCK_SCALAR_RE.test(lines[k])) {
            uses = scalarValue(m[1]);
            usesLine = k + 1;
            break;
          }
        }
        if (uses !== null) {
          current.steps.push(readStepInputs(lines, i, stepIndent, uses, usesLine));
        }
        i = end;
        continue;
      }
    }

    i += 1;
  }

  return jobs;
}

/** Index of the first line at or after `start+1` that leaves this step's block. */
function advancePastStep(lines, start, stepIndent) {
  let i = start + 1;
  while (i < lines.length) {
    if (isBlank(lines[i]) || isComment(lines[i])) {
      i += 1;
      continue;
    }
    if (BLOCK_SCALAR_RE.test(lines[i])) {
      i = skipBlockScalar(lines, i);
      continue;
    }
    if (indentOf(lines[i]) <= stepIndent) break;
    i += 1;
  }
  return i;
}

/** Collect a step's `with:` inputs as a flat map of scalar values. */
function readStepInputs(lines, start, stepIndent, uses, usesLine) {
  const end = advancePastStep(lines, start, stepIndent);
  const inputs = {};
  let withIndent = null;
  for (let k = start; k < end; k += 1) {
    const line = lines[k];
    if (isBlank(line) || isComment(line)) continue;
    if (BLOCK_SCALAR_RE.test(line)) {
      k = skipBlockScalar(lines, k) - 1;
      continue;
    }
    const t = line.trim();
    if (/^(?:-\s+)?with:\s*(#.*)?$/.test(t)) {
      withIndent = indentOf(line);
      continue;
    }
    if (withIndent !== null) {
      if (indentOf(line) <= withIndent) {
        withIndent = null;
        continue;
      }
      const kv = /^([A-Za-z0-9_][\w.-]*):\s*(.*)$/.exec(t);
      if (kv) inputs[kv[1]] = scalarValue(kv[2]);
    }
  }
  return { uses, line: usesLine, inputs };
}

const usesAction = (step, action) =>
  step.uses === action || step.uses.startsWith(`${action}@`);

/**
 * Apply the rule to one workflow source. Returns a list of violations, each
 * naming the job, the offending line, and why it is a defect.
 */
export function collectSetupOrderViolations(source, file = '<source>') {
  const violations = [];
  for (const job of parseWorkflowJobs(source)) {
    const hasCheckout = job.steps.some((s) => usesAction(s, CHECKOUT));
    if (!hasCheckout) continue; // exemption 2 — nothing to detect
    job.steps.forEach((step, index) => {
      if (!usesAction(step, SETUP_NODE)) return;
      const optedOut = String(step.inputs[PM_CACHE_INPUT] ?? '').toLowerCase() === 'false';
      if (optedOut) return; // exemption 1 — auto-detection switched off
      const pnpmBefore = job.steps
        .slice(0, index)
        .some((s) => usesAction(s, PNPM_SETUP));
      if (!pnpmBefore) {
        const anywhere = job.steps.some((s) => usesAction(s, PNPM_SETUP));
        violations.push({
          file,
          job: job.name,
          line: step.line,
          uses: step.uses,
          reason: anywhere
            ? `${PNPM_SETUP} runs AFTER ${SETUP_NODE} in job "${job.name}"`
            : `${SETUP_NODE} in job "${job.name}" has no ${PNPM_SETUP} before it`,
        });
      }
    });
  }
  return violations;
}

export function workflowFiles(repoRoot = REPO_ROOT) {
  const dir = join(repoRoot, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => join(dir, f));
}

export function formatGuidance() {
  return [
    'HOW TO FIX. Move the `pnpm/action-setup` step ABOVE `actions/setup-node`',
    'in that job:',
    '',
    '    - uses: actions/checkout@v5',
    '    - uses: pnpm/action-setup@v5      # <- must come first',
    '    - uses: actions/setup-node@v5',
    '      with:',
    "        cache: 'pnpm'",
    '',
    'setup-node v5 resolves the pnpm store INSIDE the action, so pnpm must',
    'already be on PATH. If the job genuinely has nothing to cache, declare',
    `\`${PM_CACHE_INPUT}: false\` on the setup-node step instead — that turns the`,
    'auto-detection off and is the only exemption this gate accepts.',
  ].join('\n');
}

function main() {
  const files = workflowFiles();
  const violations = [];
  let jobsScanned = 0;
  let setupNodeSteps = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(REPO_ROOT.length + 1);
    const jobs = parseWorkflowJobs(source);
    jobsScanned += jobs.length;
    for (const job of jobs) {
      setupNodeSteps += job.steps.filter((s) => usesAction(s, SETUP_NODE)).length;
    }
    violations.push(...collectSetupOrderViolations(source, rel));
  }

  if (violations.length > 0) {
    console.error('\nWorkflow setup-order violations:\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.reason}`);
    }
    console.error(`\n${violations.length} violation(s).\n`);
    console.error(formatGuidance());
    console.error(
      '\nSee scripts/checks/check-workflow-setup-order.mjs for the rule and the' +
        '\ndeploy failure that motivated it (Codex-2g7jj).\n'
    );
    process.exit(1);
  }

  // State what was actually scanned. A gate that prints "OK" without a count
  // cannot be distinguished from a gate that matched nothing.
  console.log(
    `OK: ${setupNodeSteps} ${SETUP_NODE} step(s) across ${jobsScanned} job(s) in ` +
      `${files.length} workflow file(s) are each preceded by ${PNPM_SETUP}, ` +
      `exempt via ${PM_CACHE_INPUT}: false, or in a job with no checkout.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
