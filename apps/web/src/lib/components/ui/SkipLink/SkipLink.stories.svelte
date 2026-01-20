<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { SkipLink } from './index';

  const { Story } = defineMeta({
    title: 'UI/SkipLink',
    component: SkipLink,
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  <div style="position: relative; min-height: 200px; padding: var(--space-4); border: 1px dashed var(--color-border);">
    <p style="margin-bottom: var(--space-2); color: var(--color-text-secondary);">
      Press Tab to reveal the skip link (centered at top):
    </p>
    <SkipLink />
    <div id="main-content" style="margin-top: var(--space-8);">
      <h2 style="color: var(--color-text);">Main Content</h2>
      <p style="color: var(--color-text);">This is the main content area that the skip link navigates to.</p>
    </div>
  </div>
</Story>

<Story name="Custom Label">
  <div style="position: relative; min-height: 200px; padding: var(--space-4); border: 1px dashed var(--color-border);">
    <p style="margin-bottom: var(--space-2); color: var(--color-text-secondary);">
      Press Tab to see custom skip link label:
    </p>
    <SkipLink href="#custom-section" label="Skip to custom section" />
    <div id="custom-section" style="margin-top: var(--space-8);">
      <h2 style="color: var(--color-text);">Custom Section</h2>
      <p style="color: var(--color-text);">The skip link can have custom text and target any element with an ID.</p>
    </div>
  </div>
</Story>
