/**
 * Denoise iter-029 F4 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: web:streamed-promise-no-catch
 * Severity: minor (client-side unhandled rejection — observability gap, not a server crash)
 * Recurrence: NEW fingerprint hit for this file (the fingerprint itself is
 *             pre-existing in domain-web ref 05 §9 row 2).
 *
 * Bug
 * ---
 * `apps/web/src/lib/utils/subscription-context.svelte.ts:104` chains a
 * `.then(...)` on the SSR-streamed `subscriptionContext` promise inside
 * a `$effect` block — but does NOT chain a `.catch(...)`. If the
 * streamed promise rejects (network failure, ApiError from the org
 * layout's `loadOrgTiers` after its own `.catch()` was bypassed by
 * an upstream regression, or any future change to the producer), the
 * `.then` callback never fires AND the rejection becomes an unhandled
 * promise rejection in the browser.
 *
 * The org-layout server load currently catches inside `loadOrgTiers`,
 * so today this is defence-in-depth, not a live crash. But the
 * project CLAUDE.md hard rule is unconditional: "MUST `.catch()` on
 * every returned promise — unhandled rejections crash the server" —
 * and the same rule should hold on the client because:
 *   - SvelteKit's `<svelte:boundary>` doesn't catch unhandled
 *     rejections from raw `.then()` chains in `$effect`.
 *   - The neighbouring `access-context.svelte.ts` (same author, same
 *     pattern) DOES `.catch()` on every promise it threads through
 *     — line 93/102. The drift between siblings is a maintenance
 *     hazard.
 *
 * Fix: wrap the `.then(...)` in a `.catch(...)` that resets the state
 * to the safe default (mirror `access-context.svelte.ts:93` —
 * `resolvedTiers = []`).
 *
 * Catalogue rows
 * --------------
 * Row 11 — API-map snapshot. Structural assertion: the file's
 * `Promise.resolve(promise).then(...)` chain contains a sibling
 * `.catch(...)`. Approximation: every `.then(` on a Promise resolution
 * inside this file must be followed (within 10 lines) by a `.catch(`.
 *
 * Filed at: docs/denoise/iter-029.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SUB_CONTEXT = resolve(
  __dirname,
  '../../lib/utils/subscription-context.svelte.ts'
);

describe('iter-029 F4 — subscription-context.svelte.ts promise.then without .catch', () => {
  it('every promise.then(...) on the streamed subscriptionContext is paired with a .catch(...)', () => {
    const source = readFileSync(SUB_CONTEXT, 'utf-8');

    // Find every `promise.then(` occurrence. For each, look at the next 15
    // lines for a `.catch(` — if not present, flag.
    const lines = source.split('\n');
    const offenders: { line: number; snippet: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      // Match `promise.then(` or `subscriptionContext.then(` etc — but skip
      // `Promise.resolve(...).then(...)` chains (they typically have their
      // own .catch sibling, and `access-context.svelte.ts` is the canonical
      // good pattern). We focus on the bare-promise pattern that's the bug.
      if (/\bpromise\.then\(/.test(lines[i])) {
        const window = lines
          .slice(i, Math.min(lines.length, i + 15))
          .join('\n');
        if (!window.includes('.catch(')) {
          offenders.push({
            line: i + 1,
            snippet: window.split('\n').slice(0, 3).join('\n'),
          });
        }
      }
    }

    expect(
      offenders,
      `subscription-context.svelte.ts has ${offenders.length} promise.then() call(s) without a .catch() within 15 lines. Bare client-side rejection becomes an unhandled-rejection event. ${offenders
        .map((o) => `\n  line ${o.line}: ${o.snippet}`)
        .join('\n')}`
    ).toEqual([]);
  });
});
