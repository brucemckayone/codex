<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Skeleton } from './index';

  const { Story } = defineMeta({
    title: 'UI/Skeleton',
    component: Skeleton,
    tags: ['autodocs'],
  });
</script>

<Story name="Line">
  <Skeleton style="height: 1rem; width: 200px;" />
</Story>

<Story name="Circle (Avatar)">
  <Skeleton style="height: 48px; width: 48px; border-radius: 50%;" />
</Story>

<Story name="Rectangle (Image)">
  <Skeleton style="height: 200px; width: 300px;" />
</Story>

<Story name="Card Placeholder">
  <div style="display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border: 1px solid #e5e5e5; border-radius: 8px; width: 300px;">
    <Skeleton style="height: 150px; width: 100%;" />
    <Skeleton style="height: 1.25rem; width: 80%;" />
    <Skeleton style="height: 1rem; width: 60%;" />
    <div style="display: flex; gap: 0.5rem;">
      <Skeleton style="height: 2rem; width: 80px;" />
      <Skeleton style="height: 2rem; width: 80px;" />
    </div>
  </div>
</Story>

<Story name="List Placeholder">
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    {#each [1, 2, 3] as _}
      <div style="display: flex; gap: 0.75rem; align-items: center;">
        <Skeleton style="height: 40px; width: 40px; border-radius: 50%;" />
        <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
          <Skeleton style="height: 1rem; width: 70%;" />
          <Skeleton style="height: 0.75rem; width: 50%;" />
        </div>
      </div>
    {/each}
  </div>
</Story>

<Story name="Text Block">
  <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 300px;">
    <Skeleton style="height: 1rem; width: 100%;" />
    <Skeleton style="height: 1rem; width: 95%;" />
    <Skeleton style="height: 1rem; width: 90%;" />
    <Skeleton style="height: 1rem; width: 60%;" />
  </div>
</Story>
