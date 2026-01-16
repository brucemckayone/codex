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
  <div style="position: relative; min-height: 200px;">
    <p style="color: var(--color-text-secondary); margin-bottom: 1rem;">Press Tab to reveal the skip link:</p>
    <SkipLink />
    <main id="main-content" style="padding: 1rem; background: var(--color-surface-secondary); border-radius: 8px;">
      <h2 style="color: var(--color-text);">Main Content</h2>
      <p style="color: var(--color-text);">This is the main content area that the skip link targets.</p>
    </main>
  </div>
</Story>

<Story name="Custom Target">
  <div style="position: relative; min-height: 200px;">
    <p style="color: var(--color-text-secondary); margin-bottom: 1rem;">Press Tab to reveal the skip link:</p>
    <SkipLink href="#custom-content" label="Skip to custom section" />
    <div style="height: 100px; background: var(--color-neutral-100); margin-bottom: 1rem; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary);">
      Navigation area (skipped)
    </div>
    <section id="custom-content" style="padding: 1rem; background: var(--color-surface-secondary); border-radius: 8px;">
      <h2 style="color: var(--color-text);">Custom Section</h2>
      <p style="color: var(--color-text);">This is a custom section targeted by the skip link.</p>
    </section>
  </div>
</Story>
