<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Button from '../Button/Button.svelte';
  import * as Card from './index';

  const { Story } = defineMeta({
    title: 'UI/Card',
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <div style="max-width: 350px;">
    <Card.Root>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>A brief description of the card content.</Card.Description>
      </Card.Header>
      <Card.Content>
        <p style="color: var(--color-text);">This is the main content of the card. You can put any content here.</p>
      </Card.Content>
      <Card.Footer>
        <Button variant="primary">Action</Button>
      </Card.Footer>
    </Card.Root>
  </div>
</Story>

<Story name="Simple Card">
  <div style="max-width: 350px;">
    <Card.Root>
      <Card.Content>
        <p style="color: var(--color-text);">A simple card with just content, no header or footer.</p>
      </Card.Content>
    </Card.Root>
  </div>
</Story>

<Story name="Content Card">
  <div style="max-width: 400px;">
    <Card.Root>
      <div style="aspect-ratio: 16/9; background: var(--color-neutral-200); border-radius: var(--radius-md) var(--radius-md) 0 0;"></div>
      <Card.Header>
        <Card.Title>Video Tutorial</Card.Title>
        <Card.Description>Learn how to build components with Svelte 5</Card.Description>
      </Card.Header>
      <Card.Content>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <span style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">Svelte</span>
          <span style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">Tutorial</span>
        </div>
      </Card.Content>
      <Card.Footer>
        <span style="font-size: 0.875rem; color: var(--color-text-secondary);">45 min</span>
        <Button variant="primary" size="sm">Watch Now</Button>
      </Card.Footer>
    </Card.Root>
  </div>
</Story>

<Story name="Stats Card">
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; max-width: 600px;">
    <Card.Root>
      <Card.Header>
        <Card.Description>Total Revenue</Card.Description>
        <Card.Title>$45,231</Card.Title>
      </Card.Header>
      <Card.Content>
        <span style="font-size: 0.75rem; color: var(--color-success-600);">+20.1% from last month</span>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header>
        <Card.Description>Subscribers</Card.Description>
        <Card.Title>+2,350</Card.Title>
      </Card.Header>
      <Card.Content>
        <span style="font-size: 0.75rem; color: var(--color-success-600);">+180 this week</span>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header>
        <Card.Description>Active Now</Card.Description>
        <Card.Title>573</Card.Title>
      </Card.Header>
      <Card.Content>
        <span style="font-size: 0.75rem; color: var(--color-text-secondary);">+201 since last hour</span>
      </Card.Content>
    </Card.Root>
  </div>
</Story>
