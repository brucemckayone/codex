<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from '@storybook/test';
  import { writable } from 'svelte/store';
  import Select from './Select.svelte';

  const { Story } = defineMeta({
    title: 'UI/Select',
    component: Select,
    tags: ['autodocs'],
    argTypes: {
      placeholder: {
        control: 'text',
        description: 'Placeholder text',
      },
      label: {
        control: 'text',
        description: 'Label text',
      },
    },
  });

  const fruitOptions = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'Cherry' },
    { value: 'grape', label: 'Grape' },
    { value: 'orange', label: 'Orange' },
  ];

  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
    { value: 'archived', label: 'Archived' },
  ];

  // State stores for each story
  const fruitValue = writable<string | undefined>(undefined);
  const labeledValue = writable<string | undefined>(undefined);
  const selectedValue = writable<string | undefined>('banana');
  const statusValue = writable<string | undefined>('draft');
  const formStatus = writable<string | undefined>(undefined);
  const formCategory = writable<string | undefined>(undefined);
  const interactiveValue = writable<string | undefined>(undefined);
</script>

<Story name="Default" args={{ options: fruitOptions, placeholder: 'Select a fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} placeholder="Select a fruit" bind:value={$fruitValue} />
    <p style="margin-top: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
      Selected: {$fruitValue ?? 'None'}
    </p>
  </div>
</Story>

<Story name="With Label" args={{ options: fruitOptions, label: 'Favorite Fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} label="Favorite Fruit" bind:value={$labeledValue} />
    <p style="margin-top: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
      Selected: {$labeledValue ?? 'None'}
    </p>
  </div>
</Story>

<Story name="With Selected Value" args={{ options: fruitOptions, value: 'banana', label: 'Favorite Fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} label="Favorite Fruit" bind:value={$selectedValue} />
    <p style="margin-top: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
      Selected: {$selectedValue ?? 'None'}
    </p>
  </div>
</Story>

<Story name="Status Selector" args={{ options: statusOptions, label: 'Status', value: 'draft' }}>
  <div style="width: 200px;">
    <Select options={statusOptions} label="Status" bind:value={$statusValue} />
    <p style="margin-top: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
      Selected: {$statusValue ?? 'None'}
    </p>
  </div>
</Story>

<Story name="Form Example">
  <div style="display: flex; flex-direction: column; gap: 1rem; width: 250px;">
    <Select options={statusOptions} label="Content Status" placeholder="Select status" bind:value={$formStatus} />
    <Select options={fruitOptions} label="Category" placeholder="Select category" bind:value={$formCategory} />
    <p style="font-size: 0.875rem; color: var(--color-text-secondary);">
      Status: {$formStatus ?? 'None'} | Category: {$formCategory ?? 'None'}
    </p>
  </div>
</Story>

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find the select trigger
    const trigger = canvas.getByRole('combobox');
    await expect(trigger).toBeInTheDocument();

    // Verify the trigger has placeholder text
    await expect(trigger).toHaveTextContent('Select');

    // Click to open dropdown
    await userEvent.click(trigger);

    // Verify aria-expanded changed
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  }}
>
  <div style="width: 200px;">
    <Select
      options={fruitOptions}
      label="Pick a Fruit"
      placeholder="Select a fruit"
      bind:value={$interactiveValue}
    />
    <p data-testid="selection-display" style="margin-top: 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
      Selected: {$interactiveValue ?? 'None'}
    </p>
  </div>
</Story>
