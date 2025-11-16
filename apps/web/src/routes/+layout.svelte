<script lang="ts">
  import type { LayoutData } from './$types';

  // eslint-disable-next-line no-unused-vars
  const { data: _, children }: { data: LayoutData; children: any } = $props();
</script>

<div class="app">
  <main>
    {@render children()}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
      Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  }
</style>
