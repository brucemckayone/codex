<!--
  @component SettingsLayout

  Masthead + content shell for the organisation settings subtree. It owns the
  page's single `<h1>`; child routes that need their own heading use
  `PageHeader variant="compact"` (which defaults to `<h2>`) plus a `kickerHref`
  back-link — see `settings/email-templates/+page.svelte`.

  There is deliberately NO tab strip. It listed exactly one destination
  ("General") after branding moved to `/studio/brand` (Codex-cijzb), which made
  it a tablist you could neither leave nor act on: it cost a full row plus a
  hairline, restated the `<h1>` verbatim, and its `.active` state painted raw
  brand ink as 14px text (measured 3.82:1 on studio-alpha dark, 3.85:1 on
  of-blood-and-bones dark — both AA failures at that size, and unbounded
  because `--color-interactive` resolves to arbitrary user input). Deleting the
  strip removed the WCAG failure rather than recolouring it. If a second
  settings destination is ever added, bring back a strip with BOTH entries —
  not a one-item one.

  @prop {LayoutData} data - Server-loaded data (orgId from parent)
  @prop {Snippet} children - Child route content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import { PageHeader } from '$lib/components/ui';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
  <title>{m.settings_title()} | {data.org.name} Studio</title>
</svelte:head>

<div class="settings-layout">
  <PageHeader
    kicker={m.studio_section_organisation()}
    title={m.settings_title()}
    description={m.settings_description()}
  />

  <div class="settings-content">
    {@render children()}
  </div>
</div>

<style>
  /* NO outer max-width. This subtree used to cap itself to --container-max,
     which capped the MASTHEAD as well as the form: at 1920 the settings header
     stopped at x=1368 while Team's and Customers' ran to x=1896, so navigating
     Team → Settings jumped the page header 528px inward. The form measure now
     lives on the form itself (`.settings-form` in `+page.svelte`), which is
     what the old comment here asked for. The studio shell
     (`studio/+layout.svelte`'s `.studio-layout__main`) owns the COLUMN, and
     with this cap gone it has no exceptions left. */
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .settings-content {
    flex: 1;
    min-width: 0;
  }
</style>
