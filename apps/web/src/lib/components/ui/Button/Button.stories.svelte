<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from './Button.svelte';

  const { Story } = defineMeta({
    title: 'UI/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['primary', 'secondary', 'ghost', 'destructive']
      },
      size: {
        control: 'select',
        options: ['xs', 'sm', 'md', 'lg', 'xl']
      }
    }
  });
</script>

<Story name="Primary">
  <Button variant="primary">Primary Button</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">Secondary Button</Button>
</Story>

<Story name="Ghost">
  <Button variant="ghost">Ghost Button</Button>
</Story>

<Story name="Destructive">
  <Button variant="destructive">Delete</Button>
</Story>

<Story name="Loading">
  <Button loading>Saving...</Button>
</Story>

<Story name="Disabled">
  <Button disabled>Disabled</Button>
</Story>

<Story name="All Sizes">
  <div style="display: flex; gap: 8px; align-items: center;">
    <Button size="xs">XS</Button>
    <Button size="sm">SM</Button>
    <Button size="md">MD</Button>
    <Button size="lg">LG</Button>
    <Button size="xl">XL</Button>
  </div>
</Story>
