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
        options: ['primary', 'secondary', 'ghost', 'destructive'],
        description: 'Visual style variant',
      },
      size: {
        control: 'select',
        options: ['xs', 'sm', 'md', 'lg', 'xl'],
        description: 'Button size',
      },
      loading: {
        control: 'boolean',
        description: 'Shows loading spinner and disables button',
      },
      disabled: {
        control: 'boolean',
        description: 'Disables the button',
      },
    },
  });
</script>

<!-- Variants -->
<Story name="Primary" args={{ variant: 'primary', size: 'md' }}>
  <Button variant="primary" size="md">Primary Button</Button>
</Story>

<Story name="Secondary" args={{ variant: 'secondary', size: 'md' }}>
  <Button variant="secondary" size="md">Secondary Button</Button>
</Story>

<Story name="Ghost" args={{ variant: 'ghost', size: 'md' }}>
  <Button variant="ghost" size="md">Ghost Button</Button>
</Story>

<Story name="Destructive" args={{ variant: 'destructive', size: 'md' }}>
  <Button variant="destructive" size="md">Delete</Button>
</Story>

<!-- Sizes -->
<Story name="Extra Small" args={{ variant: 'primary', size: 'xs' }}>
  <Button variant="primary" size="xs">XS</Button>
</Story>

<Story name="Small" args={{ variant: 'primary', size: 'sm' }}>
  <Button variant="primary" size="sm">Small</Button>
</Story>

<Story name="Medium" args={{ variant: 'primary', size: 'md' }}>
  <Button variant="primary" size="md">Medium</Button>
</Story>

<Story name="Large" args={{ variant: 'primary', size: 'lg' }}>
  <Button variant="primary" size="lg">Large</Button>
</Story>

<Story name="Extra Large" args={{ variant: 'primary', size: 'xl' }}>
  <Button variant="primary" size="xl">Extra Large</Button>
</Story>

<!-- States -->
<Story name="Loading" args={{ variant: 'primary', size: 'md', loading: true }}>
  <Button variant="primary" size="md" loading>Loading...</Button>
</Story>

<Story name="Disabled" args={{ variant: 'primary', size: 'md', disabled: true }}>
  <Button variant="primary" size="md" disabled>Disabled</Button>
</Story>

<!-- All Variants Grid -->
<Story name="All Variants">
  <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="destructive">Destructive</Button>
  </div>
</Story>

<!-- All Sizes Grid -->
<Story name="All Sizes">
  <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
    <Button size="xs">XS</Button>
    <Button size="sm">SM</Button>
    <Button size="md">MD</Button>
    <Button size="lg">LG</Button>
    <Button size="xl">XL</Button>
  </div>
</Story>
