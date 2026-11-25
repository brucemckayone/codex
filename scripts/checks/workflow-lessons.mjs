/**
 * Every lesson lands somewhere real (W0 Codex-sqs36, L0 Codex-rmqfr): the
 * `lessons-table` matcher kind behind WF-LESSON.
 *
 * About 400 lessons lived in memory files and bd memories, outside git, against
 * six checks in CI. A lesson recorded only there is advice. So each retro.md,
 * and the ledger at docs/lessons.md, has a lessons table, and every lesson
 * names ONE home that CI can resolve:
 *
 *   | Lesson | Verdict | Home | Source |
 *   |---|---|---|---|
 *   | … | rule | rule:A1 | mem:feedback_x, bd:some-key |
 *
 * The Verdict is the rung of the mechanism ladder that holds the lesson:
 *   arch, type, rule, test, hook   a machine holds it (or will: a todo: home)
 *   already                        something in git holds it today
 *   prose-only                     judgement; no stronger rung can
 *
 * A Home is one of:
 *   rule:<ID>                   a rule in the registry or a CI gate
 *   adr:NNNN                    docs/adr/NNNN-*.md
 *   test:<path>                 a file that exists
 *   skill:<name> "phrase"       the phrase is in .claude/skills/<name>/
 *   claude-md:<path> "phrase"   the phrase is in that CLAUDE.md or AGENTS.md
 *   todo:<epic> "what"          a live epic will build it: docs/epics/<epic>/
 *                               epic.md exists and is not retro-done or
 *                               abandoned, so the promise can't outlive it
 *   prose-only: arch: …; type: …; rule: …; test: …; hook: …
 *                               why each stronger home can't hold it
 *
 * The Verdict and the Home must agree (VERDICT_HOMES): a `rule` verdict whose
 * home is only a phrase in a skill claims a machine that isn't there.
 *
 * The Source column is optional. When a table has one, every row names what it
 * stands for: `mem:<memory file>`, `bd:<key>` or `CLAUDE.md`, comma-separated.
 * CI can't see memory, so it checks the form only; whether every memory lesson
 * has a row is a local completeness check (L0 WP-2).
 *
 * A phrase is compared with its whitespace collapsed, so a wrapped line still
 * matches. Like every kind, it reads only through `ctx.source`.
 */

import { EPIC_DONE_STATUSES, parseEpicFile } from './workflow-epic.mjs';

export const PROSE_RUNGS = ['arch', 'type', 'rule', 'test', 'hook'];

/** The kinds of Home each Verdict may take. */
export const VERDICT_HOMES = {
  arch: ['rule', 'adr', 'test', 'todo'],
  type: ['test', 'rule', 'todo'],
  rule: ['rule', 'todo'],
  test: ['test', 'rule', 'todo'],
  hook: ['rule', 'test', 'todo'],
  already: ['rule', 'adr', 'test', 'skill', 'claude-md'],
  'prose-only': ['prose-only'],
};
export const VERDICTS = Object.keys(VERDICT_HOMES);

const SOURCE_ITEM = /^(?:(?:mem|bd):[\w./-]+|CLAUDE\.md)$/;

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * The lessons table under a `## Lessons` heading: `{ rows: [{ line, lesson,
 * verdict, home, source }] }` with 1-based lines, or `{ error, line }`.
 * `source` is null when the table has no Source column.
 */
export function lessonsTable(text, name = 'the file') {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Lessons\b/i.test(l));
  if (start === -1)
    return { error: `${name} has no "## Lessons" section`, line: 1 };
  let header = -1;
  for (
    let i = start + 1;
    i < lines.length && !/^#{1,2}\s/.test(lines[i]);
    i++
  ) {
    if (/^\s*\|/.test(lines[i])) {
      header = i;
      break;
    }
  }
  if (header === -1)
    return { error: 'the Lessons section has no table', line: start + 1 };
  const names = cells(lines[header]).map((c) => c.toLowerCase());
  const col = (name) => names.indexOf(name);
  if (col('lesson') === -1 || col('verdict') === -1 || col('home') === -1) {
    return {
      error: 'the lessons table needs Lesson, Verdict and Home columns',
      line: header + 1,
    };
  }
  if (!/^\s*\|?\s*:?-{3,}/.test(lines[header + 1] ?? '')) {
    return {
      error: 'the lessons table has no |---| row under its header',
      line: header + 2,
    };
  }
  const rows = [];
  for (let i = header + 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    const c = cells(lines[i]);
    rows.push({
      line: i + 1,
      lesson: c[col('lesson')] ?? '',
      verdict: c[col('verdict')] ?? '',
      home: (c[col('home')] ?? '').replace(/^`|`$/g, ''),
      source: col('source') === -1 ? null : (c[col('source')] ?? ''),
    });
  }
  if (rows.length === 0)
    return { error: 'the lessons table has no lessons', line: header + 1 };
  return { rows };
}

/**
 * Each kind of Home: its pattern, and why a match doesn't resolve (or null when
 * it does). Checked in order; the first pattern that matches decides.
 */
const HOMES = [
  [
    /^rule:\s*([A-Z][A-Z0-9-]*)$/,
    ([, id], { ruleIds }) =>
      ruleIds().includes(id)
        ? null
        : `rule:${id} is not a rule or CI gate in the registry`,
  ],
  [
    /^adr:\s*(\d{4})$/,
    ([, n], { source }) =>
      source.files.some(
        (f) => f.startsWith(`docs/adr/${n}-`) && f.endsWith('.md')
      )
        ? null
        : `adr:${n} has no docs/adr/${n}-*.md`,
  ],
  [
    /^test:\s*(\S+)$/,
    ([, path], { source }) =>
      source.has(path) ? null : `test:${path} does not exist`,
  ],
  [
    /^(skill|claude-md):\s*(\S+)\s+"(.+)"$/,
    ([, kind, where, phrase], { source }) => {
      const files =
        kind === 'skill'
          ? source.files.filter(
              (f) =>
                f.startsWith(`.claude/skills/${where}/`) && f.endsWith('.md')
            )
          : /(^|\/)(CLAUDE|AGENTS)\.md$/.test(where) && source.has(where)
            ? [where]
            : [];
      if (files.length === 0) {
        return kind === 'skill'
          ? `skill:${where} is not a skill in .claude/skills/`
          : `claude-md:${where} is not a CLAUDE.md or AGENTS.md that exists`;
      }
      const wanted = collapse(phrase);
      return files.some((f) => collapse(source.read(f)).includes(wanted))
        ? null
        : `the phrase "${phrase}" is not in ${kind === 'skill' ? `.claude/skills/${where}/` : where}`;
    },
  ],
  [
    /^todo:\s*([\w.-]+)\s+"(.+)"$/,
    ([, id], { source }) => {
      const file = `docs/epics/${id}/epic.md`;
      if (!source.has(file))
        return `todo:${id} has no ${file}: a pending home names the live epic that will build it`;
      const parsed = parseEpicFile(source.read(file));
      if (parsed.error) return `todo:${id}: ${file}: ${parsed.error}`;
      const { status } = parsed.fields;
      return EPIC_DONE_STATUSES.includes(status)
        ? `todo:${id} names an epic that is ${status}, so its promise is overdue: point the home at what holds the lesson now, or sort it again`
        : null;
    },
  ],
  [
    /^prose-only:\s*(.*)$/,
    ([, reasons]) => {
      const given = new Map();
      for (const part of reasons.split(';')) {
        const pm = /^\s*([a-z]+):\s*(.*?)\s*$/.exec(part);
        if (pm) given.set(pm[1], pm[2]);
      }
      const missing = PROSE_RUNGS.filter((r) => !given.get(r));
      return missing.length === 0
        ? null
        : `prose-only must say why each stronger home failed; missing: ${missing.join(', ')}`;
    },
  ],
];

const HOME_KIND = /^(rule|adr|test|skill|claude-md|todo|prose-only):/;

/** Why one Home doesn't resolve, or null when it does. */
function homeProblem(home, ctx) {
  for (const [pattern, check] of HOMES) {
    const m = pattern.exec(home);
    if (m) return check(m, ctx);
  }
  if (/^(skill|claude-md):/.test(home)) {
    return `${home.split(':')[0]}: needs a path and a "phrase" that must appear in it`;
  }
  if (/^todo:/.test(home)) {
    return 'todo: needs an epic id and a "what" the epic will build';
  }
  return `"${home || '(empty)'}" is not a home (rule:, adr:, test:, skill:, claude-md:, todo: or prose-only:)`;
}

/** Why a Verdict is not one of the ladder's, or doesn't fit its Home; or null. */
function verdictProblem(verdict, home) {
  const allowed = VERDICT_HOMES[verdict];
  if (!allowed) {
    return `verdict "${verdict || '(empty)'}" is not one of ${VERDICTS.join(', ')}`;
  }
  const kind = HOME_KIND.exec(home)?.[1];
  if (kind && !allowed.includes(kind)) {
    return `verdict ${verdict} can't take ${kind}: as its home (it takes ${allowed.map((k) => `${k}:`).join(', ')})`;
  }
  return null;
}

/** Why a Source cell is malformed, or null. */
function sourceProblem(source) {
  const items = source
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return 'a lesson with no Source';
  const bad = items.filter((s) => !SOURCE_ITEM.test(s));
  return bad.length === 0
    ? null
    : `source ${bad.map((s) => `"${s}"`).join(', ')} is not mem:<memory file>, bd:<key> or CLAUDE.md`;
}

export const WORKFLOW_LESSON_MATCHERS = {
  /**
   * Every lesson in a retro.md, or in the ledger, has a Verdict from the
   * ladder and a Home CI can resolve that fits it. `match.ruleIds()` returns
   * the registry's rule and gate ids, read lazily so the list is the registry
   * itself, never a copy.
   */
  'lessons-table': {
    validate(rule) {
      if (typeof rule.match.ruleIds !== 'function') {
        throw new Error(
          `rule ${rule.id}: match.ruleIds must be a function returning the rule and gate ids`
        );
      }
    },
    file(rule, file, text, { source }) {
      const table = lessonsTable(text, file.slice(file.lastIndexOf('/') + 1));
      if (table.error) {
        return {
          found: 1,
          hits: [{ line: table.line, text: table.error, key: 'table' }],
        };
      }
      const hits = [];
      for (const row of table.rows) {
        if (!row.lesson) {
          hits.push({
            line: row.line,
            text: 'a lesson row with no lesson',
            key: `row ${row.line}`,
          });
          continue;
        }
        const key = row.lesson.slice(0, 60);
        const problems = [
          ['verdict', verdictProblem(row.verdict, row.home)],
          [
            'home',
            homeProblem(row.home, { source, ruleIds: rule.match.ruleIds }),
          ],
          ['source', row.source === null ? null : sourceProblem(row.source)],
        ];
        for (const [what, problem] of problems) {
          if (problem)
            hits.push({
              line: row.line,
              text: problem,
              key: `${key} (${what})`,
            });
        }
      }
      return { found: hits.length, hits };
    },
  },
};
