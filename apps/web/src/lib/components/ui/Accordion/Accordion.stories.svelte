<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from '@storybook/test';
  import { writable } from 'svelte/store';
  import * as Accordion from './index';

  const { Story } = defineMeta({
    title: 'UI/Accordion',
    tags: ['autodocs'],
  });

  // Stores to demonstrate two-way binding with accordion state
  const defaultValue = writable<string | string[] | undefined>('item-1');
  const faqValue = writable<string | string[] | undefined>('faq-1');
  const interactiveValue = writable<string | string[] | undefined>(undefined);
</script>

<Story name="Default">
  <div style="max-width: 500px;">
    <Accordion.Root defaultValue="item-1" bind:value={$defaultValue}>
      <Accordion.Item value="item-1">
        <Accordion.Trigger>Is this component accessible?</Accordion.Trigger>
        <Accordion.Content>
          Yes! This accordion follows WAI-ARIA patterns and supports keyboard navigation.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-2">
        <Accordion.Trigger>Can multiple items be open?</Accordion.Trigger>
        <Accordion.Content>
          By default, only one item can be open at a time. This follows the standard accordion pattern.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-3">
        <Accordion.Trigger>Is it styled with CSS tokens?</Accordion.Trigger>
        <Accordion.Content>
          Yes, all components use CSS custom properties from our design tokens, ensuring consistency across the design system.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  </div>
</Story>

<Story name="FAQ Example">
  <div style="max-width: 600px;">
    <h3 style="margin-bottom: 1rem; color: var(--color-text);">Frequently Asked Questions</h3>
    <Accordion.Root defaultValue="faq-1" bind:value={$faqValue}>
      <Accordion.Item value="faq-1">
        <Accordion.Trigger>How do I get started?</Accordion.Trigger>
        <Accordion.Content>
          Sign up for an account, verify your email, and you're ready to start creating content. Our onboarding guide will walk you through the basics.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="faq-2">
        <Accordion.Trigger>What payment methods are accepted?</Accordion.Trigger>
        <Accordion.Content>
          We accept all major credit cards through Stripe, including Visa, Mastercard, American Express, and Discover.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="faq-3">
        <Accordion.Trigger>Can I cancel my subscription?</Accordion.Trigger>
        <Accordion.Content>
          Yes, you can cancel your subscription at any time from your account settings. Your access will continue until the end of your billing period.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="faq-4">
        <Accordion.Trigger>How do I contact support?</Accordion.Trigger>
        <Accordion.Content>
          You can reach our support team via email at support@example.com or through the in-app chat. We typically respond within 24 hours.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  </div>
</Story>

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find accordion triggers by their text
    const trigger1 = canvas.getByRole('button', { name: /first item/i });
    const trigger2 = canvas.getByRole('button', { name: /second item/i });

    // Verify first trigger is present
    await expect(trigger1).toBeInTheDocument();

    // Click first item to expand
    await userEvent.click(trigger1);

    // Wait for content to appear (accordion uses animations)
    const content1 = await canvas.findByText(/content for the first item/i);
    await expect(content1).toBeInTheDocument();

    // Click second item
    await userEvent.click(trigger2);

    // Wait for second content to appear
    const content2 = await canvas.findByText(/content for the second item/i);
    await expect(content2).toBeInTheDocument();
  }}
>
  <div style="max-width: 500px;">
    <Accordion.Root bind:value={$interactiveValue}>
      <Accordion.Item value="test-1">
        <Accordion.Trigger>First Item</Accordion.Trigger>
        <Accordion.Content>
          Content for the first item. This text should be visible when expanded.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="test-2">
        <Accordion.Trigger>Second Item</Accordion.Trigger>
        <Accordion.Content>
          Content for the second item. Only one item can be open at a time.
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="test-3">
        <Accordion.Trigger>Third Item</Accordion.Trigger>
        <Accordion.Content>
          Content for the third item. Click to expand.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  </div>
</Story>
