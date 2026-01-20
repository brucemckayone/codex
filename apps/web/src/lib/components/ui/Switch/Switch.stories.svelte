<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Switch from './Switch.svelte';

  const { Story } = defineMeta({
    title: 'UI/Switch',
    component: Switch,
    tags: ['autodocs'],
    argTypes: {
      checked: {
        control: 'boolean',
        description: 'Switch state',
      },
      disabled: {
        control: 'boolean',
        description: 'Disable the switch',
      },
      required: {
        control: 'boolean',
        description: 'Mark as required for form validation',
      },
    },
  });
</script>

<Story name="Off" args={{ checked: false }}>
  <Switch checked={false} />
</Story>

<Story name="On" args={{ checked: true }}>
  <Switch checked={true} />
</Story>

<Story name="Disabled Off" args={{ checked: false, disabled: true }}>
  <Switch checked={false} disabled />
</Story>

<Story name="Disabled On" args={{ checked: true, disabled: true }}>
  <Switch checked={true} disabled />
</Story>

<Story name="With Label">
  <div style="display: flex; align-items: center; gap: 0.75rem;">
    <Switch checked={true} />
    <span>Enable notifications</span>
  </div>
</Story>

<Story name="Settings Example">
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    <div style="display: flex; align-items: center; justify-content: space-between; min-width: 250px;">
      <span>Dark mode</span>
      <Switch checked={false} />
    </div>
    <div style="display: flex; align-items: center; justify-content: space-between; min-width: 250px;">
      <span>Email notifications</span>
      <Switch checked={true} />
    </div>
    <div style="display: flex; align-items: center; justify-content: space-between; min-width: 250px;">
      <span>Marketing emails</span>
      <Switch checked={false} />
    </div>
  </div>
</Story>
