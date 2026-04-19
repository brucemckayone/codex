<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';

	interface Props extends IconProps {
		/** `active` renders the condensed/tighter rectangle (cinema mode ON). Default = wider "off" rectangle. */
		active?: boolean;
	}

	const { size, active = false, ...restProps }: Props = $props();
</script>

<IconBase {size} {...restProps}>
	{#if active}
		<rect x="4" y="6" width="16" height="12" rx="2" />
	{:else}
		<rect x="2" y="7" width="20" height="10" rx="2" />
	{/if}
</IconBase>
