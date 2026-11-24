# <title>: retro

Shipped in #<pr> on <date>. What the epic taught, and where each lesson now lives.

## What worked
- …

## What didn't
- …

## Lessons

Each lesson has ONE durable home that CI can resolve (WF-LESSON):

- `rule:<ID>`: a rule in the architecture registry or a CI gate;
- `adr:NNNN`: an ADR in `docs/adr/`;
- `test:<path>`: a test file;
- `skill:<name> "phrase"` or `claude-md:<path> "phrase"`: the phrase must
  appear verbatim in that file;
- `prose-only: arch: …; type: …; rule: …; test: …; hook: …`: why each
  stronger home can't hold it.

| Lesson | Verdict | Home |
|---|---|---|
| … | rule now | rule:<ID> |
