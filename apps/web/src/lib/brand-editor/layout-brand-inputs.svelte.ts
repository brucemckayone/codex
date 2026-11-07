/**
 * The org layout's write-back of its own brand inputs (Codex-q01h8).
 *
 * The layout binds its brand inputs with `style:` directives and two
 * attributes. The editor's preview writes the same properties and flips the
 * same attributes on `.org-layout`, and `clearBrandVars` removes the
 * properties when it closes. Svelte re-sets a directive or an attribute only
 * when its own value changes, so after an edit-free visit nothing would put
 * them back: the org lost its brand until a reload.
 *
 * Call it once, at the top level of the component that binds the inputs. The
 * records are getters so the effect tracks them, and it re-runs when the
 * editor closes because it reads `isClosed`.
 */
import { browser } from '$app/environment';
import { brandEditor } from './brand-editor-store.svelte';
import { applyLayoutBrandInputs } from './css-injection';

export function writeBackLayoutBrandInputs(
  vars: () => Readonly<Record<string, string | undefined>>,
  attributes: () => Readonly<Record<string, boolean>>
): void {
  $effect(() => {
    if (!browser || !brandEditor.isClosed) return;
    const el = document.querySelector<HTMLElement>('.org-layout');
    if (!el) return;
    applyLayoutBrandInputs(el, vars(), attributes());
  });
}
