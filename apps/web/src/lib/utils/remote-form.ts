/**
 * Helpers for SvelteKit remote `form()` functions.
 *
 * @see apps/web/src/lib/utils/__tests__/remote-form.test.ts
 */

import type { RemoteForm, RemoteFormInput } from '@sveltejs/kit';

/**
 * Spread THIS instead of the bare form object on any long-lived EDITOR form,
 * so a successful save does not wipe the fields.
 *
 * ## Why
 *
 * The default attachment SvelteKit installs when you spread the form object
 * (`<form {...myForm}>`) is, verbatim from
 * `@sveltejs/kit/src/runtime/client/remote-functions/form.svelte.js` (2.55.0,
 * lines 444-452):
 *
 * ```js
 * instance[createAttachmentKey()] = create_attachment(
 *   form_onsubmit(({ submit, form }) =>
 *     submit().then(() => {
 *       if (!issues.$) {
 *         form.reset();          // <- native HTMLFormElement.reset()
 *       }
 *     })
 *   )
 * );
 * ```
 *
 * `form.reset()` returns every control to its DOM *default* value. Fields
 * driven by `fields.<name>.as('text')` (or by `bind:value`) carry no `value`
 * ATTRIBUTE — only a property — so their default is `''` and reset blanks
 * them. The runtime's own `reset` listener (lines 424-432) then re-derives the
 * reactive field state from the now-blank DOM:
 *
 * ```js
 * const handle_reset = async () => {
 *   await tick();
 *   input = convert_formdata(new FormData(form));
 * };
 * ```
 *
 * So after ONE successful save an editor is left visually empty AND holding
 * empty field state, and the NEXT submit posts those empties — which the server
 * schema rejects ("Title is required" / "Slug is required"). Because kit skips
 * the reset when the submission returned issues, the form then stays blank and
 * every further click re-posts the same empty payload.
 * (Codex-1g5lh.2 · Codex-1g5lh.5)
 *
 * `enhance()` returns a COMPLETE replacement for the spread — `{ method,
 * action, [attachment] }`, lines 569-578 — running our callback in place of the
 * default one. `submit()` performs the identical submission, so validation
 * issues, `result`, `pending` and single-flight query refreshes all behave
 * exactly as before; the only difference is that nothing calls `reset()`, so
 * the values the user just saved stay on screen and stay in the field state.
 *
 * ## When NOT to use this
 *
 * Reset-on-success is the RIGHT behaviour for fire-and-forget forms — an "add
 * item" form, a resend-verification-email button, a file-upload widget — where
 * a cleared form is the signal that the action landed. Leave those on the bare
 * spread.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { keepValuesOnSave } from '$lib/utils/remote-form';
 *   import { updateThingForm } from '$lib/remote/thing.remote';
 *
 *   const formAttrs = keepValuesOnSave(updateThingForm);
 * </script>
 *
 * <form {...formAttrs}>...</form>
 * ```
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `RemoteFormInput | void` is kit's own constraint on RemoteForm — narrowing it to `undefined` would reject a `RemoteForm<void, T>` (a form with no input).
export function keepValuesOnSave<Input extends RemoteFormInput | void, Output>(
  form: RemoteForm<Input, Output>
): ReturnType<RemoteForm<Input, Output>['enhance']> {
  return form.enhance(async ({ submit }) => {
    await submit();
  });
}
