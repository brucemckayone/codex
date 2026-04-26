/**
 * Proof test for F5 — performance:regex-recompiled-per-call
 *
 * Static lint-rule + ref-equality assertion per SKILL.md §6 Catalogue
 * row 12 (Naming/style consistency → custom lint rule + test the rule).
 *
 * The bug:
 *   apps/web/src/lib/server/auth-utils.ts:25-27 builds two RegExp objects
 *   inside `extractSessionToken` via the `new RegExp(...)` constructor
 *   with a template literal:
 *     new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
 *     new RegExp(`__Secure-${COOKIES.SESSION_NAME}=([^;]+)`)
 *   These are recompiled on every call. `COOKIES.SESSION_NAME` is a stable
 *   module-level constant, so the patterns can hoist to module scope (or
 *   inline as string-template-literal regex literals).
 *
 *   Hot-path multiplier is modest (auth flow only — login / register /
 *   verify-email), so this is severity=minor. Filed for catalogue
 *   consistency: ref 04 §7 anti-pattern `performance:regex-recompiled-per-call`
 *   captures exactly this shape, and leaving it unfiled would mute the
 *   recurrence-counter signal if a future cycle finds the same pattern in
 *   a higher-traffic file.
 *
 * The proof: import the auth-utils module and assert the two patterns are
 *   exposed as module-scope constants (or that calling the function twice
 *   uses the SAME RegExp instance both times — a side-effect-free way to
 *   prove no-recompile).
 *
 * Currently SKIPPED — un-skip in the same PR as the fix.
 *
 * MCP gate (R6): n/a static finding.
 */

import { describe, it } from 'vitest';

describe.skip('performance:regex-recompiled-per-call', () => {
  it('extractSessionToken does not construct new RegExp objects on each call', () => {
    // SKETCH (un-skip in the fix PR):
    // Approach A — instrumentation:
    //   const RegExpCtor = global.RegExp;
    //   let constructions = 0;
    //   global.RegExp = new Proxy(RegExpCtor, {
    //     construct(target, args) {
    //       constructions++;
    //       return new target(...args);
    //     },
    //   }) as unknown as RegExpConstructor;
    //   try {
    //     const { extractSessionToken } = await import('$lib/server/auth-utils');
    //     extractSessionToken(stubResponse());
    //     extractSessionToken(stubResponse());
    //     extractSessionToken(stubResponse());
    //     expect(constructions).toBe(0); // patterns hoisted to module scope
    //   } finally {
    //     global.RegExp = RegExpCtor;
    //   }
    //
    // Approach B — grep static source:
    //   import { readFileSync } from 'node:fs';
    //   const src = readFileSync('apps/web/src/lib/server/auth-utils.ts', 'utf8');
    //   const matches = src.match(/new RegExp\(/g) ?? [];
    //   expect(matches.length).toBe(0); // all patterns are literals or hoisted
  });
});
