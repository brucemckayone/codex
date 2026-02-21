<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { PurchaseButton } from './index';

  const { Story } = defineMeta({
    title: 'Commerce/PurchaseButton',
    component: PurchaseButton,
    tags: ['autodocs'],
    argTypes: {
      contentId: {
        control: 'text',
        description: 'The UUID of the content to purchase',
      },
      variant: {
        control: 'select',
        options: ['primary', 'secondary'],
        description: 'Visual style variant',
      },
      size: {
        control: 'select',
        options: ['sm', 'md', 'lg'],
        description: 'Button size',
      },
      disabled: {
        control: 'boolean',
        description: 'Whether the button is disabled',
      },
    },
  });
</script>

<!-- Variants -->
<Story name="Primary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'primary', size: 'md' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="md"
  />
</Story>

<Story name="Secondary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'secondary', size: 'md' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="secondary"
    size="md"
  />
</Story>

<!-- Sizes -->
<Story name="Small Primary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'primary', size: 'sm' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="sm"
  />
</Story>

<Story name="Medium Primary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'primary', size: 'md' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="md"
  />
</Story>

<Story name="Large Primary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'primary', size: 'lg' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="lg"
  />
</Story>

<Story name="Small Secondary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'secondary', size: 'sm' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="secondary"
    size="sm"
  />
</Story>

<Story name="Medium Secondary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'secondary', size: 'md' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="secondary"
    size="md"
  />
</Story>

<Story name="Large Secondary" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'secondary', size: 'lg' }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="secondary"
    size="lg"
  />
</Story>

<!-- States -->
<Story name="Disabled" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', variant: 'primary', size: 'md', disabled: true }}>
  <PurchaseButton
    contentId="123e4567-e89b-12d3-a456-426614174000"
    variant="primary"
    size="md"
    disabled={true}
  />
</Story>

<!-- All Variants Grid -->
<Story name="All Variants">
  <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
    <PurchaseButton
      contentId="123e4567-e89b-12d3-a456-426614174000"
      variant="primary"
      size="md"
    />
    <PurchaseButton
      contentId="123e4567-e89b-12d3-a456-426614174000"
      variant="secondary"
      size="md"
    />
  </div>
</Story>

<!-- All Sizes Grid -->
<Story name="All Sizes">
  <div style="display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
    <PurchaseButton
      contentId="123e4567-e89b-12d3-a456-426614174000"
      variant="primary"
      size="sm"
    />
    <PurchaseButton
      contentId="123e4567-e89b-12d3-a456-426614174000"
      variant="primary"
      size="md"
    />
    <PurchaseButton
      contentId="123e4567-e89b-12d3-a456-426614174000"
      variant="primary"
      size="lg"
    />
  </div>
</Story>

<!-- With Context -->
<Story name="In Context Card">
  <div style="max-width: 400px; padding: 1.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface);">
    <h3 style="margin: 0 0 0.5rem; font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-text);">
      Complete Web Development Course
    </h3>
    <p style="margin: 0 0 1rem; font-size: var(--text-sm); color: var(--color-text-secondary);">
      Learn modern web development from scratch. Includes 40+ hours of video content.
    </p>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-text);">
        PS24.99
      </span>
      <PurchaseButton
        contentId="123e4567-e89b-12d3-a456-426614174000"
        variant="primary"
        size="md"
      />
    </div>
  </div>
</Story>
