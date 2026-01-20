<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Cluster from './Cluster.svelte';
  import PageContainer from './PageContainer.svelte';
  import Stack from './Stack.svelte';

  const { Story } = defineMeta({
    title: 'UI/Layout',
    tags: ['autodocs'],
  });
</script>

<!-- Stack Stories -->
<Story name="Stack - Default">
  <Stack>
    <div style="padding: 1rem; background: var(--color-primary-100); border-radius: 4px;">Item 1</div>
    <div style="padding: 1rem; background: var(--color-primary-100); border-radius: 4px;">Item 2</div>
    <div style="padding: 1rem; background: var(--color-primary-100); border-radius: 4px;">Item 3</div>
  </Stack>
</Story>

<Story name="Stack - Small Gap">
  <Stack gap="var(--space-2)">
    <div style="padding: 0.5rem; background: var(--color-success-100); border-radius: 4px;">Item 1</div>
    <div style="padding: 0.5rem; background: var(--color-success-100); border-radius: 4px;">Item 2</div>
    <div style="padding: 0.5rem; background: var(--color-success-100); border-radius: 4px;">Item 3</div>
  </Stack>
</Story>

<Story name="Stack - Large Gap">
  <Stack gap="var(--space-8)">
    <div style="padding: 1rem; background: var(--color-warning-100); border-radius: 4px;">Item 1</div>
    <div style="padding: 1rem; background: var(--color-warning-100); border-radius: 4px;">Item 2</div>
    <div style="padding: 1rem; background: var(--color-warning-100); border-radius: 4px;">Item 3</div>
  </Stack>
</Story>

<Story name="Stack - Center Aligned">
  <Stack align="center">
    <div style="padding: 1rem; background: var(--color-error-100); border-radius: 4px;">Short</div>
    <div style="padding: 1rem; background: var(--color-error-100); border-radius: 4px;">Medium Length Item</div>
    <div style="padding: 1rem; background: var(--color-error-100); border-radius: 4px;">A Much Longer Item Here</div>
  </Stack>
</Story>

<!-- Cluster Stories -->
<Story name="Cluster - Default">
  <Cluster>
    <div style="padding: 0.5rem 1rem; background: var(--color-primary-100); border-radius: 4px;">Tag 1</div>
    <div style="padding: 0.5rem 1rem; background: var(--color-primary-100); border-radius: 4px;">Tag 2</div>
    <div style="padding: 0.5rem 1rem; background: var(--color-primary-100); border-radius: 4px;">Tag 3</div>
    <div style="padding: 0.5rem 1rem; background: var(--color-primary-100); border-radius: 4px;">Tag 4</div>
    <div style="padding: 0.5rem 1rem; background: var(--color-primary-100); border-radius: 4px;">Tag 5</div>
  </Cluster>
</Story>

<Story name="Cluster - Space Between">
  <div style="width: 400px; border: 1px dashed var(--color-border); padding: 1rem;">
    <Cluster justify="space-between">
      <span style="color: var(--color-text);">Left Content</span>
      <span style="color: var(--color-text);">Right Content</span>
    </Cluster>
  </div>
</Story>

<Story name="Cluster - Center">
  <div style="width: 400px; border: 1px dashed var(--color-border); padding: 1rem;">
    <Cluster justify="center">
      <div style="padding: 0.5rem 1rem; background: var(--color-success-100); border-radius: 4px;">Centered</div>
      <div style="padding: 0.5rem 1rem; background: var(--color-success-100); border-radius: 4px;">Items</div>
    </Cluster>
  </div>
</Story>

<Story name="Cluster - Wrapping Tags">
  <div style="width: 300px; border: 1px dashed var(--color-border); padding: 1rem;">
    <Cluster gap="var(--space-2)">
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">JavaScript</div>
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">TypeScript</div>
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">Svelte</div>
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">React</div>
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">Vue</div>
      <div style="padding: 0.25rem 0.5rem; background: var(--color-neutral-100); border-radius: 999px; font-size: 0.75rem;">CSS</div>
    </Cluster>
  </div>
</Story>

<!-- PageContainer -->
<Story name="PageContainer">
  <div style="background: var(--color-neutral-100); padding: 1rem;">
    <PageContainer>
      <div style="background: var(--color-surface); padding: 2rem; border-radius: 8px; min-height: 200px;">
        <h2 style="color: var(--color-text);">Page Content</h2>
        <p style="color: var(--color-text-secondary);">This content is constrained by the PageContainer max-width.</p>
      </div>
    </PageContainer>
  </div>
</Story>

<!-- Combined Example -->
<Story name="Form Layout Example">
  <div style="max-width: 400px;">
    <Stack gap="var(--space-6)">
      <h3 style="color: var(--color-text); margin: 0;">Contact Form</h3>
      <Stack gap="var(--space-4)">
        <Stack gap="var(--space-1)">
          <label style="font-size: 0.875rem; font-weight: 500; color: var(--color-text);">Name</label>
          <input style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px;" placeholder="Your name" />
        </Stack>
        <Stack gap="var(--space-1)">
          <label style="font-size: 0.875rem; font-weight: 500; color: var(--color-text);">Email</label>
          <input type="email" style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px;" placeholder="you@example.com" />
        </Stack>
        <Stack gap="var(--space-1)">
          <label style="font-size: 0.875rem; font-weight: 500; color: var(--color-text);">Message</label>
          <textarea style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px; min-height: 100px;" placeholder="Your message"></textarea>
        </Stack>
      </Stack>
      <Cluster justify="flex-end" gap="var(--space-2)">
        <button style="padding: 0.5rem 1rem; background: transparent; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer;">Cancel</button>
        <button style="padding: 0.5rem 1rem; background: var(--color-primary-500); color: white; border: none; border-radius: 6px; cursor: pointer;">Send</button>
      </Cluster>
    </Stack>
  </div>
</Story>
