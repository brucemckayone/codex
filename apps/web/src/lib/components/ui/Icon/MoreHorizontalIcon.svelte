<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="12" cy="12" r="1" />
	<circle cx="19" cy="12" r="1" />
	<circle cx="5" cy="12" r="1" />
</IconBase>
