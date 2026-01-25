<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Badge } from './index';

  const { Story } = defineMeta({
    title: 'UI/Badge',
    component: Badge,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['neutral', 'success', 'warning', 'error'],
        description: 'Badge color variant',
      },
    },
  });
</script>

<Story name="Neutral" args={{ variant: 'neutral' }}>
  <Badge variant="neutral">Neutral</Badge>
</Story>

<Story name="Success" args={{ variant: 'success' }}>
  <Badge variant="success">Success</Badge>
</Story>

<Story name="Warning" args={{ variant: 'warning' }}>
  <Badge variant="warning">Warning</Badge>
</Story>

<Story name="Error" args={{ variant: 'error' }}>
  <Badge variant="error">Error</Badge>
</Story>

<Story name="All Variants">
  <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
    <Badge variant="neutral">Neutral</Badge>
    <Badge variant="success">Success</Badge>
    <Badge variant="warning">Warning</Badge>
    <Badge variant="error">Error</Badge>
  </div>
</Story>

<Story name="Status Examples">
  <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
    <Badge variant="success">Published</Badge>
    <Badge variant="warning">Draft</Badge>
    <Badge variant="error">Failed</Badge>
    <Badge variant="neutral">Archived</Badge>
  </div>
</Story>
