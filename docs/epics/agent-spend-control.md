# Agent spend control

**Owner decision, 2026-08-30:** *"I absolutely do not want to go over limits during
this development phase."*

This document exists because a spend cap was hit **mid-workflow** on 2026-08-30,
and the way it failed was worse than the cost.

---

## §1 — What happened, with the real numbers

Two workflows on one epic (`Codex-c5962`, the data-access contract):

| run | agents | subagent tokens | tool uses | wall clock | outcome |
|---|---|---|---|---|---|
| implementation | 8 | **1,502,031** | 546 | 100 min | 8/8 completed |
| fixes + reverify | 10 | **1,211,142** | 497 | 34 min | **4/10 completed, 6 killed** |

**~2.71M subagent output tokens on one epic**, and the cap landed in the middle of
the second run.

### The failure mode that matters

The cap did not stop work cleanly. It killed six agents, and **three of them had
already written their files and died before reporting**. The tree therefore looked
complete: the gate passed, `typecheck` was green, `git status` showed plausible
edits.

One of those agents was fixing a P0 authorization cache. It had written:

- the constant — `MEMBERSHIP_CACHE_TTL_SECONDS = 60`
- the comment asserting it — *"with the 60s authorization bound above"*
- the test asserting it — `expect(options).toEqual({ expirationTtl: 60 })`

…and **not the two lines that applied it.** Two of those three artefacts read to a
reviewer as evidence the work was done. Only running the full suite caught it.

> **A mid-flight cap kill produces work that looks finished. Budget exhaustion is
> not a cost problem, it is a correctness problem.**

Also lost: all three review lenses. On the *first* round those lenses had found
seven defects nobody anticipated, including the P0. Losing them meant shipping with
no equivalent signal — which is why they had to be re-run in a later session
anyway. **The overrun bought nothing; it just moved the spend and added risk.**

---

## §2 — Planning numbers

Derived from the runs above. Use these until better ones exist.

| unit of work | budget | basis |
|---|---|---|
| implementation agent (writes code, runs tests, falsifies) | **~230k** | see the correction below |
| review lens (read-only, `effort: high`/`max`) | **~230k** | same — a thorough lens is not cheaper than an implementer |
| mechanical agent (`effort: low`, single file) | **~60k** | estimate — refine when measured |
| **a 6-WP epic with one review round** | **~1.5M** | measured |
| **the same epic with a fix round + re-review** | **~2.7M** | measured — this exceeded the cap |

**Rule of thumb: `agents × 230k`.** Anything estimating over **1M** gets a
pre-flight check.

### 2.1 First estimate-vs-actual, and it was 22% low

The `agents × 190k` figure above came from one run. It was tested on the next one —
3 review lenses + 2 implementation agents — and under-predicted:

| | estimate | actual |
|---|---|---|
| 5 agents | ~800k | **1,158,957** |

**~232k per agent, not 190k.** Two things the miss teaches:

- **A read-only review lens is not cheaper than an implementer.** I budgeted 120k
  for a lens because it writes nothing. But a lens that actually falsifies —
  compiling probes, injecting violations, reverting and checksumming — does as much
  work as a fix agent. `effort: 'max'` costs what it says.
- **Round up, and re-measure every run.** The planning figure is now 230k. Record
  the next estimate-vs-actual here rather than trusting this line; the whole point
  of the number is that it gets corrected, not believed.

---

## §3 — The plan

### 3.1 Pre-flight, before launching any workflow

1. **Estimate**: `agents × 230k`. Write the number down.
2. If the estimate exceeds **1M**, run `/usage-credits` and confirm headroom
   *before* launching. Do not launch on the assumption there is room.
3. **Commit first.** A clean tree before launch means a mid-flight kill leaves a
   revert point, and `git status` alone tells you exactly what an agent wrote.
   This is the cheapest single safeguard and it costs nothing.

### 3.2 Set an explicit turn budget so the script can refuse

This is the highest-leverage mechanism, because it converts a mid-flight kill into
a **clean stop before an agent starts**.

`budget.total` is `null` unless the turn carries an explicit target, and a `null`
total makes `budget.remaining()` `Infinity` — so guards silently do nothing. With a
target set, a script can decline to start work it cannot finish:

```js
// Refuse to spawn an agent we cannot afford to complete.
const AGENT_COST = 230_000
for (const item of work) {
  if (budget.total && budget.remaining() < AGENT_COST * 1.5) {
    log(`STOPPING EARLY: ${budget.remaining()} left, need ${AGENT_COST}. ` +
        `${work.length - done.length} items not started.`)
    break                          // a named, reported stop — not a kill
  }
  done.push(await agent(promptFor(item), { label: item.key }))
}
```

Two rules that follow:

- **Guard on `budget.total &&`** — without it the guard is dead code.
- **`log()` what you dropped.** A silent truncation reads as "covered everything".

### 3.3 Structural rules — shrink the blast radius

| rule | why |
|---|---|
| **One WP per workflow, not six.** | A 6-WP fan-out makes a single failure expensive and hard to attribute. |
| **Review lenses SEQUENTIAL, not parallel.** | Three parallel lenses all died together. Sequential means a cap costs one lens and you keep the others' findings. |
| **Falsification in the main chat.** | The five inject-and-revert checks that proved every fix load-bearing cost ~0 agent tokens. This was the highest value-per-token verification in the whole session. |
| **`effort: 'low'` + a cheaper model for mechanical stages.** | Reserve `high`/`max` for verify and judge stages, where the reasoning is the product. |
| **Never spawn an agent to read a file you can read.** | A `grep` in the main chat is free by comparison. |
| **Keep the ≤15-agent guideline** (`/config` → "Dynamic workflow size"). | It is a cost ceiling as much as a concurrency one. |

### 3.4 Recovery — a cap kill is cheap to resume, if you resume correctly

```
Workflow({ scriptPath: '<path from the tool result>', resumeFromRunId: '<runId>' })
```

Completed agents replay **from cache at no cost**; only the killed ones re-run. Both
are returned in every Workflow tool result — **record them before doing anything
else.**

But before resuming, do §3.5. A resumed agent may redo work whose files are already
on disk.

### 3.5 After ANY interrupted run — verify each fix individually

An aggregate green gate is not evidence. The P0's missing TTL passed `typecheck`
57/57, `biome` clean, and the contract gate at exit 0.

- [ ] For each fix the run was meant to make, **grep for the change itself** — not
      for its constant, its comment, or its test.
- [ ] Run the **full scoped suite** per touched package. A dead agent's assertion
      may already be red.
- [ ] **Falsify** each fix: revert it, confirm the test goes red, restore, checksum.
- [ ] Verify any injection **landed on an executable line** before believing its
      result. A prior attempt patched a symbol inside a *comment* and drew the
      opposite conclusion.
- [ ] Verify the injection is a shape the check is *supposed* to reject. A second
      attempt "disproved" a gate tightening with
      `const w = kv.put(...); cacheWrite?.(w)` — legal by ASSIGNMENT regardless of
      the tightening, so it exercised nothing. Both failures are the same one the
      whole epic is about: **a check that returns a verdict without reaching the
      thing it claims to check.** Ask what the probe would have to look like to
      fail, before running it.
- [ ] `git status` — name every unexpected path.

---

## §4 — Pre-flight checklist

```
[ ] Working tree committed (clean revert point)
[ ] Agent count × 230k written down
[ ] If > 1M: /usage-credits checked, headroom confirmed
[ ] Turn budget set, and the script guards on budget.total && remaining()
[ ] Review lenses sequential
[ ] Falsification planned for the main chat, not for agents
[ ] runId + scriptPath recorded from the tool result
```

---

## §5 — Rules worth promoting to CLAUDE.md

Candidates, once these have survived a second epic:

- **MUST** commit before launching a workflow — a mid-flight kill must leave a clean
  revert point.
- **MUST** guard `agent()` calls on `budget.total && budget.remaining()` and `log()`
  anything dropped.
- **MUST** verify each fix individually after any interrupted run — an aggregate
  green gate hid a missing security bound.
- **NEVER** run review lenses in parallel when budget is constrained.

---

## Related

- `docs/epics/conventions.md` — how an epic is scoped and run
- `docs/handover/` — `/handover` and `/pickup`, which is how an interrupted session
  hands its state on
- `Codex-c5962` — the epic these numbers come from
- `Codex-rxjwp` — the P0 whose half-applied fix is §1's example
