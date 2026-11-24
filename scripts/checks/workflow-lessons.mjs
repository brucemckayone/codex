/**
 * A retro's lessons land somewhere real (W0, Codex-sqs36): the
 * `lessons-table` matcher kind behind WF-LESSON.
 *
 * About 400 lessons lived in memory files and bd memories, outside git, against
 * six checks in CI. A lesson recorded only there is advice. So each retro.md
 * has a lessons table, and every lesson names ONE home that CI can resolve:
 *
 *   | Lesson | Verdict | Home |
 *   |---|---|---|
 *   | … | rule now | rule:A1 |
 *
 * A Home is one of:
 *   rule:<ID>                   a rule in the registry or a CI gate
 *   adr:NNNN                    docs/adr/NNNN-*.md
 *   test:<path>                 a file that exists
 *   skill:<name> "phrase"       the phrase is in .claude/skills/<name>/
 *   claude-md:<path> "phrase"   the phrase is in that CLAUDE.md or AGENTS.md
 *   prose-only: arch: …; type: …; rule: …; test: …; hook: …
 *                               why each stronger home can't hold it
 *
 * A phrase is compared with its whitespace collapsed, so a wrapped line still
 * matches. Like every kind, it reads only through `ctx.source`.
 */

export const PROSE_RUNGS = ['arch', 'type', 'rule', 'test', 'hook'];

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * The lessons table under a `## Lessons` heading: `{ rows: [{ line, home }] }`
 * with 1-based lines, or `{ error, line }`.
 */
export function lessonsTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^##\s+Lessons\b/i.test(l));
  if (start === -1) return { error: 'retro.md has no "## Lessons" section', line: 1 };
  let header = -1;
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
    if (/^\s*\|/.test(lines[i])) {
      header = i;
      break;
    }
  }
  if (header === -1) return { error: 'the Lessons section has no table', line: start + 1 };
  const names = cells(lines[header]).map((c) => c.toLowerCase());
  const col = (name) => names.indexOf(name);
  if (col('lesson') === -1 || col('verdict') === -1 || col('home') === -1) {
    return {
      error: 'the lessons table needs Lesson, Verdict and Home columns',
      line: header + 1,
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
    });
  }
  if (rows.length === 0) return { error: 'the lessons table has no lessons', line: header + 1 };
  return { rows };
}

/** Why one Home doesn't resolve, or null when it does. */
function homeProblem(home, { source, ruleIds }) {
  let m;
  if ((m = /^rule:\s*([A-Z][A-Z0-9-]*)$/.exec(home))) {
    return ruleIds().includes(m[1]) ? null : `rule:${m[1]} is not a rule or CI gate in the registry`;
  }
  if ((m = /^adr:\s*(\d{4})$/.exec(home))) {
    const found = source.files.some((f) => f.startsWith(`docs/adr/${m[1]}-`) && f.endsWith('.md'));
    return found ? null : `adr:${m[1]} has no docs/adr/${m[1]}-*.md`;
  }
  if ((m = /^test:\s*(\S+)$/.exec(home))) {
    return source.has(m[1]) ? null : `test:${m[1]} does not exist`;
  }
  if ((m = /^(skill|claude-md):\s*(\S+)\s+"(.+)"$/.exec(home))) {
    const [, kind, where, phrase] = m;
    const files =
      kind === 'skill'
        ? source.files.filter((f) => f.startsWith(`.claude/skills/${where}/`) && f.endsWith('.md'))
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
  }
  if ((m = /^prose-only:\s*(.*)$/.exec(home))) {
    const given = new Map();
    for (const part of m[1].split(';')) {
      const pm = /^\s*([a-z]+):\s*(.*?)\s*$/.exec(part);
      if (pm) given.set(pm[1], pm[2]);
    }
    const missing = PROSE_RUNGS.filter((r) => !given.get(r));
    return missing.length === 0
      ? null
      : `prose-only must say why each stronger home failed; missing: ${missing.join(', ')}`;
  }
  if (/^(skill|claude-md):/.test(home)) {
    return `${home.split(':')[0]}: needs a path and a "phrase" that must appear in it`;
  }
  return `"${home || '(empty)'}" is not a home (rule:, adr:, test:, skill:, claude-md: or prose-only:)`;
}

export const WORKFLOW_LESSON_MATCHERS = {
  /**
   * Every lesson in a retro.md has a Home CI can resolve. `match.ruleIds()`
   * returns the registry's rule and gate ids, read lazily so the list is the
   * registry itself, never a copy.
   */
  'lessons-table': {
    validate(rule) {
      if (typeof rule.match.ruleIds !== 'function') {
        throw new Error(`rule ${rule.id}: match.ruleIds must be a function returning the rule and gate ids`);
      }
    },
    file(rule, _file, text, { source }) {
      const table = lessonsTable(text);
      if (table.error) {
        return { found: 1, hits: [{ line: table.line, text: table.error, key: 'table' }] };
      }
      const hits = [];
      for (const row of table.rows) {
        if (!row.lesson) {
          hits.push({ line: row.line, text: 'a lesson row with no lesson', key: `row ${row.line}` });
          continue;
        }
        const problem = homeProblem(row.home, { source, ruleIds: rule.match.ruleIds });
        if (problem) hits.push({ line: row.line, text: problem, key: `${row.lesson.slice(0, 60)}` });
      }
      return { found: hits.length, hits };
    },
  },
};
