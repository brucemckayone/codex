<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="12" cy="12" r="10" />
	<line x1="12" y1="8" x2="12" y2="12" />
	<line x1="12" y1="16" x2="12.01" y2="16" />
</IconBase>
