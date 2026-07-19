<!--
  @component BrandStudioRail

  Placeholder control rail for the `/studio/brand` workspace. WP-1.1 ships the
  header + Save action + empty control region so the state spine (open → edit →
  save) is functional before the rich controls land.

  EXTENSION POINTS — do NOT build these here in WP-1.1:
    - WP-1.5: fold the brand-editor level components (colours, typography,
              shape, shadows, presets, hero-effects, header-layout) into the
              `.brand-studio-rail__controls` region below.
    - WP-1.6: fold logo upload + hero-text (org name / subheading) into the rail
              (these move out of the retired settings/branding page).
    - WP-1.7: add the Guided entry mode (preset gallery + brand-from-logo).

  Epic: Codex-cijzb · WP-1.1.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    /** True while a save is in flight — disables the Save button. */
    saving?: boolean;
    /** True when the store has unsaved edits — gates the Save button. */
    isDirty?: boolean;
    /** Persist the current brand-editor payload. Owned by the route. */
    onsave: () => void;
  }

  const { saving = false, isDirty = false, onsave }: Props = $props();
</script>

<div class="brand-studio-rail">
  <header class="brand-studio-rail__header">
    <h1 class="brand-studio-rail__title">{m.branding_title()}</h1>
    <p class="brand-studio-rail__subtitle">{m.branding_description()}</p>
  </header>

  <div class="brand-studio-rail__controls">
    <!--
      WP-1.5 fills this region with the brand-editor level components; WP-1.6
      folds in logo + hero text; WP-1.7 adds Guided mode. Until then a quiet
      placeholder keeps the shell legible.
    -->
    <p class="brand-studio-rail__placeholder">
      Brand controls arrive here in the next work packages.
    </p>
  </div>

  <footer class="brand-studio-rail__footer">
    <Button variant="primary" onclick={onsave} loading={saving} disabled={!isDirty}>
      {m.branding_save()}
    </Button>
  </footer>
</div>

<style>
  .brand-studio-rail {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .brand-studio-rail__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .brand-studio-rail__title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .brand-studio-rail__subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .brand-studio-rail__controls {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .brand-studio-rail__placeholder {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-4);
    border: var(--border-width-thick) dashed var(--color-border);
    border-radius: var(--radius-md);
    text-align: center;
  }

  .brand-studio-rail__footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>
