<!--
  A stand-in for PreviewPlayerCore in ReelTheatre's tests: the core's
  `<video>` and its three exports. What it was given, and the clock the
  test drives, live in `theatre-core-stub.svelte.ts`.
-->
<script lang="ts">
  import type { PlayerClock } from '$lib/components/player/timeline';
  import { core, type SeenProps, seen } from './theatre-core-stub.svelte';

  const props: SeenProps = $props();
  seen.read = () => props;

  let video: HTMLVideoElement | undefined = $state();

  export function toggle() {
    core.toggles += 1;
    core.clock = { ...core.clock, offerPlay: !core.clock.offerPlay };
  }

  export function toggleMute() {
    core.mutes += 1;
    if (video) {
      video.muted = !video.muted;
      video.dispatchEvent(new Event('volumechange'));
    }
  }

  export function clock(): PlayerClock {
    return core.clock;
  }
</script>

<video class="stub-core" data-fit={props.fit} bind:this={video}><track kind="captions" /></video>
