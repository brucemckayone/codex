<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from '../Button/Button.svelte';
  import * as Tooltip from './index';

  const { Story } = defineMeta({
    title: 'UI/Tooltip',
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <div style="padding: 2rem;">
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button variant="secondary">Hover me</Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        This is a tooltip
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
</Story>

<Story name="On Icon Button">
  <div style="padding: 2rem;">
    <Tooltip.Root>
      <Tooltip.Trigger>
        <button style="padding: 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        Get help
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
</Story>

<Story name="Multiple Tooltips">
  <div style="display: flex; gap: 1rem; padding: 2rem;">
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button variant="ghost" size="sm">Edit</Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        Edit this item
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Root>
    
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button variant="ghost" size="sm">Delete</Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        Delete this item
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Root>
    
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button variant="ghost" size="sm">Share</Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        Share this item
        <Tooltip.Arrow />
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
</Story>
