<!--
  Test harness: a listening card on a page whose context may ask for the
  full recording (`requestFilm`), as the Preview block lays it.
-->
<script lang="ts">
  import type { PreviewMedia } from '../../../render/types';
  import { DEFAULT_PAGE_STYLE } from '../../model/ids';
  import { type KitPageContext, setKitPage } from '../../page-context';
  import ListenCard from './ListenCard.svelte';

  interface Props {
    clip: PreviewMedia;
    full?: boolean;
    seconds?: number | null;
    requestFilm?: KitPageContext['requestFilm'];
  }

  const { clip, full = false, seconds = 30, requestFilm }: Props = $props();

  setKitPage({
    style: DEFAULT_PAGE_STYLE,
    still: false,
    offerProps: {},
    anchorOf: () => undefined,
    get requestFilm() {
      return requestFilm;
    },
  });
</script>

{#snippet line()}A 5-minute listen{/snippet}

<ListenCard {clip} title="Arriving" {full} {seconds} {line} />
