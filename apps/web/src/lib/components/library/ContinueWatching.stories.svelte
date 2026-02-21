<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContinueWatching from './ContinueWatching.svelte';

	const { Story } = defineMeta({
		title: 'Library/ContinueWatching',
		component: ContinueWatching,
		tags: ['autodocs'],
		argTypes: {
			limit: {
				control: 'number',
				description: 'Maximum items to display'
			}
		}
	});

	const mockItems = [
		{
			content: {
				id: '1',
				title: 'Introduction to Svelte 5',
				description: 'Learn the basics of Svelte 5 runes',
				thumbnailUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=400&h=225&fit=crop',
				contentType: 'video',
				durationSeconds: 1800
			},
			progress: {
				positionSeconds: 900,
				durationSeconds: 1800,
				completed: false,
				percentComplete: 50,
				updatedAt: new Date(Date.now() - 3600000).toISOString()
			}
		},
		{
			content: {
				id: '2',
				title: 'Advanced TypeScript Patterns',
				description: 'Deep dive into TypeScript generics',
				thumbnailUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=400&h=225&fit=crop',
				contentType: 'video',
				durationSeconds: 2400
			},
			progress: {
				positionSeconds: 1800,
				durationSeconds: 2400,
				completed: false,
				percentComplete: 75,
				updatedAt: new Date(Date.now() - 7200000).toISOString()
			}
		},
		{
			content: {
				id: '3',
				title: 'Building REST APIs with Hono',
				description: 'Create fast APIs with Hono on Cloudflare Workers',
				thumbnailUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&h=225&fit=crop',
				contentType: 'video',
				durationSeconds: 1500
			},
			progress: {
				positionSeconds: 300,
				durationSeconds: 1500,
				completed: false,
				percentComplete: 20,
				updatedAt: new Date(Date.now() - 86400000).toISOString()
			}
		}
	];
</script>

<!-- Default State -->
<Story name="Default">
	<ContinueWatching items={mockItems} />
</Story>

<!-- Custom Limit -->
<Story name="Limit 2">
	<ContinueWatching items={mockItems} limit={2} />
</Story>

<!-- Empty State -->
<Story name="Empty">
	<ContinueWatching items={[]} />
</Story>
