<script lang="ts">
  import Button from '$lib/components/Button.svelte';

  let count = $state(0);

  function increment() {
    count += 1;
  }
</script>

<svelte:head>
  <title>Codex - Home</title>
</svelte:head>

<main>
  <h1>Welcome to Codex</h1>
  <p>Counter: {count}</p>
  <button onclick={increment}>Increment</button>
</main>

<style>
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    color: #333;
    margin-bottom: 1rem;
  }
</style>
