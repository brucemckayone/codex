<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Checkbox from './Checkbox.svelte';

  const { Story } = defineMeta({
    title: 'UI/Checkbox',
    component: Checkbox,
    tags: ['autodocs'],
    argTypes: {
      checked: {
        control: 'select',
        options: [true, false, 'indeterminate'],
        description: 'Checkbox state',
      },
      label: {
        control: 'text',
        description: 'Label text',
      },
      required: {
        control: 'boolean',
        description: 'Mark as required for form validation',
      },
      disabled: {
        control: 'boolean',
        description: 'Disable the checkbox',
      },
    },
  });
</script>

<Story name="Unchecked" args={{ checked: false, label: 'Unchecked' }}>
  <Checkbox checked={false} label="Unchecked" />
</Story>

<Story name="Checked" args={{ checked: true, label: 'Checked' }}>
  <Checkbox checked={true} label="Checked" />
</Story>

<Story name="Indeterminate" args={{ checked: 'indeterminate', label: 'Indeterminate' }}>
  <Checkbox checked="indeterminate" label="Indeterminate" />
</Story>

<Story name="Without Label" args={{ checked: false }}>
  <Checkbox checked={false} />
</Story>

<Story name="Required" args={{ checked: false, label: 'Required field', required: true }}>
  <Checkbox checked={false} label="Required field" required />
</Story>

<Story name="All States">
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    <Checkbox checked={false} label="Unchecked" />
    <Checkbox checked={true} label="Checked" />
    <Checkbox checked="indeterminate" label="Indeterminate" />
  </div>
</Story>

<Story name="Form Example">
  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
    <Checkbox checked={true} label="I agree to the terms of service" />
    <Checkbox checked={false} label="Subscribe to newsletter" />
    <Checkbox checked={false} label="Enable notifications" />
  </div>
</Story>
