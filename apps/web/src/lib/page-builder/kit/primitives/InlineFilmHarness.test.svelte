<!--
  Test harness: films on a page whose context may ask for the full film
  (`requestFilm`), each in a ClipFrame as the film blocks draw them.
-->
<script lang="ts">
  import type { PreviewMedia, SalesFilm } from '../../render/types';
  import ClipFrame from '../blocks/video/ClipFrame.svelte';
  import { DEFAULT_PAGE_STYLE } from '../model/ids';
  import type { BlockEdit } from '../model/types';
  import { type KitPageContext, setKitPage } from '../page-context';
  import InlineFilm from './InlineFilm.svelte';

  interface Props {
    clips: PreviewMedia[];
    film?: SalesFilm;
    requestFilm?: KitPageContext['requestFilm'];
    edit?: BlockEdit | null;
  }

  const { clips, film, requestFilm, edit = null }: Props = $props();

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

{#each clips as clip, index (index)}
  <InlineFilm {clip} {film} label="Watch film {index + 1}" title="Film {index + 1}" {edit}>
    {#snippet children(control, player)}
      <ClipFrame still={clip.posterUrl} ratio="16 / 9" {player}>{@render control()}</ClipFrame>
    {/snippet}
  </InlineFilm>
{/each}
