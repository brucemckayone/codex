/**
 * The WF-BD-CLOSE hook's self-test (W0, Codex-sqs36): what it refuses, what
 * it lets through, the Claude Code contract (stdin JSON in, exit 2 and stderr
 * out), and that the tracked .claude/settings.json still wires it. bd itself
 * is stubbed: CI has no beads database.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  bdCalls,
  closeIntent,
  decide,
  HOOK_SCRIPT,
  readEpicStatuses,
  SETTINGS_FILE,
  simpleCommands,
  wiringProblem,
} from './bd-close-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const GUARD = join(HERE, 'bd-close-guard.mjs');
const temps = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bd-close-guard-'));
  temps.push(dir);
  return dir;
};
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const epicMd = (id, status) =>
  `---\nid: ${id}\ntitle: An epic\nstatus: ${status}\nprs: [1]\nreason: dormant\n---\n`;

/** decide() with bd and the epic files stubbed: `issues` by id, `epics` id → statuses. */
const judge = (
  command,
  { issues = {}, epics = {}, cwd = '/repo', showError } = {}
) => {
  const calls = [];
  const verdict = decide(
    { command, cwd },
    {
      showIssues(ids, globals, dir) {
        calls.push({ ids, globals, dir });
        if (showError) throw new Error(showError);
        return ids
          .filter((id) => issues[id])
          .map((id) => ({ id, status: 'open', ...issues[id] }));
      },
      readEpicStatuses: (id) => ({
        path: `docs/epics/${id}/epic.md`,
        statuses: epics[id] ?? [],
      }),
    }
  );
  return { ...verdict, calls };
};
const EPIC = { issue_type: 'epic' };
const TASK = { issue_type: 'task' };

describe('WF-BD-CLOSE: reading a command line', () => {
  test('WF-BD-CLOSE: a command line splits into its simple commands, quotes and substitutions resolved', () => {
    assert.deepEqual(
      simpleCommands(`cd "a b" && bd close X; echo 'bd close Y' | cat`),
      [['cd', 'a b'], ['bd', 'close', 'X'], ['echo', 'bd close Y'], ['cat']]
    );
    assert.deepEqual(
      simpleCommands('x=$(bd close X) # bd close Z\nbd\\\n close W'),
      [['x='], ['bd', 'close', 'X'], ['bd', 'close', 'W']]
    );
    assert.deepEqual(simpleCommands('echo "$(bd close X)" (bd done Y)'), [
      ['bd', 'close', 'X'],
      ['echo', ''],
      ['bd', 'done', 'Y'],
    ]);
  });

  test('WF-BD-CLOSE: bd is found behind env assignments, wrappers, a path and sh -c', () => {
    assert.deepEqual(bdCalls('BEADS_ACTOR=me /opt/homebrew/bin/bd close X'), [
      ['close', 'X'],
    ]);
    assert.deepEqual(bdCalls('command bd close X && env -u A bd done Y'), [
      ['close', 'X'],
      ['done', 'Y'],
    ]);
    assert.deepEqual(bdCalls(`bash -lc "bd close X"`), [['close', 'X']]);
    assert.deepEqual(bdCalls('echo X | xargs -n 1 bd close'), [['close']]);
    assert.deepEqual(bdCalls('git commit -m "bd close X" && grep -r bd .'), []);
  });

  test('WF-BD-CLOSE: close, done and update --status closed name their ids; flag values are not ids', () => {
    assert.deepEqual(closeIntent(['close', 'A', 'B']), {
      ids: ['A', 'B'],
      globals: [],
    });
    assert.deepEqual(
      closeIntent(['-q', '--actor', 'me', 'done', 'A', '--force', '-r', 'B']),
      {
        ids: ['A'],
        globals: [],
      }
    );
    assert.deepEqual(
      closeIntent(['-C', '../w', 'close', 'A', '--db=x.db', '--reason=why']),
      {
        ids: ['A'],
        globals: ['-C', '../w', '--db', 'x.db'],
      }
    );
    for (const status of [
      ['-s', 'closed'],
      ['-sclosed'],
      ['-s=closed'],
      ['--status', 'closed'],
      ['--status=closed'],
    ]) {
      assert.deepEqual(
        closeIntent(['update', 'A', '--title', 'B', ...status]),
        { ids: ['A'], globals: [] },
        status.join(' ')
      );
    }
    assert.equal(closeIntent(['update', 'A', '-s', 'in_progress']), null);
    assert.equal(closeIntent(['update', 'A', '--title', 'closed']), null);
    assert.equal(closeIntent(['show', 'A']), null);
    assert.equal(closeIntent(['epic', 'status', 'A']), null);
  });

  test('WF-BD-CLOSE: bd epic close-eligible, and a close with no id, are refused outright', () => {
    assert.match(
      closeIntent(['epic', 'close-eligible']).refuse,
      /close-eligible/
    );
    assert.equal(closeIntent(['epic', 'close-eligible', '--dry-run']), null);
    assert.match(closeIntent(['close']).refuse, /last touched/);
    assert.match(
      closeIntent(['update', '-s', 'closed']).refuse,
      /last touched/
    );
  });
});

describe('WF-BD-CLOSE: the verdict', () => {
  test('WF-BD-CLOSE: closing an epic whose epic.md is missing or not done is refused, with the reason', () => {
    const none = judge('bd close E', { issues: { E: EPIC } });
    assert.equal(none.ok, false);
    assert.match(none.reason, /E is an epic with no docs\/epics\/E\/epic\.md/);
    const active = judge('bd update E -s closed --force', {
      issues: { E: EPIC },
      epics: { E: ['active'] },
    });
    assert.equal(active.ok, false);
    assert.match(active.reason, /says "active"/);
    // One bad id in a list refuses the whole call: bd would close them together.
    assert.equal(
      judge('bd close T E', { issues: { T: TASK, E: EPIC } }).ok,
      false
    );
  });

  test('WF-BD-CLOSE: a retro-done or abandoned epic, a closed one, a non-epic and an unknown id pass', () => {
    assert.equal(
      judge('bd close E', { issues: { E: EPIC }, epics: { E: ['retro-done'] } })
        .ok,
      true
    );
    // The local copy may lag a merged retro PR: origin/dev's copy counts too.
    assert.equal(
      judge('bd close E', {
        issues: { E: EPIC },
        epics: { E: ['shipped', 'abandoned'] },
      }).ok,
      true
    );
    assert.equal(
      judge('bd close E', { issues: { E: { ...EPIC, status: 'closed' } } }).ok,
      true
    );
    assert.equal(judge('bd close T', { issues: { T: TASK } }).ok, true);
    assert.equal(judge('bd close Nope').ok, true);
  });

  test('WF-BD-CLOSE: when bd cannot answer, a close is refused, never waved through', () => {
    const v = judge('bd close E', { showError: 'database is locked' });
    assert.equal(v.ok, false);
    assert.match(
      v.reason,
      /could not check whether E is an epic \(bd show failed: database is locked\)/
    );
  });

  test('WF-BD-CLOSE: a command without bd never asks bd anything', () => {
    for (const command of [
      'ls -la',
      'pnpm test',
      'git log --oneline',
      'cat abd.txt',
      'bdx close E',
    ]) {
      const v = judge(command, { showError: 'must not be called' });
      assert.equal(v.ok, true, command);
      assert.equal(v.calls.length, 0, command);
    }
  });

  test('WF-BD-CLOSE: bd -C checks the epic in that checkout', () => {
    const v = judge('bd -C ../w close E', {
      issues: { E: EPIC },
      epics: { E: ['retro-done'] },
      cwd: '/repo/main',
    });
    assert.equal(v.ok, true);
    assert.equal(v.calls[0].dir, '/repo/w');
    assert.deepEqual(v.calls[0].globals, ['-C', '../w']);
  });

  test('WF-BD-CLOSE: epic.md is read from the checkout and from its origin/dev', () => {
    const repo = tempDir();
    const git = (...args) => {
      const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git('init', '-q', '-b', 'dev');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(join(repo, 'docs/epics/E'), { recursive: true });
    writeFileSync(
      join(repo, 'docs/epics/E/epic.md'),
      epicMd('E', 'retro-done')
    );
    git('add', '.');
    git('commit', '-qm', 'retro');
    git('update-ref', 'refs/remotes/origin/dev', git('rev-parse', 'HEAD'));
    writeFileSync(join(repo, 'docs/epics/E/epic.md'), epicMd('E', 'shipped'));
    assert.deepEqual(readEpicStatuses('E', join(repo, 'docs')), {
      path: 'docs/epics/E/epic.md',
      statuses: ['shipped', 'retro-done'],
    });
    assert.deepEqual(readEpicStatuses('F', repo).statuses, []);
  });
});

describe('WF-BD-CLOSE: the Claude Code hook contract', () => {
  /** The guard run as Claude Code runs it: the payload on stdin, a stub bd on PATH. */
  const hook = (command, cwd, fail) => {
    const bin = tempDir();
    const marker = join(bin, 'called');
    writeFileSync(
      join(bin, 'bd'),
      [
        '#!/bin/sh',
        `echo "$*" >> "${marker}"`,
        fail ? `echo ${JSON.stringify(fail)} >&2; exit 1` : '',
        'out=""',
        'sep=""',
        'for a in "$@"; do',
        '  case "$a" in',
        '    Epic-*) out="$out$sep{\\"id\\":\\"$a\\",\\"issue_type\\":\\"epic\\",\\"status\\":\\"open\\"}"; sep="," ;;',
        '    Task-*) out="$out$sep{\\"id\\":\\"$a\\",\\"issue_type\\":\\"task\\",\\"status\\":\\"open\\"}"; sep="," ;;',
        '  esac',
        'done',
        'echo "[$out]"',
        '',
      ].join('\n')
    );
    chmodSync(join(bin, 'bd'), 0o755);
    const result = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        cwd,
      }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return {
      ...result,
      bdCalled: existsSync(marker) ? readFileSync(marker, 'utf8') : null,
    };
  };

  test('WF-BD-CLOSE: the hook exits 2 with the reason on stderr for an epic, and 0 for a task', () => {
    const repo = tempDir();
    const refused = hook('bd close Epic-a1 --force', repo);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(
      refused.stderr,
      /WF-BD-CLOSE refused this bd call:\nEpic-a1 is an epic with no docs\/epics\/Epic-a1\/epic\.md/
    );
    assert.equal(refused.bdCalled, 'show Epic-a1 --json\n');

    mkdirSync(join(repo, 'docs/epics/Epic-a1'), { recursive: true });
    writeFileSync(
      join(repo, 'docs/epics/Epic-a1/epic.md'),
      epicMd('Epic-a1', 'abandoned')
    );
    assert.equal(hook('bd close Epic-a1', repo).status, 0);
    assert.equal(hook('bd close Task-b2', repo).status, 0);
  });

  test('WF-BD-CLOSE: the hook refuses when bd fails, and passes when bd finds none of the ids', () => {
    const locked = hook(
      'bd close Epic-a1',
      tempDir(),
      'Error: database is locked'
    );
    assert.equal(locked.status, 2, locked.stderr);
    assert.match(
      locked.stderr,
      /could not check whether Epic-a1 is an epic \(bd show failed/
    );
    // bd 1.2.2 exits 1 when none of the ids exist; nothing is closed then.
    const none = hook(
      'bd close Nope-1',
      tempDir(),
      'Error fetching Nope-1: no issue found matching "Nope-1"'
    );
    assert.equal(none.status, 0, none.stderr);
  });

  test('WF-BD-CLOSE: the hook ignores other tools, other commands and a payload that is not JSON', () => {
    const quiet = hook('pnpm test && git status', tempDir());
    assert.equal(quiet.status, 0);
    assert.equal(quiet.bdCalled, null, 'a command without bd starts no bd');
    const edit = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'x' },
      }),
      encoding: 'utf8',
    });
    assert.equal(edit.status, 0);
    assert.equal(
      spawnSync(process.execPath, [GUARD], {
        input: 'not json',
        encoding: 'utf8',
      }).status,
      0
    );
  });

  test('WF-BD-CLOSE: the tracked .claude/settings.json runs the guard on every Bash call', () => {
    assert.equal(
      wiringProblem(readFileSync(join(ROOT, SETTINGS_FILE), 'utf8')),
      null
    );
    const check = spawnSync(process.execPath, [GUARD, '--check-wiring'], {
      encoding: 'utf8',
    });
    assert.equal(check.status, 0, check.stderr);
  });

  test('WF-BD-CLOSE: the wiring check fails when the hook is gone, narrowed, made async or the file is broken', () => {
    const wire = (entry) => JSON.stringify({ hooks: { PreToolUse: [entry] } });
    const good = {
      type: 'command',
      command: `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT}"`,
      onFailure: 'block',
    };
    assert.equal(wiringProblem(wire({ matcher: 'Bash', hooks: [good] })), null);
    for (const [why, text] of [
      ['no hooks', '{}'],
      ['another tool', wire({ matcher: 'Edit', hooks: [good] })],
      [
        'another script',
        wire({
          matcher: 'Bash',
          hooks: [{ ...good, command: 'node other.mjs' }],
        }),
      ],
      [
        'an if filter',
        wire({ matcher: 'Bash', hooks: [{ ...good, if: 'Bash(bd *)' }] }),
      ],
      ['async', wire({ matcher: 'Bash', hooks: [{ ...good, async: true }] })],
      // A timeout or a crash would let the command run (review round 1).
      [
        'fails open',
        wire({ matcher: 'Bash', hooks: [{ ...good, onFailure: undefined }] }),
      ],
      ['not JSON', '{ "hooks": '],
    ]) {
      assert.notEqual(wiringProblem(text), null, why);
    }
  });
});

describe('WF-BD-CLOSE: review round 1, a test for each finding', () => {
  test('WF-BD-CLOSE: bd inside if, a loop, a brace group or after !, and behind timeout or nice, is found', () => {
    for (const command of [
      'if bd close E --reason done; then echo ok; fi',
      'for id in E; do bd close E; done',
      'while read x; do bd close E; done < ids',
      'until false; do bd close E; done',
      'if true; then :; else bd close E; fi',
      'if false; then :; elif bd close E; then :; fi',
      '{ bd close E; }',
      '! bd close E',
      'timeout 60 bd close E',
      'gtimeout 60 bd close E',
      'nice -n 5 bd close E',
      'stdbuf -oL bd close E',
      'caffeinate -i bd close E',
      'doas bd close E',
    ]) {
      assert.equal(judge(command, { issues: { E: EPIC } }).ok, false, command);
    }
  });

  test('WF-BD-CLOSE: an id the guard cannot read is refused; a short-flag cluster and bd todo done are read as bd reads them', () => {
    for (const command of [
      'EPIC=E; bd close "$EPIC"',
      'bd close $EPIC',
      'bd close "$(cat id)"',
      'echo E | xargs -I{} bd close {}',
      'bd close E*',
    ]) {
      const v = judge(command, { issues: { E: EPIC } });
      assert.equal(v.ok, false, command);
      assert.match(v.reason, /Name each id literally/, command);
    }
    assert.equal(
      judge('bd update E -qs closed', { issues: { E: EPIC } }).ok,
      false
    );
    assert.equal(judge('bd todo done E', { issues: { E: EPIC } }).ok, false);
    assert.equal(judge('bd todo done T', { issues: { T: TASK } }).ok, true);
    assert.deepEqual(closeIntent(['-qC', '../w', 'close', 'A']), {
      ids: ['A'],
      globals: ['-C', '../w'],
    });
    assert.deepEqual(closeIntent(['-qC../w', 'close', 'A']), {
      ids: ['A'],
      globals: ['-C', '../w'],
    });
  });

  test('WF-BD-CLOSE: a chain of closes asks bd once per checkout, so it stays inside the hook timeout', () => {
    const v = judge('bd close A && bd close B --reason x && bd done E', {
      issues: { E: EPIC },
    });
    assert.equal(v.ok, false);
    assert.equal(v.calls.length, 1);
    assert.deepEqual(v.calls[0].ids, ['A', 'B', 'E']);
    // Another checkout is another database: its own bd show.
    assert.equal(
      judge('bd close A && bd -C ../w close B', { issues: {} }).calls.length,
      2
    );
  });
});
