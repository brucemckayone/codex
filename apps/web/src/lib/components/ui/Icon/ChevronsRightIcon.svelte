<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<polyline points="13 17 18 12 13 7" />
	<polyline points="6 17 11 12 6 7" />
</IconBase>
