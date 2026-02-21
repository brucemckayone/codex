<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { PriceDisplay } from './index';

  const { Story } = defineMeta({
    title: 'Commerce/PriceDisplay',
    component: PriceDisplay,
    tags: ['autodocs'],
    argTypes: {
      priceCents: {
        control: 'number',
        description: 'Price in cents (null for free)',
      },
      size: {
        control: 'select',
        options: ['sm', 'md', 'lg'],
        description: 'Size variant',
      },
      currency: {
        control: 'text',
        description: 'Currency code (e.g., GBP, USD)',
      },
      locale: {
        control: 'text',
        description: 'Locale for formatting (e.g., en-GB, en-US)',
      },
    },
  });
</script>

<!-- Size Variants -->
<Story name="Small">
  <PriceDisplay priceCents={999} size="sm" />
</Story>

<Story name="Medium">
  <PriceDisplay priceCents={999} size="md" />
</Story>

<Story name="Large">
  <PriceDisplay priceCents={999} size="lg" />
</Story>

<!-- Price Amounts -->
<Story name="Low Price">
  <PriceDisplay priceCents={99} size="md" />
</Story>

<Story name="Medium Price">
  <PriceDisplay priceCents={999} size="md" />
</Story>

<Story name="High Price">
  <PriceDisplay priceCents={9999} size="md" />
</Story>

<Story name="Very High Price">
  <PriceDisplay priceCents={99999} size="md" />
</Story>

<!-- Free State -->
<Story name="Free (Null)">
  <PriceDisplay priceCents={null} size="md" />
</Story>

<Story name="Free (Zero)">
  <PriceDisplay priceCents={0} size="md" />
</Story>

<!-- All Sizes Grid -->
<Story name="All Sizes">
  <div style="display: flex; flex-direction: column; gap: var(--space-4); align-items: flex-start;">
    <div>
      <strong>Small:</strong>
      <PriceDisplay priceCents={999} size="sm" />
    </div>
    <div>
      <strong>Medium:</strong>
      <PriceDisplay priceCents={999} size="md" />
    </div>
    <div>
      <strong>Large:</strong>
      <PriceDisplay priceCents={999} size="lg" />
    </div>
  </div>
</Story>

<!-- All Price Variants Grid -->
<Story name="Price Examples">
  <div style="display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start;">
    <PriceDisplay priceCents={null} size="md" />
    <PriceDisplay priceCents={0} size="md" />
    <PriceDisplay priceCents={99} size="md" />
    <PriceDisplay priceCents={499} size="md" />
    <PriceDisplay priceCents={999} size="md" />
    <PriceDisplay priceCents={1999} size="md" />
    <PriceDisplay priceCents={4999} size="md" />
    <PriceDisplay priceCents={9999} size="md" />
  </div>
</Story>
