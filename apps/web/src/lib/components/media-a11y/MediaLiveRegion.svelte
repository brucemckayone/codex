<!--
  @component MediaLiveRegion

  Accessible live-region primitive for media player loading + error states.
  Implements the Ref 05 §"Media elements" §4 contract:

  - Outer wrapper uses role="status" + aria-live="polite" + aria-busy={loading}
    so assistive tech announces loading transitions without interrupting.
  - Error text uses nested role="alert" (implicit aria-live="assertive") so
    errors escalate without breaking the outer polite context.

  Loading + error messages are rendered in `.sr-only` children by default;
  consumers can supply visible chrome via the {@render children()} snippet
  (e.g. AlertCircleIcon + Retry button). The live region wrapper is always
  present in the DOM so AT has a stable landmark.

  @prop {boolean} [loading=false] - When true, announces loadingLabel and flips aria-busy.
  @prop {string | null} [error=null] - When set, announces via nested role="alert".
  @prop {string} [loadingLabel="Loading media…"] - Text announced during load.
  @prop {Snippet} [children] - Optional visible chrome rendered alongside the SR text.
  @prop {string} [class] - Forward an additional class onto the wrapper (R13).

  @example
    <MediaLiveRegion {loading} error={errorMessage} loadingLabel="Loading audio…">
      {#if errorMessage}
        <AlertCircleIcon /> <button onclick={retry}>Try Again</button>
      {/if}
    </MediaLiveRegion>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		loading?: boolean;
		error?: string | null;
		loadingLabel?: string;
		children?: Snippet;
		/** Forwarded onto the wrapper root. R13: callers can style/position this landmark. */
		class?: string;
	}

	const {
		loading = false,
		error = null,
		loadingLabel = 'Loading media…',
		children,
		class: className,
	}: Props = $props();
</script>

<div
	class="media-live-region {className ?? ''}"
	role="status"
	aria-live="polite"
	aria-busy={loading}
>
	{#if loading && !error}
		<span class="sr-only">{loadingLabel}</span>
	{/if}

	{#if error}
		<span class="sr-only" role="alert">{error}</span>
	{/if}

	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.media-live-region {
		/* No intrinsic styling — positioning is the consumer's responsibility. */
		display: contents;
	}
</style>
