<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
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
</script>

<Story name="Default" args={{ options: fruitOptions, placeholder: 'Select a fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} placeholder="Select a fruit" />
  </div>
</Story>

<Story name="With Label" args={{ options: fruitOptions, label: 'Favorite Fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} label="Favorite Fruit" />
  </div>
</Story>

<Story name="With Selected Value" args={{ options: fruitOptions, value: 'banana', label: 'Favorite Fruit' }}>
  <div style="width: 200px;">
    <Select options={fruitOptions} value="banana" label="Favorite Fruit" />
  </div>
</Story>

<Story name="Status Selector" args={{ options: statusOptions, label: 'Status', value: 'draft' }}>
  <div style="width: 200px;">
    <Select options={statusOptions} label="Status" value="draft" />
  </div>
</Story>

<Story name="Form Example">
  <div style="display: flex; flex-direction: column; gap: 1rem; width: 250px;">
    <Select options={statusOptions} label="Content Status" placeholder="Select status" />
    <Select options={fruitOptions} label="Category" placeholder="Select category" />
  </div>
</Story>
