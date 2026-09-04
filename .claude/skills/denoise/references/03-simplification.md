# Reference 03 — Simplification Audit

> Loaded by `/denoise --phase=simplification` regardless of scope. Pair with the relevant domain reference (05/06/07).
> No required MCPs (static-only audit). Optional: `svelte-autofixer`, `chrome-devtools` for visual regression on apps/web simplifications.

---

## §0 — When this reference applies

Every cell where `--phase=simplification`. This is the phase that catches code shape drift — over-abstraction, duplication, wrappers around wrappers, layered DTOs that don't transform, naming inconsistency, premature future-proofing.

**Crucially**: this phase does NOT exempt findings from the proof-test gate. Every simplification finding still requires evidence per `SKILL.md` §6 — but the test forms are structural rather than behavioural. See §6 below.

If a finding's only action is "delete this export, no behaviour change" → route to `/fallow-audit` (denoise doesn't compete).

---

## §1 — Duplication detection (jscpd)

`jscpd` (JavaScript copy-paste detector) is the static tool. Wrap programmatically via `scripts/denoise/jscpd-budget.ts`:

```bash
npx jscpd packages/<pkg>/src --threshold 5 --reporters json --output /tmp/denoise-{{ITER_ID}}-jscpd.json
```

Output JSON contains:
```json
{
  "duplicates": [
    {
      "files": ["packages/foo/src/a.ts", "packages/bar/src/b.ts"],
      "lines": 12,
      "tokens": 80
    }
  ],
  "total": 3
}
```

Simplification proof tests use `jscpdBudget()` from the helper script to assert clone counts:

```typescript
import { jscpdBudget } from '~/scripts/denoise/jscpd-budget';

it('package has < 3 clone clusters in src/ (proof: simplification:dup-try-catch-boilerplate)', async () => {
  const result = await jscpdBudget({ root: 'packages/foo/src', minTokens: 50 });
  expect(result.duplicates.length).toBeLessThan(3);
});
```

**Findings to flag:**

- `simplification:dup-try-catch-boilerplate` — Same try/catch shape repeated in 5+ service methods (extract to `withServiceErrors()` wrapper)
- `simplification:dup-fetch-handler-boilerplate` — Same fetch + parse + error mapping in 3+ routes
- `simplification:dup-zod-schema-fragment` — Same field set declared in 3+ Zod schemas (extract a sub-schema)

---

## §2 — Abstraction layer test ("Rule of three")

When you see an abstraction (interface, class hierarchy, factory function), ask:
1. **How many implementations / consumers exist?**
2. **Did the abstraction precede the second consumer, or was it extracted from existing duplication?**
3. **Does the abstraction's API expose all variation points, or do consumers reach around it?**

Heuristics:

| Implementations | Consumers | Abstraction pre-existing? | Verdict |
|---|---|---|---|
| 1 | 1 | yes | **Lonely abstraction** — consider inlining |
| 1 | 2+ | doesn't matter | OK; might still be over-shaped if API > use |
| 2+ | doesn't matter | extracted from real dup | OK; vindicated |
| 2+ | doesn't matter | speculative | Smell — the second impl forced the API to flex |

**Findings to flag:**

- `simplification:lonely-abstraction` — Interface or class hierarchy with one implementation AND one consumer
- `simplification:strategy-single-impl` — `Strategy` / `Adapter` / `Provider` named class with one implementor
- `simplification:speculative-extension-point` — Abstract method or hook that no implementation overrides

### Proof shape for "lonely abstraction"

The proof is a **consumer-count assertion**:

```typescript
import { findConsumers } from '~/scripts/denoise/find-consumers';

it('Strategy has exactly one consumer (proof: simplification:lonely-abstraction)', async () => {
  const consumers = await findConsumers('FooStrategy', 'packages/');
  expect(consumers.length).toBe(1);
  // If a 2nd consumer appears in future, this fails — vindicating the abstraction
  // If the abstraction is removed, this test is moved to __tests__/regression/ and
  // becomes a guard against re-introducing it
});
```

This is the "lonely abstraction" Catalogue row from `SKILL.md` §6.

---

## §3 — Naming clarity

Three smells:

1. **Inconsistent naming** for the same concept (`userId` in one place, `creatorId` for the same value elsewhere)
2. **Encoded type info** in names (`userArray`, `userMap`) — TypeScript already says it's an array
3. **Stutter** — `User.userName`, `OrderItem.itemPrice`

**Audit recipe:**

```bash
# Find suspected stutter
grep -rE 'class User\b|interface User\b' packages/*/src --include='*.ts' -A 20 \
  | grep -E '^\s+user[A-Z]'
# Manual review of each match
```

**Findings to flag:**

- `simplification:naming-stutter` — Field name repeats the type prefix (`User.userName`)
- `simplification:naming-encoded-type` — Variable name encodes structure (`userArray`, `userMap`)
- `simplification:naming-inconsistent` — Same concept named differently across modules (e.g., `userId` vs `creatorId` for the same person)

### Proof shape for naming findings

A custom lint rule + test the rule (Catalogue row "Naming/style consistency"):

```typescript
// __tests__/regression/stutter.test.ts (written WITH the fix)
import { Linter } from 'eslint';

it('User.userName flagged by stutter rule (proof: simplification:naming-stutter)', () => {
  const linter = new Linter();
  linter.defineRule('no-name-stutter', /* implementation */);
  const messages = linter.verify('class User { userName: string; }', { rules: { 'no-name-stutter': 'error' } });
  expect(messages.length).toBe(1);
  expect(messages[0].message).toContain('stutter');
});
```

---

## §4 — "No premature future-proofing" doctrine

Every speculative flexibility costs:
- Reading time (more concepts to hold in head)
- Maintenance time (more surface area)
- Test time (more permutations)

If the flexibility ISN'T used today, the doctrine is **delete it**.

**Smells:**

- Config object with one field actually consumed
- Generic parameter with default that's the only used value (overlap with `02-type-audit.md`)
- Hook / event emitter with no listeners
- "Extensible" registry with one registration
- Versioned API with one version
- DI container for a class that has one implementation

**Findings to flag:**

- `simplification:config-with-one-consumer` — Config object passed to a function but only one consumer reads any field
- `simplification:hook-with-no-listeners` — `EventEmitter.on()` for an event no one fires
- `simplification:registry-with-one-registration` — Pattern like `register(name, impl)` with one call to `register`
- `simplification:dispatcher-with-no-routing` — Switch/router that always takes one branch

### Proof shape

For "X exists but is unused" findings, cross-check against fallow output (you already loaded it at cycle step 3a). If fallow flagged the symbol, route to `/fallow-audit`. If fallow did NOT flag it (because the symbol IS imported, just not meaningfully used), the proof is a **consumer-count assertion** + a behaviour-equivalence test:

```typescript
it('FooHook fires zero times in production code (proof: simplification:hook-with-no-listeners)', () => {
  // Test that the hook's emit() function exists but no .on() registrations exist
  // for it across the codebase
  const registrations = countListeners('FooHook');
  expect(registrations).toBe(0);
});
```

---

## §5 — Dead-pattern catalogue

Specific shapes that are almost always over-abstracted:

| Shape | Fix |
|---|---|
| `class FooFactory { create(...) { return new Foo(...); } }` | Inline `new Foo(...)` |
| `function getValue() { return value; }` (no logic) | Inline `value` |
| `interface IFoo { ... }` + `class Foo implements IFoo { ... }` (no second implementor) | Drop the interface |
| Wrapper that re-exports without changing behaviour | Import the wrapped thing directly |
| DTO ↔ Domain mapper that copies field-by-field unchanged | Use the source type |
| `try { ... } catch (e) { throw e; }` | Delete the try/catch |

### Proof shape

Anti-pattern grep assertion (Catalogue row "Dead pattern (catalog match)"):

```typescript
it('no FooFactory pattern remains (proof: simplification:factory-without-logic)', async () => {
  const matches = await grep("class \\w+Factory", "packages/", { flags: 'rE' });
  // Filter out factories with actual logic (≥3 statements in create method)
  const useless = matches.filter(m => bodyOf(m).length < 3);
  expect(useless.length).toBe(0);
});
```

---

## §6 — Proof-test forms specific to simplification

This phase has the trickiest gate (per the user's earlier guidance: "we need to focus on testability"). The 3-flavour rule from `SKILL.md` §6 lives here in detail.

### 6a. Behaviour-equivalent refactor → parity test

Capture a corpus of representative inputs, snapshot outputs of the original, assert refactor matches:

```typescript
import { originalImpl, refactoredImpl } from './subject';

const corpus = [
  { in: { ... }, name: 'happy-path' },
  { in: { ... }, name: 'edge-empty' },
  { in: { ... }, name: 'edge-large' },
  // 5-10 inputs covering the API's behaviour space
];

describe('refactor parity (proof: simplification:layered-dto-no-transform)', () => {
  for (const { in: input, name } of corpus) {
    it(`${name} produces identical output`, () => {
      expect(refactoredImpl(input)).toEqual(originalImpl(input));
    });
  }
});
```

If the refactor is in flight (original removed), the corpus tests run only the new impl and compare against committed snapshots (vitest's `toMatchSnapshot()`).

### 6b. Duplication count → programmatic assertion

```typescript
import { jscpdBudget } from '~/scripts/denoise/jscpd-budget';

it('packages/foo has < 3 clone clusters (proof: simplification:dup-try-catch-boilerplate)', async () => {
  const result = await jscpdBudget({ root: 'packages/foo/src', minTokens: 50 });
  expect(result.duplicates.length).toBeLessThan(3);
});
```

This passes only when the duplicates have been deduplicated into a shared helper.

### 6c. Lonely abstraction → consumer-count assertion

(See §2 above.)

### 6d. Layer leak → dependency-graph assertion

```typescript
import { dependencyGraph } from '~/scripts/denoise/dep-graph'; // Phase D

it('packages/foo does not import from apps/web or workers (proof: simplification:layer-leak)', async () => {
  const graph = await dependencyGraph('packages/foo');
  const forbidden = graph.edges.filter(e => e.to.startsWith('apps/web/') || e.to.startsWith('workers/'));
  expect(forbidden).toEqual([]);
});
```

(Phase B uses a simple grep substitute until `dep-graph.ts` lands in Phase D.)

### Testability-bug bar

For simplification, file as `denoise:testability-bug` ONLY if all 4 catalogue rows above (parity, jscpd, consumer-count, dep-graph) genuinely don't apply. The most common simplification bugs map to one of these four — testability-bugs in this phase should be rare.

---

## §7 — Anti-Pattern Table

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `simplification:lonely-abstraction` | Interface/class with 1 impl AND 1 consumer | Over-shaped; reads as flexibility, isn't | Inline; delete the abstraction layer |
| 2 | `simplification:strategy-single-impl` | `Strategy`/`Adapter`/`Provider` named class with 1 implementor | Speculative pattern | Inline impl; drop class |
| 3 | `simplification:dup-try-catch-boilerplate` | Same try/catch shape in 5+ service methods | Duplication that drifts | Extract `withServiceErrors()` wrapper |
| 4 | `simplification:config-with-one-consumer` | Config object passed but only one field used | Speculative flexibility | Take the field directly |
| 5 | `simplification:layered-dto-no-transform` | DTO ↔ Domain mapper that copies unchanged | Indirection without payoff | Use source type |
| 6 | `simplification:hook-with-no-listeners` | Event/hook fired with no `.on()` registrations | Dead extension point | Delete the emitter |
| 7 | `simplification:registry-with-one-registration` | `register()` pattern with one call | Speculative plugin system | Inline the registration |
| 8 | `simplification:naming-stutter` | `User.userName`, `Order.orderId` | Type name repeats unnecessarily | Drop the prefix |
| 9 | `simplification:naming-inconsistent` | Same concept named differently across modules | Confuses cross-cutting reads | Pick one name; rename others |
| 10 | `simplification:wrapper-no-behaviour-change` | Wrapper that re-exports without transformation | Indirection without payoff | Import the wrapped thing directly |
| 11 | `simplification:trivial-getter` | `getX() { return this.x; }` | Boilerplate; `this.x` is fine | Make `x` public; delete getter |
| 12 | `simplification:premature-extraction` | Helper extracted from one call site (no second consumer) | YAGNI violation | Inline back |

Add new rows here as cycles surface new patterns.

---

## §8 — MCP Verification Matrix (simplification cells)

| Scope | Required | Optional |
|---|---|---|
| All scopes | (Static; no MCPs required for the audit itself) | — |
| `apps/web` (refactor of UI components) | — | `chrome-devtools` (visual diff before/after); `playwright` (interaction parity) |

Most simplification proofs are static-by-construction (jscpd, consumer-count, dep-graph). Visual MCPs apply only when the refactor touches rendered output and the parity test alone isn't sufficient.

---

## §9 — Cross-links

- `references/01-security-audit.md` — overlap when a "lonely abstraction" is also a security wrapper (e.g., a sanitiser with one consumer)
- `references/02-type-audit.md` — overlap on generic-abuse smells (single-use generics)
- `references/04-performance.md` — overlap when "wrapper-no-behaviour-change" is also a perf concern
- `/fallow-audit` — for findings whose only action is "delete this export" (no behaviour change)
- `scripts/denoise/jscpd-budget.ts` — programmatic clone-count helper for proof tests
- `scripts/denoise/find-consumers.ts` (Phase B helper, simple grep + AST today) — consumer-count helper for "lonely abstraction" proofs
