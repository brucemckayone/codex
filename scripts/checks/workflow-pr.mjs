/**
 * The pull-request rules (W0, Codex-sqs36): WF-PR-LINK, WF-REVIEW,
 * WF-RETRO-DEBT and WF-ONE-PR.
 *
 * They judge a pull request, not files, so they run only under
 * `check-architecture.mjs --pr-rules`, in `.github/workflows/pr-rules.yml`,
 * which re-runs when the PR's body or labels change. static-analysis's `--ci`
 * never runs them (validateRules keeps a `pr` kind and `when: 'pr'` together),
 * so editing a body can't leave that required check stale-red.
 *
 * A PR kind has `pr(rule, ctx) → { hits: [{ text, key }], notices: [text] }`.
 * `ctx` is built by the runner (prContext) and stubbed by the self-test:
 *
 *   pr          the pull request, from the event (prFromEvent)
 *   source      the tree that would land (GitHub's merge commit), read like
 *               every kind reads
 *   baseSource  the base branch's tree
 *   git         { resolve(sha) → full sha | null, inBranch(sha) → boolean,
 *                 shippedAt(file) → Date | null }
 *   now         the clock, for retro debt
 *   openPrs     (author) → that author's open PR numbers into dev, or null
 *
 * A warn-only kind (`warnOnly`) reports notices and never fails the PR.
 */
import { execFileSync } from 'node:child_process';
import { parseEpicFile } from './workflow-epic.mjs';

const SHA = '([0-9a-f]{7,40})';
const EPIC_FILE = /^docs\/epics\/([^/]+)\/epic\.md$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The lifecycle's order. abandoned ends it from any live status; retro-done
 * and abandoned are both final.
 */
const RANK = {
  planned: 0,
  active: 1,
  shipped: 2,
  'retro-done': 3,
  abandoned: 3,
};
const movesForward = (before, after) =>
  after === before ||
  RANK[after] > RANK[before] ||
  (after === 'abandoned' && RANK[before] < RANK.abandoned);

/** The pull request in a `pull_request` event's payload, or null. */
export function prFromEvent(payload) {
  const p = payload?.pull_request;
  if (!p) return null;
  const headRepo = p.head?.repo?.full_name;
  const sameRepo = !headRepo || headRepo === payload.repository?.full_name;
  return {
    number: p.number ?? null,
    body: p.body ?? '',
    labels: (p.labels ?? [])
      .map((l) => (typeof l === 'string' ? l : l?.name))
      .filter(Boolean),
    author: p.user?.login ?? '',
    head: { ref: p.head?.ref ?? '', sha: p.head?.sha ?? '' },
    base: { ref: p.base?.ref ?? '', sha: p.base?.sha ?? '' },
    // This repo's dev into main. pr-rules.yml only runs for PRs into dev, so
    // this guards a local run.
    release: p.head?.ref === 'dev' && p.base?.ref === 'main' && sameRepo,
  };
}

/** The status in an epic.md's front matter (WF-EPIC's parser), or null. */
const statusIn = (text) => {
  const parsed = parseEpicFile(text);
  return parsed.error ? null : (parsed.fields.status ?? null);
};

/**
 * The epic a bead id belongs to: the id itself or the nearest id above it
 * (`Codex-x.89.3` → `Codex-x.89` → `Codex-x`) with a `docs/epics/<id>/epic.md`.
 */
export function epicFolderFor(id, source) {
  for (let current = id; ; ) {
    if (source.has(`docs/epics/${current}/epic.md`)) return current;
    const dot = current.lastIndexOf('.');
    if (dot === -1) return null;
    current = current.slice(0, dot);
  }
}

/**
 * The `## Review` block codex-review writes, or null when the body has none:
 *
 *   ## Review
 *   reviewed: <sha> · rounds: N · found: xC/xH/xM/xL/xnit · open: 0C/0H/0M
 *   fixes through: <head sha>          (when commits followed the review)
 *   - wontfix: <finding> — <why>       (each one the open count leaves out)
 *
 * The fields may sit on one line or several, with any separator.
 */
export function reviewTally(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Review\b/i.test(l));
  if (start === -1) return null;
  const next = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  const block = lines.slice(start + 1, next === -1 ? undefined : next);
  const text = block.join('\n');
  const counts = (m, n) => (m ? m.slice(1, n + 1).map(Number) : null);
  const rounds = /rounds:\s*(\d+)/i.exec(text);
  return {
    reviewed: new RegExp(`reviewed:\\s*\`?${SHA}`, 'i').exec(text)?.[1] ?? null,
    rounds: rounds ? Number(rounds[1]) : null,
    found: counts(
      /found:\s*(\d+)C\s*\/\s*(\d+)H\s*\/\s*(\d+)M\s*\/\s*(\d+)L\s*\/\s*(\d+)\s*nit/i.exec(
        text
      ),
      5
    ),
    open: counts(/open:\s*(\d+)C\s*\/\s*(\d+)H\s*\/\s*(\d+)M/i.exec(text), 3),
    fixesThrough:
      new RegExp(`fixes through:\\s*\`?${SHA}`, 'i').exec(text)?.[1] ?? null,
    wontfix: block
      .map((l) => /^\s*(?:[-*]\s+)?wontfix:\s*(.*)$/i.exec(l)?.[1])
      .filter((w) => w !== undefined),
  };
}

const TALLY_FORMAT =
  'reviewed: <sha> · rounds: N · found: xC/xH/xM/xL/xnit · open: 0C/0H/0M';
const none = () => ({ hits: [], notices: [] });
const failing = (...texts) => ({
  hits: texts.map((text) => ({ text, key: text.slice(0, 60) })),
  notices: [],
});

export const WORKFLOW_PR_MATCHERS = {
  /**
   * WF-PR-LINK: a PR says which bead it is for. An `Epic:` line in the body
   * wins, and its id (or an epic above it) must have an epic.md. Otherwise the
   * branch names the id: a WP's dotted id must reach an epic.md walking up, and
   * an undotted id is a standalone bead (CI can't see beads to know more).
   */
  'pr-link': {
    validate(rule) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(rule.match.prefix ?? '')) {
        throw new Error(
          `rule ${rule.id}: match.prefix must be the bead prefix, like 'Codex'`
        );
      }
    },
    pr(rule, { pr, source }) {
      if (pr.release)
        return {
          hits: [],
          notices: ['a release PR (dev into main) needs no epic link'],
        };
      const id = new RegExp(`\\b${rule.match.prefix}-[a-z0-9]{3,}(?:\\.\\d+)*`);
      const line = /^[ \t]*Epic:[ \t]*(.*)$/im.exec(pr.body);
      if (line) {
        const named = id.exec(line[1])?.[0];
        if (!named)
          return failing(
            `the "Epic:" line names no ${rule.match.prefix}- id: "${line[1].trim()}"`
          );
        return epicFolderFor(named, source)
          ? none()
          : failing(
              `Epic: ${named}: neither it nor an epic above it has a docs/epics/<id>/epic.md. Add one (docs/epics/_template/epic.md; legacy: true for an epic older than W0).`
            );
      }
      const fromBranch = id.exec(pr.head.ref)?.[0];
      if (!fromBranch) {
        return failing(
          `neither the branch "${pr.head.ref}" nor an "Epic:" line in the body names a bead. Name it in the branch (feat/${rule.match.prefix}-xxxx-…) or add "Epic: ${rule.match.prefix}-xxxx".`
        );
      }
      if (fromBranch.includes('.') && !epicFolderFor(fromBranch, source)) {
        return failing(
          `the branch names WP ${fromBranch}, and no epic above it has a docs/epics/<id>/epic.md. Add the epic's (docs/epics/_template/epic.md).`
        );
      }
      return none();
    },
  },

  /**
   * WF-REVIEW: the body carries codex-review's tally for a commit in this
   * branch, nothing critical, high or medium is open, and when commits followed
   * the reviewed one, `fixes through:` names the exact head.
   */
  'pr-review': {
    pr(_rule, { pr, git }) {
      if (pr.release)
        return {
          hits: [],
          notices: ['a release PR (dev into main) carries no review tally'],
        };
      const tally = reviewTally(pr.body);
      if (!tally) {
        return failing(
          `the body has no "## Review" block. Run codex-review; it writes "${TALLY_FORMAT}".`
        );
      }
      const problems = [];
      if (!tally.reviewed)
        problems.push(
          `the Review block has no "reviewed: <sha>" (${TALLY_FORMAT})`
        );
      if (tally.rounds === null || tally.rounds < 1)
        problems.push('the Review block has no "rounds: N" of at least 1');
      if (!tally.found)
        problems.push('the Review block has no "found: xC/xH/xM/xL/xnit"');
      if (!tally.open)
        problems.push('the Review block has no "open: xC/xH/xM"');
      if (tally.found && tally.open) {
        const over = ['C', 'H', 'M'].filter(
          (_, i) => tally.open[i] > tally.found[i]
        );
        if (over.length)
          problems.push(`open exceeds found for ${over.join(', ')}`);
      }
      if (tally.open?.some((n) => n > 0)) {
        const [c, h, m] = tally.open;
        problems.push(
          `open: ${c}C/${h}H/${m}M. Fix each before merge, or list it as "wontfix: <finding> — <why>" and leave it out of the open count.`
        );
      }
      for (const w of tally.wontfix) {
        if (!/\S\s+(?:—|–|--|-)\s+\S/.test(w))
          problems.push(
            `"wontfix: ${w}" gives no reason ("wontfix: <finding> — <why>")`
          );
      }
      if (tally.reviewed) {
        const reviewed = git.resolve(tally.reviewed);
        if (!reviewed)
          problems.push(
            `reviewed: ${tally.reviewed} is not a commit in this repository`
          );
        else if (!git.inBranch(reviewed)) {
          problems.push(
            `reviewed: ${tally.reviewed} is not one of this branch's commits (base..head)`
          );
        } else if (reviewed !== pr.head.sha) {
          const through = tally.fixesThrough
            ? git.resolve(tally.fixesThrough)
            : null;
          if (!tally.fixesThrough) {
            problems.push(
              `commits follow the reviewed ${tally.reviewed.slice(0, 9)}: add "fixes through: ${pr.head.sha.slice(0, 9)}" once the fixes are in`
            );
          } else if (through !== pr.head.sha) {
            problems.push(
              `fixes through: ${tally.fixesThrough} is not the head ${pr.head.sha.slice(0, 9)}: a commit landed after it`
            );
          }
        }
      }
      return failing(...problems);
    },
  },

  /**
   * WF-RETRO-DEBT: an epic that shipped more than `match.days` days ago and
   * still has no retro blocks every PR into dev. The retro PR itself (it moves
   * that epic to retro-done or abandoned) passes, and a PR labelled
   * `match.exemptLabel` passes with a notice.
   */
  'retro-debt': {
    validate(rule) {
      if (!Number.isInteger(rule.match.days) || rule.match.days < 1) {
        throw new Error(
          `rule ${rule.id}: match.days must be a whole number of days`
        );
      }
      if (typeof rule.match.exemptLabel !== 'string') {
        throw new Error(
          `rule ${rule.id}: match.exemptLabel must name the label that exempts a PR`
        );
      }
    },
    pr(rule, { pr, source, baseSource, git, now }) {
      if (pr.release) {
        return {
          hits: [],
          notices: ['a release PR (dev into main) carries no retro debt'],
        };
      }
      const hits = [];
      const notices = [];
      for (const file of baseSource.files) {
        const id = EPIC_FILE.exec(file)?.[1];
        if (!id || id === '_template') continue;
        const before = statusIn(baseSource.read(file));
        const after = source.has(file)
          ? statusIn(source.read(file))
          : undefined;
        // Statuses only move forward, and the record stays: either way back
        // would also dodge the debt below.
        if (before in RANK && after === undefined) {
          hits.push({
            text: `${file} (status ${before}) is deleted: an epic's lifecycle record stays in git`,
            key: `${id} deleted`,
          });
          continue;
        }
        if (before in RANK && after in RANK && !movesForward(before, after)) {
          hits.push({
            text: `${id}'s status moves from ${before} back to ${after}: statuses only move forward`,
            key: `${id} ${before}>${after}`,
          });
          continue;
        }
        if (before !== 'shipped') continue;
        const shipped = git.shippedAt(file);
        if (!shipped) {
          hits.push({
            text: `${id} is shipped, and its history can't date that (fetch the full history)`,
            key: id,
          });
          continue;
        }
        const days = Math.floor((now - shipped) / DAY_MS);
        if (days <= rule.match.days) continue;
        if (after === 'retro-done' || after === 'abandoned') continue;
        const what = `${id} shipped ${days} days ago (${shipped.toISOString().slice(0, 10)}) and has no retro`;
        if (pr.labels.includes(rule.match.exemptLabel)) {
          notices.push(
            `${what}; this PR is labelled "${rule.match.exemptLabel}", so it passes`
          );
        } else {
          hits.push({
            text: `${what}. Run codex-epic-retro (it sets retro-done), or label a real hotfix "${rule.match.exemptLabel}".`,
            key: id,
          });
        }
      }
      return { hits, notices };
    },
  },

  /** WF-ONE-PR (a warning): one open PR into dev per author at a time. */
  'one-pr': {
    warnOnly: true,
    pr(_rule, { pr, openPrs }) {
      if (pr.release || !pr.author) return none();
      const open = openPrs(pr.author);
      if (open === null)
        return {
          hits: [],
          notices: [`could not list ${pr.author}'s open PRs`],
        };
      const others = open.filter((n) => n !== pr.number);
      return {
        hits: [],
        notices: others.length
          ? [
              `${pr.author} has ${others.length} other open PR(s) into dev (${others.map((n) => `#${n}`).join(', ')}): one PR at a time`,
            ]
          : [],
      };
    },
  },
};

// ---------------------------------------------------------------------------
// The facts a PR rule needs from git and GitHub, for the runner
// ---------------------------------------------------------------------------

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
const ok = (root, args) => {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
};

/** `ctx.git` over a checkout, for the commits base..head. */
export function gitFacts(root, base, head) {
  return {
    resolve(sha) {
      try {
        return git(root, [
          'rev-parse',
          '--verify',
          '--quiet',
          `${sha}^{commit}`,
        ]).trim();
      } catch {
        return null;
      }
    },
    inBranch: (sha) =>
      ok(root, ['merge-base', '--is-ancestor', sha, head]) &&
      !ok(root, ['merge-base', '--is-ancestor', sha, base]),
    /**
     * When a shipped epic.md became shipped on the base branch: the oldest
     * commit of the newest run of first-parent commits where it says shipped.
     */
    shippedAt(file) {
      let log;
      try {
        log = git(root, [
          'log',
          '--first-parent',
          '--format=%H %cI',
          base,
          '--',
          file,
        ]).trim();
      } catch {
        return null;
      }
      let since = null;
      for (const line of log.split('\n').filter(Boolean)) {
        const [sha, date] = line.split(' ');
        let text;
        try {
          text = git(root, ['show', `${sha}:${file}`]);
        } catch {
          break; // deleted at this commit
        }
        if (statusIn(text) !== 'shipped') break;
        since = new Date(date);
      }
      return since;
    },
  };
}

/** `ctx.openPrs` through the gh CLI: the author's open PR numbers into dev, or null. */
export function ghOpenPrs(author) {
  try {
    const out = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--base',
        'dev',
        '--state',
        'open',
        '--author',
        author,
        '--json',
        'number',
        '-q',
        '.[].number',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }
    );
    return out.split('\n').filter(Boolean).map(Number);
  } catch {
    return null;
  }
}
