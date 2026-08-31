/**
 * TYPE-LEVEL proof that the org caches' `cacheWrite` sink CANNOT BE OMITTED.
 *
 * WHY THIS FILE HAS TO EXIST, RATHER THAN A RUNTIME TEST. The defect it guards
 * is an ABSENT ARGUMENT, and absence is not observable at runtime from inside
 * the callee: `cacheWrite?.(write)` on an `undefined` value does exactly
 * nothing, successfully. `org-slug-cache.test.ts` can prove the sink is USED
 * when one is supplied, and `org-cache-waituntil-wiring.test.ts` can prove
 * `enforcePolicyInline` supplies one — but no runtime assertion in this package
 * can reach the two call sites in `workers/` that supplied none
 * (`identity-api/src/routes/membership.ts`,
 * `content-api/src/routes/categories.ts`). Only the compiler can, and only if
 * the parameter is required.
 *
 * The CI contract gate could not see them either: its floating-write rule
 * accepts the `cacheWrite?.(write)` call-form as a hand-off, so it reported 0
 * floating writes across 1,242 files while the value at those two sites was
 * `undefined` on every request.
 *
 * MECHANICS. `.type-check.ts` (not `.test.ts`) so
 * `packages/worker-utils/tsconfig.json` includes it — that file excludes
 * `**\/*.test.ts` / `**\/*.spec.ts`, and vitest transpiles without typechecking,
 * so a `@ts-expect-error` written in a `.test.ts` is inert decoration. Each
 * directive FAILS the build (TS2578, "Unused '@ts-expect-error' directive") if
 * the parameter is ever made optional again, which is the assertion.
 *
 * Nothing here runs: every call sits inside a function that is never invoked,
 * and the file is imported by nothing.
 *
 * WHICH DIRECTIVE PROVES WHICH THING — checked by mutation, not assumed.
 * Reverting `cacheWrite` to `cacheWrite?: CacheWrite` (plus `cacheWrite?.(…)`)
 * makes exactly THREE of the directives below unused: the two 4-argument calls
 * and the explicit-`undefined` call. The two calls that omit `obs` as well keep
 * erroring either way, because `obs` is positional-and-nullable now — so those
 * two are NOT evidence about the sink, and are labelled accordingly rather than
 * left to look like four independent proofs of one property.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import {
  type CacheWrite,
  checkOrganizationMembership,
  extractOrganizationFromSubdomain,
} from '../org-helpers';

const ORG_ID = '9f8c1d4e-0b2a-4c6d-8e1f-2a3b4c5d6e7f';
const USER_ID = 'user-1';

/** A sink of the shape `helpers.ts`/`ctx.cacheWrite` hand over. */
const sink: CacheWrite = () => {};

declare const env: Bindings;
declare const obs: ObservabilityClient;

export async function legalCalls(): Promise<void> {
  // With a sink, and with an explicit `undefined` for the observability client:
  // `obs` is positional-and-nullable rather than optional precisely so the
  // required sink can follow it.
  await extractOrganizationFromSubdomain(
    'acme.example.com',
    env,
    undefined,
    sink
  );
  await extractOrganizationFromSubdomain('acme.example.com', env, obs, sink);
  await checkOrganizationMembership(ORG_ID, USER_ID, env, undefined, sink);
  await checkOrganizationMembership(ORG_ID, USER_ID, env, obs, sink);
}

export async function illegalCalls(): Promise<void> {
  // @ts-expect-error the slug cache's write sink is required — this is the shape that silently kept the cancelled write
  await extractOrganizationFromSubdomain('acme.example.com', env, obs);

  // A 2-argument call cannot compile — but note this one fails on the `obs`
  // slot, which is positional now, and would fail even if the sink were
  // optional again. It pins the shape most of `org-slug-cache.test.ts` used to
  // use; it is not evidence about `cacheWrite`.
  // @ts-expect-error too few arguments: obs and the sink are both missing
  await extractOrganizationFromSubdomain('acme.example.com', env);

  // THE REAL CASE. `workers/identity-api/src/routes/membership.ts` called it
  // exactly like this, and compiled clean, and got the cancelled write.
  // @ts-expect-error the membership cache's write sink is required
  await checkOrganizationMembership(ORG_ID, USER_ID, env, obs);

  // Same caveat as the 2-argument slug call above: this fails on `obs`, not on
  // the sink. `categories.ts` passed `env, obs` (see the 4-argument case
  // above), which is the case that actually needed the compiler.
  // @ts-expect-error too few arguments: obs and the sink are both missing
  await checkOrganizationMembership(ORG_ID, USER_ID, env);

  // @ts-expect-error an explicit `undefined` is not a sink either — the point is that the choice is visible
  await checkOrganizationMembership(ORG_ID, USER_ID, env, obs, undefined);
}
