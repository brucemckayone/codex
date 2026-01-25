<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Avatar from './index';

  const { Story } = defineMeta({
    title: 'UI/Avatar',
    tags: ['autodocs'],
  });
</script>

<Story name="With Image">
  <Avatar.Root src="https://github.com/shadcn.png">
    <Avatar.Image alt="User avatar" />
    <Avatar.Fallback>CN</Avatar.Fallback>
  </Avatar.Root>
</Story>

<Story name="Fallback">
  <Avatar.Root src="/broken-image.jpg">
    <Avatar.Image alt="User avatar" />
    <Avatar.Fallback>JD</Avatar.Fallback>
  </Avatar.Root>
</Story>

<Story name="Initials Only">
  <Avatar.Root>
    <Avatar.Fallback>AB</Avatar.Fallback>
  </Avatar.Root>
</Story>

<Story name="Multiple Avatars">
  <div style="display: flex; gap: 0.5rem; align-items: center;">
    <Avatar.Root>
      <Avatar.Fallback>JD</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Fallback>AB</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Fallback>MK</Avatar.Fallback>
    </Avatar.Root>
    <Avatar.Root>
      <Avatar.Fallback>+5</Avatar.Fallback>
    </Avatar.Root>
  </div>
</Story>

<Story name="User List">
  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <Avatar.Root>
        <Avatar.Fallback>JD</Avatar.Fallback>
      </Avatar.Root>
      <div>
        <div style="font-weight: 500; color: var(--color-text);">John Doe</div>
        <div style="font-size: 0.875rem; color: var(--color-text-secondary);">john@example.com</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <Avatar.Root>
        <Avatar.Fallback>JS</Avatar.Fallback>
      </Avatar.Root>
      <div>
        <div style="font-weight: 500; color: var(--color-text);">Jane Smith</div>
        <div style="font-size: 0.875rem; color: var(--color-text-secondary);">jane@example.com</div>
      </div>
    </div>
  </div>
</Story>
