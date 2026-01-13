<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Switch from './Switch.svelte';

  const { Story } = defineMeta({
    title: 'UI/Switch',
    component: Switch,
    tags: ['autodocs'],
    argTypes: {
      checked: { control: 'boolean' },
      disabled: { control: 'boolean' }
    }
  });
</script>

<Story name="Default">
  <Switch />
</Story>

<Story name="Checked">
  <Switch checked={true} />
</Story>

<Story name="Disabled">
  <Switch disabled />
</Story>

<Story name="Disabled Checked">
  <Switch disabled checked={true} />
</Story>
