<script lang="ts">
	import type { IconProps } from './types';
	import IconBase from './IconBase.svelte';
	const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
	<circle cx="9" cy="12" r="1" />
	<circle cx="9" cy="5" r="1" />
	<circle cx="9" cy="19" r="1" />
	<circle cx="15" cy="12" r="1" />
	<circle cx="15" cy="5" r="1" />
	<circle cx="15" cy="19" r="1" />
</IconBase>
