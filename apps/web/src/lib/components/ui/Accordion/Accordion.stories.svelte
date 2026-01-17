<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import * as Accordion from './index';

  const { Story } = defineMeta({
    title: 'UI/Accordion',
    tags: ['autodocs'],
  });

  // Stores to demonstrate two-way binding with accordion state
  const defaultValue = writable<string | string[] | undefined>('item-1');
  const faqValue = writable<string | string[] | undefined>('faq-1');
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
