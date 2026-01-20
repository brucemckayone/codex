<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Skeleton } from './index';

  const { Story } = defineMeta({
    title: 'UI/Skeleton',
    component: Skeleton,
    tags: ['autodocs'],
    argTypes: {
      width: { control: 'text', description: 'Width of the skeleton' },
      height: { control: 'text', description: 'Height of the skeleton' },
    },
  });
</script>

<Story name="Line" args={{ width: '300px', height: '1.5rem' }}>
  {#snippet children(args)}
    <div style="padding: 1rem;">
      <Skeleton {...args} />
    </div>
  {/snippet}
</Story>

<Story name="Circle (Avatar)" args={{ width: '48px', height: '48px', class: 'skeleton-circle' }}>
  {#snippet children(args)}
    <div style="padding: 1rem;">
      <Skeleton {...args} />
    </div>
  {/snippet}
</Story>

<Story name="Rectangle (Image)" args={{ width: '300px', height: '200px' }}>
  {#snippet children(args)}
    <div style="padding: 1rem;">
      <Skeleton {...args} />
    </div>
  {/snippet}
</Story>

<Story name="Card Placeholder">
  <div style="padding: 1rem; max-width: 350px;">
    <div style="display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
      <Skeleton width="100%" height="150px" />
      <Skeleton width="80%" height="1.25rem" />
      <Skeleton width="60%" height="1rem" />
      <div style="display: flex; gap: 0.5rem;">
        <Skeleton width="80px" height="2rem" />
        <Skeleton width="80px" height="2rem" />
      </div>
    </div>
  </div>
</Story>

<Story name="List Placeholder">
  <div style="padding: 1rem;">
    <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 400px;">
      {#each [1, 2, 3] as _}
        <div style="display: flex; gap: 0.75rem; align-items: center;">
          <Skeleton width="40px" height="40px" class="skeleton-circle" />
          <div style="flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
            <Skeleton width="70%" height="1rem" />
            <Skeleton width="50%" height="0.75rem" />
          </div>
        </div>
      {/each}
    </div>
  </div>
</Story>

<Story name="Paragraph">
  <div style="padding: 1rem;">
    <div style="display: flex; flex-direction: column; gap: 0.75rem; max-width: 500px;">
      <Skeleton width="100%" height="1.5rem" />
      <Skeleton width="90%" height="1.5rem" />
      <Skeleton width="95%" height="1.5rem" />
    </div>
  </div>
</Story>

<Story name="Text Block">
  <div style="padding: 1rem;">
    <div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 300px;">
      <Skeleton width="100%" height="1rem" />
      <Skeleton width="95%" height="1rem" />
      <Skeleton width="90%" height="1rem" />
      <Skeleton width="60%" height="1rem" />
    </div>
  </div>
</Story>
