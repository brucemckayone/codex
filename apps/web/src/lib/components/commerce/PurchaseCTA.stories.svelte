<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { PurchaseCTA } from './index';

  const { Story } = defineMeta({
    title: 'Commerce/PurchaseCTA',
    component: PurchaseCTA,
    tags: ['autodocs'],
    argTypes: {
      contentId: {
        control: 'text',
        description: 'The UUID of the content',
      },
      priceCents: {
        control: 'number',
        description: 'Price in cents (null or 0 = free)',
      },
      isPurchased: {
        control: 'boolean',
        description: 'Whether the user has already purchased this content',
      },
      watchUrl: {
        control: 'text',
        description: 'URL to navigate to when clicking "Watch Now"',
      },
      size: {
        control: 'select',
        options: ['sm', 'md', 'lg'],
        description: 'Size variant for the CTA',
      },
    },
  });
</script>

<!-- Paid Content State -->
<Story name="Paid Content" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 999, size: 'md' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={999}
    size="md"
  />
</Story>

<Story name="Paid Content - High Price" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 4999, size: 'md' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={4999}
    size="md"
  />
</Story>

<!-- Purchased State -->
<Story name="Purchased Content" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 999, isPurchased: true, watchUrl: '/watch/123', size: 'md' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={999}
    isPurchased={true}
    watchUrl="/watch/123"
    size="md"
  />
</Story>

<!-- Free Content State -->
<Story name="Free Content" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: null, watchUrl: '/watch/123', size: 'md' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={null}
    watchUrl="/watch/123"
    size="md"
  />
</Story>

<Story name="Free Content - Zero Price" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 0, watchUrl: '/watch/123', size: 'md' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={0}
    watchUrl="/watch/123"
    size="md"
  />
</Story>

<!-- Size Variants -->
<Story name="Small Size" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 999, size: 'sm' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={999}
    size="sm"
  />
</Story>

<Story name="Large Size" args={{ contentId: '123e4567-e89b-12d3-a456-426614174000', priceCents: 999, size: 'lg' }}>
  <PurchaseCTA
    contentId="123e4567-e89b-12d3-a456-426614174000"
    priceCents={999}
    size="lg"
  />
</Story>

<!-- All States Grid -->
<Story name="All States">
  <div style="display: flex; flex-direction: column; gap: 2rem; max-width: 400px;">
    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Paid Content</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={1999}
      />
    </div>

    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Purchased Content</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={1999}
        isPurchased={true}
        watchUrl="/watch/123"
      />
    </div>

    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Free Content</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={null}
        watchUrl="/watch/123"
      />
    </div>
  </div>
</Story>

<!-- All Sizes Grid -->
<Story name="All Sizes">
  <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 400px;">
    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Small</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={999}
        size="sm"
      />
    </div>

    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Medium</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={999}
        size="md"
      />
    </div>

    <div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: var(--color-text-muted);">Large</h4>
      <PurchaseCTA
        contentId="123e4567-e89b-12d3-a456-426614174000"
        priceCents={999}
        size="lg"
      />
    </div>
  </div>
</Story>

<!-- With Children Snippet -->
<Story name="With Additional Content">
  <div style="max-width: 400px;">
    <PurchaseCTA
      contentId="123e4567-e89b-12d3-a456-426614174000"
      priceCents={1999}
      size="md"
    >
      {#snippet children()}
        <div style="padding: var(--space-3); background-color: var(--color-surface-secondary); border-radius: var(--radius-md); margin-top: var(--space-3);">
          <p style="margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary);">
            This purchase includes:
          </p>
          <ul style="margin: var(--space-2) 0 0 0; padding-left: var(--space-5); font-size: var(--text-sm); color: var(--color-text-secondary);">
            <li>Full HD video</li>
            <li>Downloadable resources</li>
            <li>Lifetime access</li>
          </ul>
        </div>
      {/snippet}
    </PurchaseCTA>
  </div>
</Story>

<Story name="Purchased With Children">
  <div style="max-width: 400px;">
    <PurchaseCTA
      contentId="123e4567-e89b-12d3-a456-426614174000"
      priceCents={1999}
      isPurchased={true}
      watchUrl="/watch/123"
      size="md"
    >
      {#snippet children()}
        <p style="margin: var(--space-2) 0 0 0; font-size: var(--text-sm); color: var(--color-text-muted);">
          You own this content. Start watching now!
        </p>
      {/snippet}
    </PurchaseCTA>
  </div>
</Story>

<Story name="Free With Children">
  <div style="max-width: 400px;">
    <PurchaseCTA
      contentId="123e4567-e89b-12d3-a456-426614174000"
      priceCents={null}
      watchUrl="/watch/123"
      size="md"
    >
      {#snippet children()}
        <p style="margin: var(--space-2) 0 0 0; font-size: var(--text-sm); color: var(--color-text-muted);">
          No purchase required. Enjoy this free content!
        </p>
      {/snippet}
    </PurchaseCTA>
  </div>
</Story>
