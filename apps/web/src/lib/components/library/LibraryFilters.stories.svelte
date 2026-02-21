<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LibraryFilters from './LibraryFilters.svelte';

	const { Story } = defineMeta({
		title: 'Library/LibraryFilters',
		component: LibraryFilters,
		tags: ['autodocs'],
		argTypes: {
			selectedTypes: {
				control: 'array',
				description: 'Selected content type filters'
			},
			selectedStatus: {
				control: 'array',
				description: 'Selected progress status filters'
			}
		}
	});
</script>

<!-- Default State -->
<Story name="Default">
	<LibraryFilters
		onTypesChange={(types) => console.log('Types:', types)}
		onStatusChange={(statuses) => console.log('Status:', statuses)}
		onClearAll={() => console.log('Clear all')}
	/>
</Story>

<!-- With Active Filters -->
<Story name="With Active Filters">
	<LibraryFilters
		selectedTypes={['video']}
		selectedStatus={['in_progress']}
		onTypesChange={(types) => console.log('Types:', types)}
		onStatusChange={(statuses) => console.log('Status:', statuses)}
		onClearAll={() => console.log('Clear all')}
	/>
</Story>

<!-- Multiple Filters -->
<Story name="Multiple Filters">
	<LibraryFilters
		selectedTypes={['video', 'written']}
		selectedStatus={['in_progress', 'completed']}
		onTypesChange={(types) => console.log('Types:', types)}
		onStatusChange={(statuses) => console.log('Status:', statuses)}
		onClearAll={() => console.log('Clear all')}
	/>
</Story>
