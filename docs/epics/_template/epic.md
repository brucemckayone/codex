---
id: <id>
title: <title>
status: planned
plan: plan.md
prs: []
---

The lifecycle file for one epic. CI reads it (WF-EPIC, DOC-PLAN, WF-RETRO-DEBT),
and the bd-close hook reads it before an epic may be closed.

- **id** equals this folder's name.
- **status** moves forward only: planned → active → shipped → retro-done.
  `abandoned` closes an epic that won't ship; it needs a `reason:`.
- **plan** names `plan.md` until the retro (an epic adopted by W0 may set
  `legacy: true` instead, because its plan predates W0).
- **prs** lists the PR numbers once the epic has shipped.

Seven days after an epic becomes `shipped`, every PR into dev fails until its
retro lands (WF-RETRO-DEBT), except the retro PR and a `hotfix`-labelled PR.
