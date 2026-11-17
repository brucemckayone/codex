<!--
  @component BrandStudioRailPending

  The rail before the brand editor opens (Codex-zskbp). The page opens the
  editor store once `getBrandingSettings` resolves; until then the store holds
  no brand, so `brandEditor.pending` is null and `updateField` drops every
  edit. The full rail used to render anyway: a creator could drag a colour that
  changed nothing, and a failed read looked like a working editor whose Save
  never lit up.

  The page renders this in place of the whole rail (mode switch, search,
  controls, Save) while the read is pending or has failed:
  - pending: the title, a status line, and skeleton rows laid out like
    `RAIL_GROUPS`, so the placeholder keeps the rail's shape;
  - failed: the title alone. The page mounts `LoadFailedAlert` straight after
    this, unconditionally, because its status line has to outlive this
    component to announce a Retry that loads.

  The canvas is not gated: it frames the public page, which shows the saved
  brand either way.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Skeleton } from '$lib/components/ui';
  import { RAIL_GROUPS } from './rail/rail-model';

  interface Props {
    /** The branding read failed: the title alone, above the page's alert. */
    failed: boolean;
  }

  const { failed }: Props = $props();
</script>

<div
  class="rail-pending"
  class:rail-pending--loading={!failed}
  data-testid="brand-rail-pending"
>
  <header class="rail-pending__head">
    <h1 class="rail-pending__title">{m.branding_title()}</h1>
    <p class="rail-pending__subtitle">{m.branding_description()}</p>
    {#if !failed}
      <p class="rail-pending__status" role="status">{m.branding_loading()}</p>
    {/if}
  </header>

  {#if !failed}
    <div class="rail-pending__body" aria-hidden="true">
      <Skeleton height="var(--space-9)" />
      {#each RAIL_GROUPS as group (group.id)}
        <div class="rail-pending__group">
          <Skeleton width="var(--space-24)" height="var(--space-3)" />
          {#each group.controls as control (control.id)}
            <Skeleton height="var(--space-16)" />
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .rail-pending {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* Loading fills the rail and clips the skeleton at its foot, so a short
     window never scrolls placeholder rows. Failed takes only the title's
     height, so the page's alert sits directly below it. */
  .rail-pending--loading {
    flex: 1;
    overflow: hidden;
  }

  /* The same head chrome as BrandStudioRail's browse head. */
  .rail-pending__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border-bottom: var(--border-width) var(--border-style)
      var(--color-border-subtle);
  }

  .rail-pending:not(.rail-pending--loading) {
    margin-bottom: var(--space-4);
  }

  .rail-pending__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .rail-pending__subtitle,
  .rail-pending__status {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .rail-pending__status {
    margin-top: var(--space-2);
  }

  /* Spaced like BrandStudioRail's browse list: groups, then their rows. */
  .rail-pending__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .rail-pending__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
