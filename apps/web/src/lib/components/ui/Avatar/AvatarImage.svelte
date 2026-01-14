<script lang="ts">
  import { type createAvatar, melt } from '@melt-ui/svelte';
  import { getContext } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';

  interface Props extends HTMLImgAttributes {}

  const { class: className, ...restProps }: Props = $props();
  const { elements: { image } } = getContext<ReturnType<typeof createAvatar>>('AVATAR');
</script>

<img
  use:melt={$image}
  class="avatar-image {className ?? ''}"
  {...restProps}
  alt={restProps.alt || ""}
/>

<style>
  .avatar-image {
    aspect-ratio: 1 / 1;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }
</style>
