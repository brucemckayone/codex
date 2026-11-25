# <title>: retro

Shipped in #<pr> on <date>. What the epic taught, and where each lesson now lives.

## What worked
- …

## What didn't
- …

## Lessons

Each lesson takes a Verdict, the rung of the mechanism ladder that holds it,
and ONE durable home that CI can resolve and that fits the verdict (WF-LESSON):

- `arch`: a seam or boundary makes the mistake impossible. Takes `rule:`,
  `adr:`, `test:` or `todo:`.
- `type`: the type system rejects it. Takes `test:`, `rule:` or `todo:`.
- `rule`: a lint or registry rule fails on it. Takes `rule:` or `todo:`.
- `test`: a test fails on it. Takes `test:`, `rule:` or `todo:`.
- `hook`: an agent hook refuses it. Takes `rule:`, `test:` or `todo:`.
- `already`: something in git holds it today. Takes `rule:`, `adr:`,
  `test:`, `skill:` or `claude-md:`.
- `prose-only`: judgement no machine can hold. Takes `prose-only:`.

(The first table under this heading is the lessons table, so these stay a
list.) The homes:

- `rule:<ID>`: a rule in the architecture registry or a CI gate;
- `adr:NNNN`: an ADR in `docs/adr/`;
- `test:<path>`: a test file;
- `skill:<name> "phrase"` or `claude-md:<path> "phrase"`: the phrase must
  appear verbatim in that file;
- `todo:<epic> "what"`: a live epic (its `epic.md` not retro-done or
  abandoned) will build it. It stops resolving when that epic closes;
- `prose-only: arch: …; type: …; rule: …; test: …; hook: …`: why each
  stronger home can't hold it.

| Lesson | Verdict | Home |
|---|---|---|
| … | rule | rule:<ID> |
