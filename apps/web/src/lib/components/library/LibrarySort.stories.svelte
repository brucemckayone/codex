<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LibrarySort from './LibrarySort.svelte';

	const { Story } = defineMeta({
		title: 'Library/LibrarySort',
		component: LibrarySort,
		tags: ['autodocs'],
		argTypes: {
			value: {
				control: 'select',
				options: ['recently-watched', 'recently-added', 'title-asc', 'title-desc'],
				description: 'Current sort value'
			}
		}
	});
</script>

<!-- Default State -->
<Story name="Default">
	<LibrarySort
		onChange={(value) => console.log('Sort:', value)}
	/>
</Story>

<!-- Recently Watched -->
<Story name="Recently Watched">
	<LibrarySort
		value="recently-watched"
		onChange={(value) => console.log('Sort:', value)}
	/>
</Story>

<!-- Alphabetical -->
<Story name="Alphabetical">
	<LibrarySort
		value="title-asc"
		onChange={(value) => console.log('Sort:', value)}
	/>
</Story>
