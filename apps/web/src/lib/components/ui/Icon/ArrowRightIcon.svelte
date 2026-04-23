<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<line x1="5" y1="12" x2="19" y2="12" />
	<polyline points="12 5 19 12 12 19" />
</IconBase>
