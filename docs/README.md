# Docs index

Every doc under `docs/` is listed here, so it can be found and kept current.
A doc this page doesn't link to, directly or through its folder, fails the
architecture gate's [DOC-INDEX](architecture/rules.md#doc-index) rule.

The docs that existed on 2026-11-17 are held in the gate's baseline until
they are sorted into the sections below (step D2 of the docs clean-up). A new
doc must be listed from the start: add it under its section, or under
**New docs** if none fits yet.

## What goes where

The kind of doc decides its home and its lifetime; the topic doesn't.

| Kind | Answers | Home | Lifetime |
|---|---|---|---|
| Guide | How do I work here? | `CLAUDE.md` beside the code; `.claude/skills/` for procedures | Changes in the PR that changes the pattern |
| Reference | What is the system, and what are its rules? | `docs/architecture/` (cross-cutting) or `docs/<domain>/` | Changes in the PR that changes the behaviour |
| Decision | Why is it like this? | `docs/adr/` | Immutable; a newer ADR supersedes it |
| Plan | What are we about to build? | `docs/epics/<epic>/` | Until the retro: promote what lasts, then delete |
| Report | What did we find? | Findings become beads; the text goes in the epic folder | Until its findings are filed |
| Session | Where did I leave off? | `docs/handover` (gitignored) | Local; no tracked file may cite it |

## Reference

- [Architecture rules](architecture/rules.md): every rule the architecture
  gate enforces, generated from its registry.

## Decisions

- [Architecture decision records](adr/)

## Epics

- [Epic conventions](epics/conventions.md)
- [Epic folders](epics/): one folder per epic holding its `epic.md`
  lifecycle file, its plan while live, and its retro. Start one from the
  [templates](epics/_template/).

## New docs

None yet.
