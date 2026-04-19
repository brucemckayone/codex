<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';

	interface Props extends IconProps {
		/**
		 * Visual volume state:
		 * - `high` — speaker body + both sound-wave arcs
		 * - `low`  — speaker body + inner (short) sound-wave arc only
		 * - `mute` — speaker body + X marks crossing out the waves
		 *
		 * Render the appropriate set of shapes; swapping the prop triggers a
		 * normal re-render (no morph). Consumers that need the VideoPlayer's
		 * Disney-style animated wave transitions keep inline SVG and rely on
		 * per-path opacity/transform — this icon is for static consumption.
		 */
		state?: 'high' | 'low' | 'mute';
	}

	const { size, state = 'high', ...restProps }: Props = $props();
</script>

<IconBase {size} {...restProps}>
	<!-- Speaker body — always present -->
	<polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="currentColor" />

	{#if state === 'low'}
		<!-- Inner arc only -->
		<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
	{:else if state === 'high'}
		<!-- Inner + outer arcs -->
		<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
		<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
	{:else}
		<!-- Mute: crossed-out waves -->
		<line x1="23" y1="9" x2="17" y2="15" />
		<line x1="17" y1="9" x2="23" y2="15" />
	{/if}
</IconBase>
