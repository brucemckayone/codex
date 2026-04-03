<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<line x1="19" y1="12" x2="5" y2="12" />
	<polyline points="12 19 5 12 12 5" />
</IconBase>
