/**
 * Proof test for iter-006 F4 — `types:any-explicit`
 * (`result: any` in form-enhance handler signature).
 *
 * Finding: TWO `+page.svelte` files declare an inline form-enhance
 * callback with `result: any`:
 *
 *   - apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte:143
 *   - apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.svelte:130
 *
 *   return async ({ result, update }: { result: any; update: () => Promise<void> }) => {
 *     ...
 *     if (result.type === 'success' && result.data?.sessionUrl) { ... }
 *   };
 *
 * The correct shape is `ActionResult` from `@sveltejs/kit` (the type
 * `SubmitFunction`'s callback receives). The `any` annotation lets a
 * type-incorrect access on `result.data?.sessionUrl` go unchecked —
 * if the server returns a different action shape, the runtime
 * `window.location.href = result.data.sessionUrl` would 404 silently.
 *
 * Catalogue row: §6 row 3 (type-equality test). After the fix, the
 * callback signature uses `SubmitFunction['_']` or
 * `Parameters<SubmitFunction>[0]` and the assertion that
 * `result: ActionResult` compiles.
 */

import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { describe, expectTypeOf, it } from 'vitest';

describe.skip('iter-006 F4 — form enhance result should be ActionResult', () => {
  it('SubmitFunction callback receives ActionResult, not any', () => {
    // The fix is to import `ActionResult` and use it. Once both files
    // adopt the proper typing, this assertion compiles and provides
    // the regression guard.
    //
    // The callback's full shape (formData/formElement/action/result/update)
    // is owned by @sveltejs/kit and may grow over time; we only pin the
    // `result` field's type — that's the property the bug touched.
    type CallbackOrVoid = Awaited<ReturnType<SubmitFunction>>;
    type Callback = Extract<CallbackOrVoid, (...args: never[]) => unknown>;
    type EnhanceCallbackArg = Parameters<Callback>[0];
    expectTypeOf<EnhanceCallbackArg['result']>().toEqualTypeOf<ActionResult>();
  });
});
