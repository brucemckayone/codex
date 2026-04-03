<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
	<polyline points="22 4 12 14.01 9 11.01" />
</IconBase>
