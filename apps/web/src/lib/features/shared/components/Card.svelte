<script lang="ts">
  interface Props {
    title: string;
    description?: string;
    children?: any;
  }

  let { title, description, children }: Props = $props();
</script>

<div class="card">
  <h3>{title}</h3>
  {#if description}
    <p class="description">{description}</p>
  {/if}
  {#if children}
    <div class="content">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .card {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    color: #333;
  }

  .description {
    margin: 0 0 1rem 0;
    color: #666;
  }

  .content {
    margin-top: 1rem;
  }
</style>
