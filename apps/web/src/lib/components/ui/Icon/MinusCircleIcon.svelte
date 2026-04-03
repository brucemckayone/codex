<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="12" cy="12" r="10" />
	<line x1="8" y1="12" x2="16" y2="12" />
</IconBase>
