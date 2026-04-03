<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="12" cy="12" r="10" />
	<polyline points="12 6 12 12 16 14" />
</IconBase>
