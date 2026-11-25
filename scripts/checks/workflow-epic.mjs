/**
 * The epic lifecycle file and its plan (W0, Codex-sqs36): the `epic-file`
 * matcher kind behind WF-EPIC and DOC-PLAN.
 *
 * Each epic keeps its lifecycle in git, in `docs/epics/<id>/epic.md`, because
 * CI can't see beads. The file is front matter only:
 *
 *   ---
 *   id: Codex-xxxx          # equals the folder name
 *   title: …
 *   status: planned | active | shipped | retro-done | abandoned
 *   plan: plan.md           # until retro-done or abandoned, unless legacy
 *   prs: [725]              # at least one once shipped
 *   legacy: true            # adopted by W0: the plan predates it
 *   reason: …               # why, when abandoned
 *   ---
 *
 * `plan.md` sits beside it while the epic is live. Each `### WP-N` block in it
 * names its Files, how to Verify it, and when it Passes, so a WP can't be
 * closed on a feeling. At the retro the plan's conclusions move to a durable
 * home and the plan is deleted (DOC-PLAN).
 *
 * Like every kind, it reads only through `ctx.source`.
 */

export const EPIC_STATUSES = [
  'planned',
  'active',
  'shipped',
  'retro-done',
  'abandoned',
];
const DONE = new Set(['retro-done', 'abandoned']);
const SHIPPED = new Set(['shipped', 'retro-done']);
const FIELDS = new Set([
  'id',
  'title',
  'status',
  'plan',
  'prs',
  'legacy',
  'reason',
]);
export const WP_LABELS = ['Files:', 'Verify:', 'Pass when:'];

const folderOf = (file) => file.slice(0, file.lastIndexOf('/'));
const nameOf = (folder) => folder.slice(folder.lastIndexOf('/') + 1);

/**
 * The front matter of an epic file: `{ fields, lines, error }`. `lines` maps a
 * field to its 1-based line, for the message. A value may be quoted; `prs` is a
 * `[n, n]` list and `legacy` a boolean. Anything else is an error, never a
 * silently skipped field.
 */
export function parseEpicFile(text) {
  const all = text.replace(/^﻿/, '').split('\n');
  if (all[0]?.trim() !== '---')
    return { error: 'it must start with a --- front-matter line', line: 1 };
  const end = all.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1)
    return { error: 'its front matter has no closing --- line', line: 1 };
  const fields = {};
  const lines = {};
  for (let i = 1; i < end; i++) {
    const raw = all[i].replace(/\s+#.*$/, '');
    if (raw.trim() === '') continue;
    const m = /^([a-z]+):\s*(.*?)\s*$/.exec(raw);
    if (!m)
      return { error: `line ${i + 1} is not a "key: value" line`, line: i + 1 };
    const [, key, value] = m;
    if (key in fields) return { error: `"${key}" is set twice`, line: i + 1 };
    fields[key] = value.replace(/^(['"])(.*)\1$/, '$2');
    lines[key] = i + 1;
  }
  return { fields, lines, end: end + 1 };
}

/** The problems in one epic.md, as hits. */
function epicProblems(file, text, source) {
  const parsed = parseEpicFile(text);
  if (parsed.error)
    return [
      {
        line: parsed.line,
        text: `epic.md: ${parsed.error}`,
        key: 'front-matter',
      },
    ];
  const { fields, lines } = parsed;
  const hits = [];
  const at = (key) => lines[key] ?? 1;
  const bad = (key, message) =>
    hits.push({ line: at(key), text: message, key });
  for (const key of Object.keys(fields)) {
    if (!FIELDS.has(key))
      bad(key, `unknown field "${key}" (known: ${[...FIELDS].join(', ')})`);
  }
  for (const key of ['id', 'title', 'status']) {
    if (!fields[key]) bad(key, `missing "${key}"`);
  }
  const folder = folderOf(file);
  if (fields.id && fields.id !== nameOf(folder)) {
    bad('id', `id "${fields.id}" is not the folder's name "${nameOf(folder)}"`);
  }
  const { status } = fields;
  if (status && !EPIC_STATUSES.includes(status)) {
    bad(
      'status',
      `status "${status}" is not one of ${EPIC_STATUSES.join(', ')}`
    );
  }
  if (
    fields.legacy !== undefined &&
    !['true', 'false'].includes(fields.legacy)
  ) {
    bad('legacy', 'legacy must be true or false');
  }
  const legacy = fields.legacy === 'true';
  if (status && !DONE.has(status) && !legacy) {
    if (!fields.plan)
      bad('plan', `a ${status} epic names its plan ("plan: plan.md")`);
    else if (fields.plan !== 'plan.md')
      bad(
        'plan',
        `plan must be plan.md, the file the plan lint reads (not "${fields.plan}")`
      );
    else if (!source.has(`${folder}/${fields.plan}`)) {
      bad('plan', `plan "${fields.plan}" is not in ${folder}/`);
    }
  }
  if (fields.prs !== undefined) {
    const m = /^\[\s*((?:\d+\s*,\s*)*\d+)?\s*\]$/.exec(fields.prs);
    if (!m) bad('prs', 'prs must be a list of PR numbers, like [725, 730]');
    else if (SHIPPED.has(status) && !m[1])
      bad('prs', `a ${status} epic lists the PR(s) that shipped it`);
  } else if (SHIPPED.has(status)) {
    bad(
      'prs',
      `a ${status} epic lists the PR(s) that shipped it ("prs: [725]")`
    );
  }
  if (status === 'abandoned' && !fields.reason)
    bad('reason', 'an abandoned epic says why ("reason: …")');
  if (status === 'retro-done' && !source.has(`${folder}/retro.md`)) {
    bad('status', `a retro-done epic has its retro.md in ${folder}/`);
  }
  return hits;
}

/**
 * The problems in one plan.md: an epic folder must hold it beside epic.md, and
 * every `### WP-N` block names its Files, how to Verify it, and when it Passes.
 */
function planProblems(file, text, source) {
  if (!source.has(`${folderOf(file)}/epic.md`)) {
    return [
      {
        line: 1,
        text: `plan.md has no epic.md beside it in ${folderOf(file)}/`,
        key: 'no-epic',
      },
    ];
  }
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    // Any heading ends the open block first, so one WP can't borrow the next
    // WP's "Pass when:" line.
    if (
      /^#{1,3}\s/.test(lines[i]) &&
      blocks.length &&
      blocks.at(-1).end === undefined
    ) {
      blocks.at(-1).end = i;
    }
    const m = /^###\s+(WP\b[-\s]?[\w.]+)/.exec(lines[i]);
    if (m) blocks.push({ name: m[1], start: i });
  }
  if (blocks.length === 0) {
    return [
      { line: 1, text: 'the plan has no "### WP-N" blocks', key: 'no-wp' },
    ];
  }
  const hits = [];
  for (const block of blocks) {
    const body = lines.slice(block.start + 1, block.end ?? lines.length);
    for (const label of WP_LABELS) {
      const re = new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${label}`);
      if (!body.some((l) => re.test(l))) {
        hits.push({
          line: block.start + 1,
          text: `${block.name} has no "${label}" line`,
          key: `${block.name} ${label}`,
        });
      }
    }
  }
  return hits;
}

/**
 * The files a finished epic's folder may still hold. At retro-done the plan's
 * conclusions have moved to a durable home, so the plan, mockups and reports
 * are deleted; git keeps them.
 */
function folderProblems(file, text, source) {
  const parsed = parseEpicFile(text);
  if (parsed.error || !DONE.has(parsed.fields.status)) return [];
  const folder = folderOf(file);
  const keep = new Set([`${folder}/epic.md`, `${folder}/retro.md`]);
  return source.files
    .filter((f) => f.startsWith(`${folder}/`) && !keep.has(f))
    .sort()
    .map((f) => ({
      line: parsed.lines.status ?? 1,
      text: `${f} is still here at ${parsed.fields.status}: move what lasts to a durable home and delete it`,
      key: f,
    }));
}

export const WORKFLOW_EPIC_MATCHERS = {
  /**
   * An epic's lifecycle files. `match.check` picks the check:
   *   - 'lifecycle': epic.md's schema, and the plan.md lint (WF-EPIC);
   *   - 'folder': a finished epic's folder holds only epic.md and retro.md
   *     (DOC-PLAN).
   */
  'epic-file': {
    validate(rule) {
      if (!['lifecycle', 'folder'].includes(rule.match.check)) {
        throw new Error(
          `rule ${rule.id}: match.check must be 'lifecycle' or 'folder'`
        );
      }
    },
    file(rule, file, text, { source }) {
      const base = file.slice(file.lastIndexOf('/') + 1);
      let hits = [];
      if (rule.match.check === 'folder') {
        if (base === 'epic.md') hits = folderProblems(file, text, source);
      } else if (base === 'epic.md') {
        hits = epicProblems(file, text, source);
      } else if (base === 'plan.md') {
        hits = planProblems(file, text, source);
      }
      return { found: hits.length, hits };
    },
  },
};
