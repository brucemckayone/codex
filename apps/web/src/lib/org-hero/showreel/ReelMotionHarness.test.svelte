<!--
  ReelMotionHarness: calls `useReelMotion` as the Showreel does, once at
  init, on live props, so a test can drive the hook's effects (a pick, a
  pause, a refresh, the film, the pointer) and read the piece the stage
  shows from `data-stage`. Test-only (Codex-1yd58.7, WP-6).
-->
<script lang="ts">
  import type { FilmFrameId } from '$lib/components/ui/ShaderHero/compositor/effects/ids';
  import type { MotionSettings } from './reel-motion';
  import { useReelMotion } from './reel-motion.svelte';

  interface Props {
    options: MotionSettings;
    frame: FilmFrameId;
    keys: string[];
    index: number;
    paused: boolean;
    moves: boolean;
    phone: boolean;
    reducedMotion: boolean;
    filmPlaying: boolean;
  }

  const props: Props = $props();

  let rootEl: HTMLElement | undefined = $state();

  const motion = useReelMotion({
    options: () => props.options,
    frame: () => props.frame,
    root: () => rootEl,
    keys: () => props.keys,
    index: () => props.index,
    paused: () => props.paused,
    moves: () => props.moves,
    phone: () => props.phone,
    reducedMotion: () => props.reducedMotion,
    filmPlaying: () => props.filmPlaying,
  });

  /** The entry the stage shows, by key, in the reel as this render has it. */
  const stageKey = $derived.by(() => {
    const at = motion.stage;
    return at === null ? 'none' : (props.keys[at] ?? 'none');
  });
</script>

<div class="harness" bind:this={rootEl} data-stage={motion.stage ?? 'none'} data-stage-key={stageKey}></div>
