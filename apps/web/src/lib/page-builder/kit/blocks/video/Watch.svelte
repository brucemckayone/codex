<!--
  @component Watch

  A clip's play button and the shared player it opens — the HeroBlock pattern.
  On the canvas the button is drawn but plays nothing: a click there belongs
  to the editor.
-->
<script lang="ts">
  import IntroVideoModal from '$lib/components/ui/IntroVideoModal/IntroVideoModal.svelte';
  import type { PreviewMedia } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import WatchButton from '../../primitives/WatchButton.svelte';

  interface Props {
    clip: PreviewMedia;
    label: string;
    /** The player's accessible title. */
    title: string;
    edit?: BlockEdit | null;
  }

  const { clip, label, title, edit = null }: Props = $props();

  let open = $state(false);

  function play() {
    if (!edit) open = true;
  }
</script>

<WatchButton {label} onclick={play} />
{#if open}
  <IntroVideoModal
    open={true}
    src={clip.playlistUrl}
    {title}
    onclose={() => (open = false)}
  />
{/if}
