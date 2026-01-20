```svelte
<script lang="ts">
  import type { LayoutData } from './$types';

  export let data: LayoutData;

  // Reactive derived values for branding
  $: brandConfig = data.brandConfig;
  $: primaryColor = brandConfig?.primaryColorHex ?? '#FA5125'; // Default Terracotta
  $: logoUrl = brandConfig?.logoUrl;
</script>

<svelte:head>
  <!-- Inject Critical CSS Variables for Zero-Latency Branding -->
  {@html `<style>
    :root {
      --brand-primary: ${primaryColor};
    }
  </style>`}
</svelte:head>

<div class="org-layout" style="--brand-primary: {primaryColor}">
  <slot />
</div>
