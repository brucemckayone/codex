# Reference 02 — Type Audit

> Loaded by `/denoise --phase=types` regardless of scope. Pair with the relevant domain reference (05/06/07).
> Owned MCP: `mcp__ide__getDiagnostics` (live TS errors). Optional: `svelte-autofixer` for `.svelte` files in apps/web.

---

## §0 — When this reference applies

Every cell where `--phase=types`. The cell selects which **scope reference** (05/06/07) to pair with — this file owns the cross-cutting type rules; the scope reference owns the domain-specific patterns (paraglide message shapes for apps/web, env-binding generics for workers, BaseService scope-param types for packages).

If a finding is purely about **schema validation** (Zod schema defining a wrong shape), the action is in `02-type-audit.md` for declarations but the proof shape often lives in the security reference because it's also a security concern.

---

## §1 — `any` / `unknown` audit recipe

The base detector is grep, refined by tsc:

```bash
# Explicit `: any` annotations
grep -rn '\bany\b' packages/*/src workers/*/src apps/web/src --include='*.ts' --include='*.tsx' --include='*.svelte' \
  | grep -E ':\s*any|<any|as any\b' \
  | grep -v '\.test\.ts\|\.spec\.ts\|node_modules' \
  > /tmp/denoise-{{ITER_ID}}-any-hits.txt

# Implicit any via missing return types on exported functions
pnpm --filter @codex/<pkg> typecheck --noImplicitAny  # if not already on
```

`unknown` is preferred over `any` when the type is genuinely unknown — it forces narrowing at the use site. Findings should distinguish:

- `any` written by a developer for convenience → **fixable**
- `any` flowing in from a 3rd-party type → **wrap with `unknown` + narrow** at the boundary
- `any` produced by a missing return type → **add the return type**

**Findings to flag:**

- `types:any-explicit` — Annotation `: any` in source code (excluding tests)
- `types:as-any` — `as any` cast (almost always a bandage)
- `types:any-in-procedure-input` — `procedure().input(z.any())` (also a security concern; see ref 01)
- `types:any-from-third-party` — `any` flowing in from an untyped import; should be wrapped at the boundary as `unknown`
- `types:implicit-any-no-return-type` — Exported function without explicit return type, where TS infers `any` due to control flow

---

## §2 — Type duplication detection

Two flavours:

### 2a. Cross-package duplication

The same `interface`, `type`, or `class` shape declared in 2+ packages. Drifts over time — both copies evolve independently.

```bash
# Find type names declared in 2+ files
grep -rhE '^export (interface|type|class) [A-Z][A-Za-z]+' packages/*/src --include='*.ts' \
  | sed -E 's/^export (interface|type|class) ([A-Za-z]+).*/\2/' \
  | sort | uniq -c | sort -rn | awk '$1 >= 2'

# For each multi-defined name, locate the declarations
grep -rn 'export interface UserProfile' packages/ --include='*.ts'
```

The fix: move the canonical shape to `@codex/shared-types`; replace local declarations with `import type { UserProfile } from '@codex/shared-types'`.

**Findings to flag:**

- `types:type-duplicate-cross-package` — Same type name declared in 2+ packages (also see `packages:type-duplicate-across-packages` for the cross-cutting view)
- `types:type-from-shared-types-redeclared` — Local declaration of a type already in `@codex/shared-types`
- `types:type-shape-overlap-no-shared` — Two packages declare different types with structurally identical shapes (e.g., both have `{ id: string; name: string }`)

### 2b. Shape-equivalent but named-different

Use `expectTypeOf<A>().toEqualTypeOf<B>()` from `vitest`'s `expect-type` runtime to assert structural equivalence in tests. If two types are equivalent and live in different packages, that's a finding.

---

## §3 — Narrowing patterns

When a value's type is `unknown` or a union, narrow before use:

```typescript
// BAD: bypasses narrowing
const user = data as User;

// GOOD: type guard
function isUser(x: unknown): x is User {
  return typeof x === 'object' && x !== null && 'id' in x && typeof (x as { id: unknown }).id === 'string';
}
if (isUser(data)) {
  // data is now User
}
```

Zod schemas function as runtime + compile-time narrowing in one. Prefer Zod where possible:

```typescript
const result = userSchema.safeParse(data);
if (!result.success) throw new ValidationError(result.error);
const user = result.data; // typed as User by inference
```

**Findings to flag:**

- `types:as-cast-without-guard` — `as Foo` where `Foo` is more specific than the source type, without a runtime check
- `types:non-null-assertion-overuse` — `value!` where the calling code can't actually guarantee non-null (>3 in one file is a smell)
- `types:zod-result-not-checked` — `schema.parse(x)` (instead of `safeParse`) without try/catch — propagates raw Zod errors

---

## §4 — Shared-types contract

`@codex/shared-types` is the single owner of cross-package type shapes. Rules:

1. **Only types live there** — no functions, no classes, no constants (those go in `@codex/constants` or relevant service packages)
2. **Imports are zero-runtime** — every import from `@codex/shared-types` MUST be `import type {...}` so it's stripped by tsc at build time
3. **No coupling to runtime libraries** — the package depends only on TypeScript itself, never on `@codex/database` or any other internal package
4. **JSDoc is the documentation** — every exported type has a `@see` reference to where it's defined as a runtime shape (Drizzle table, Zod schema, etc.)

**Audit recipe:**

```bash
# Verify imports are type-only
grep -rn "from '@codex/shared-types'" packages/ workers/ apps/web/src --include='*.ts'
# Each line should start with `import type {...}` not `import {...}`

# Verify shared-types has no runtime deps
cat packages/shared-types/package.json | jq '.dependencies'
# Should be {} or only @types/* packages
```

**Findings to flag:**

- `types:shared-types-runtime-import` — `import { ... } from '@codex/shared-types'` without `type` keyword (causes runtime import that does nothing useful)
- `types:shared-types-runtime-dep` — `@codex/shared-types/package.json` declares a non-`@types/*` dependency
- `types:shared-types-non-type-export` — Function/class/constant exported from `@codex/shared-types` (belongs elsewhere)

---

## §5 — Generic abuse

Generics are good when they capture a real relationship between input and output types. They're a smell when:

- Used with a single concrete instantiation (could be inlined)
- Provide a default that's the only used value
- Compose 3+ deep without clarifying the type contract

```typescript
// BAD: generic with one use, default never overridden
function load<T = User>(id: string): Promise<T> { ... }
// The function ALWAYS returns User. Inline it.

// GOOD: generic captures a real relationship
function findById<T extends BaseRow>(table: Table<T>, id: string): Promise<T | null> { ... }
// The relationship between table type and return type is the value of the generic.
```

**Findings to flag:**

- `types:generic-with-single-use` — Generic parameter used at exactly one call site with one concrete type (count via grep + AST)
- `types:generic-default-never-overridden` — Generic with `<T = X>` where T is always X in practice
- `types:generic-composition-3-deep` — `Foo<Bar<Baz<T>>>` chains where the inner generics aren't constraining anything

---

## §6 — Type-equality testing patterns (proof shapes)

The `types` phase has the cleanest proof-test forms because TypeScript itself is the test runner.

### 6a. `expectTypeOf<A>().toEqualTypeOf<B>()`

For type-duplicate findings:

```typescript
import { expectTypeOf } from 'vitest';
import type { UserProfile as UserProfileA } from '@codex/identity';
import type { UserProfile as UserProfileB } from '@codex/organization';

it('UserProfile shape is consistent across packages (proof: types:type-duplicate)', () => {
  expectTypeOf<UserProfileA>().toEqualTypeOf<UserProfileB>();
  // Test FAILS to compile if shapes drift, PASSES once both import from @codex/shared-types
});
```

### 6b. `tsc --noEmit` failure capture

For `any` findings — the proof is "after the fix, tsc fails on uses that exploit the `any` permissiveness":

```typescript
// __tests__/regression/any-in-input.test.ts (written WITH the fix)
it('procedure rejects unsanitised input shape (proof: types:any-in-procedure-input)', async () => {
  // Before fix: this compiles because input was z.any()
  // After fix: schema rejects; fix replaces input with named zod schema
  const result = await callProcedure({ malformed: 'shape' });
  expect(result.error.code).toBe('VALIDATION_ERROR');
});
```

### 6c. Compile-time-only assertions

```typescript
import type { Equal, Expect } from '@codex/shared-types/test-helpers';

type _proof_userProfile_consistent = Expect<Equal<UserProfileA, UserProfileB>>;
// Tsc errors at this line if shapes drift — proof captured at compile time
```

(`@codex/shared-types/test-helpers` may need to be added — it's a tiny utility module.)

---

## §7 — Anti-Pattern Table

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `types:any-explicit` | `: any` annotation in source | Disables type checks at the use site | Use proper type or `unknown` + narrow |
| 2 | `types:as-any` | `as any` cast | Bypasses guarantees; spreads through subsequent code | Add type guard; fix the upstream type |
| 3 | `types:any-in-procedure-input` | `procedure().input(z.any())` | Untyped contract; arbitrary shape reaches handler | Use named zod schema in `@codex/validation` |
| 4 | `types:type-duplicate-cross-package` | Same type name declared in 2+ packages | Drift over time; structurally diverges | Move to `@codex/shared-types`; import `type` from there |
| 5 | `types:type-from-shared-types-redeclared` | Local declaration of a type already in `@codex/shared-types` | Confusing; one source of truth gets bypassed | Delete local; import from `@codex/shared-types` |
| 6 | `types:generic-with-single-use` | Generic parameter used at one call site with one concrete type | Speculative; obscures contract | Inline the concrete type |
| 7 | `types:shared-types-runtime-import` | Non-`type` import from `@codex/shared-types` | Adds runtime import that does nothing | Add `type` keyword |
| 8 | `types:non-null-assertion-overuse` | `value!` repeated in same scope | Hides null risk; one missed spot becomes a runtime error | Refactor to early-return guard or proper narrowing |
| 9 | `types:promise-unknown-return` | Service method returning `Promise<unknown>` or `Promise<any>` | Caller forced to cast | Type the return explicitly |
| 10 | `types:as-unknown-as` | `value as unknown as Foo` | Double cast; bypasses TS entirely | Find the type-system answer; this is rarely correct |
| 11 | `types:implicit-any-no-return-type` | Exported function without explicit return type | TS infers `any` on complex control flow | Add explicit return annotation |
| 12 | `types:zod-result-not-checked` | `schema.parse(x)` not in try/catch | Raw Zod error propagates to caller | Use `safeParse` + handle `result.success === false` |

Add new rows here as cycles surface new patterns.

---

## §8 — MCP Verification Matrix (types cells)

| Scope | Required MCP | What it proves |
|---|---|---|
| All scopes | `mcp__ide__getDiagnostics` | Live TS error count before/after fix; baseline preserved (no NEW errors) |
| `apps/web` | `svelte-autofixer` (optional) | `.svelte` files have no untyped props or implicit-any expressions |

The fix's proof is structural: a `tsc --noEmit` run that produces clean output where it didn't before, captured as evidence in the bead body.

---

## §9 — Cross-links

- `references/01-security-audit.md` — security phase reference (some `any` findings overlap with security: bypassed input validation)
- `references/03-simplification.md` — simplification phase reference (generic-abuse smells overlap with "premature abstraction")
- `references/07-domain-packages.md` — packages-domain reference (type duplicates manifest as `packages:type-duplicate-across-packages`)
- `/backend-dev` reference 05 (validation patterns) — implementation-time guidance for replacing `z.any()` with named schemas
- `@codex/shared-types/CLAUDE.md` — canonical shared-types contract
- `@codex/validation/CLAUDE.md` — Zod schema catalogue
