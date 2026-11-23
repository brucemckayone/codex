<!--
  @component DockBannerHost

  Shows the slot's banner where there is no dock: on desktop, and in the
  studio, which mounts no dock. It floats bottom-centre at the dock's banner
  height. Below md, where a mounted phone dock shows the banner, this host
  draws nothing (dockShowsBanner), so there is never a second copy. Mounted inside each route group's brand
  scope (the org layout, which also holds the studio, and the platform
  layout), never in the root layout, which sits above every org's brand.
-->
<script lang="ts">
  import DockBanner from './DockBanner.svelte';
  import { currentDockBanner, dockShowsBanner } from './dock-banner.svelte';

  const banner = $derived(dockShowsBanner() ? null : currentDockBanner());
</script>

{#if banner}
  <div class="banner-host">
    <DockBanner offer={banner} />
  </div>
{/if}

<style>
  .banner-host {
    position: fixed;
    inset-inline: var(--space-4);
    inset-block-end: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    z-index: var(--z-fixed);
    max-inline-size: var(--container-drawer);
    margin-inline: auto;
    block-size: var(--space-12);
  }

  /* A printed page has no use for a call-to-action floating over it. */
  @media print {
    .banner-host {
      display: none;
    }
  }
</style>
