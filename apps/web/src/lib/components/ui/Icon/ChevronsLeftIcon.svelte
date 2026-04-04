<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<polyline points="11 17 6 12 11 7" />
	<polyline points="18 17 13 12 18 7" />
</IconBase>
