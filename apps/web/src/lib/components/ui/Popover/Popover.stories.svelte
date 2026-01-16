<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from '../Button/Button.svelte';
  import * as Popover from './index';

  const { Story } = defineMeta({
    title: 'UI/Popover',
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <div style="padding: 2rem;">
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="secondary">Open Popover</Button>
      </Popover.Trigger>
      <Popover.Content>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <h4 style="margin: 0; color: var(--color-text);">Popover Title</h4>
          <p style="margin: 0; font-size: 0.875rem; color: var(--color-text-secondary);">This is a popover with some content.</p>
        </div>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>

<Story name="Filter Popover">
  <div style="padding: 2rem;">
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="secondary">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          Filter
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <div style="display: flex; flex-direction: column; gap: 1rem; min-width: 200px;">
          <h4 style="margin: 0; color: var(--color-text);">Filters</h4>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--color-text);">
              <input type="checkbox" /> Published
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--color-text);">
              <input type="checkbox" /> Draft
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--color-text);">
              <input type="checkbox" /> Archived
            </label>
          </div>
          <Button variant="primary" size="sm">Apply Filters</Button>
        </div>
      </Popover.Content>
    </Popover.Root>
  </div>
</Story>
