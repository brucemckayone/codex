<!--
  @component BrandEditorHeroText

  The Identity-group HERO-TEXT control for the brand studio rail (Codex-cijzb ·
  WP-1.6). Edits the org's NAME + DESCRIPTION — the <h1> title and subheading of
  the public landing hero — folded in from the retired settings/branding page.

  These are ORGANISATION fields, NOT brand tokens: they are not part of
  `BrandEditorState`, so they cannot ride the WP-1.4 colour bridge (which only
  streams token state into the iframe). Instead, a successful save fires
  `onsaved`, which the route uses to trigger a SCOPED reload of the preview
  iframe (a structural change → reload, per WP-1.4's contract). The org-api
  invalidates the slug-keyed public-info cache on every update
  (organizations.ts), so the reloaded frame renders the fresh hero text.

  Persistence reuses `updateOrganizationForm` (progressive-enhancement form →
  organization-api PATCH), validated by the existing org schema — no new schema.
  This is its OWN self-contained save affordance, deliberately separate from the
  rail's brand-token "Save changes": org identity persists here immediately, the
  same way the logo does, rather than riding the token change-ledger.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { brandEditor } from '$lib/brand-editor';
  import { Button } from '$lib/components/ui';
  import { updateOrganizationForm } from '$lib/remote/org.remote';
  import * as m from '$paraglide/messages';

  interface Props {
    /** Current org name (hero <h1>) — seeds the field. */
    name: string;
    /** Current org description (hero subheading); null when unset — seeds the field. */
    description: string | null;
    /**
     * Fired once per successful save. The route bumps the preview reload token
     * so the framed public page re-renders with the new hero text.
     */
    onsaved?: () => void;
  }

  const { name, description, onsaved }: Props = $props();

  const orgId = $derived(brandEditor.orgId ?? '');
  const saving = $derived(updateOrganizationForm.pending > 0);

  const nameIssues = $derived(updateOrganizationForm.fields.name.issues() ?? []);
  const descriptionIssues = $derived(
    updateOrganizationForm.fields.description.issues() ?? []
  );
  const nameErrorText = $derived(
    nameIssues.map((issue) => issue.message).join(' ')
  );
  const descriptionErrorText = $derived(
    descriptionIssues.map((issue) => issue.message).join(' ')
  );
  // Server-side failure returned by the form (persist path failed) — surfaced,
  // never swallowed.
  const serverError = $derived(
    updateOrganizationForm.result && !updateOrganizationForm.result.success
      ? updateOrganizationForm.result.error
      : null
  );

  // Seed the form's field state with the current org values ONCE, so the inputs
  // render pre-populated. The guard + untrack keep it to a single seed and stop
  // a later org refetch from clobbering an in-progress edit — the ContentForm
  // edit-mode initialisation pattern.
  let seeded = false;
  $effect(() => {
    if (seeded) return;
    seeded = true;
    untrack(() => {
      updateOrganizationForm.fields.name.set(name);
      updateOrganizationForm.fields.description.set(description ?? '');
    });
  });

  // Notify the route after a successful save so it can reload the preview.
  // Captured at setup so a stale success result lingering in the module-level
  // form singleton (from a prior visit) never fires onsaved on mount — we react
  // only when the result becomes a NEW success while settled.
  let seenResult: unknown = updateOrganizationForm.result;
  $effect(() => {
    const result = updateOrganizationForm.result;
    if (updateOrganizationForm.pending > 0) return;
    if (result === seenResult) return;
    seenResult = result;
    if (result?.success) onsaved?.();
  });
</script>

<form {...updateOrganizationForm} class="hero-text">
  <input type="hidden" name="orgId" value={orgId} />

  <div class="hero-text__field">
    <label class="hero-text__label" for="hero-text-name">
      {m.branding_hero_name_label()}
    </label>
    <input
      {...updateOrganizationForm.fields.name.as('text')}
      id="hero-text-name"
      class="hero-text__input"
      aria-invalid={nameIssues.length > 0}
      aria-describedby={nameIssues.length > 0 ? 'hero-text-name-error' : undefined}
    />
    {#if nameIssues.length > 0}
      <p id="hero-text-name-error" class="hero-text__error" role="alert">
        {nameErrorText}
      </p>
    {/if}
  </div>

  <div class="hero-text__field">
    <label class="hero-text__label" for="hero-text-subheading">
      {m.branding_hero_subheading_label()}
    </label>
    <textarea
      {...updateOrganizationForm.fields.description.as('text')}
      id="hero-text-subheading"
      class="hero-text__textarea"
      rows="3"
      placeholder={m.branding_hero_subheading_placeholder()}
      aria-invalid={descriptionIssues.length > 0}
      aria-describedby={descriptionIssues.length > 0
        ? 'hero-text-subheading-error'
        : undefined}
    ></textarea>
    {#if descriptionIssues.length > 0}
      <p id="hero-text-subheading-error" class="hero-text__error" role="alert">
        {descriptionErrorText}
      </p>
    {/if}
  </div>

  {#if serverError}
    <p class="hero-text__error" role="alert">{serverError}</p>
  {/if}

  <div class="hero-text__actions">
    <Button type="submit" variant="secondary" size="sm" loading={saving} disabled={saving}>
      Save hero text
    </Button>
  </div>
</form>

<style>
  .hero-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-text__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .hero-text__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .hero-text__input,
  .hero-text__textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .hero-text__textarea {
    resize: vertical;
    min-height: calc(var(--space-16));
    font-family: inherit;
  }

  .hero-text__input:focus-visible,
  .hero-text__textarea:focus-visible {
    outline: none;
    border-color: var(--color-focus);
  }

  .hero-text__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-500);
  }

  .hero-text__actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
