<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Pagination } from './';

  const { Story } = defineMeta({
    title: 'UI/Pagination',
    component: Pagination,
    tags: ['autodocs'],
    argTypes: {
      variant: {
        control: 'select',
        options: ['default', 'compact'],
        description: 'Display variant',
      },
    },
  });
</script>

<Story name="Default">
  <Pagination currentPage={1} totalPages={10} onPageChange={(p) => console.log(p)} />
</Story>

<Story name="Middle Page">
  <Pagination currentPage={5} totalPages={10} onPageChange={(p) => console.log(p)} />
</Story>

<Story name="Compact">
  <Pagination variant="compact" currentPage={3} totalPages={10} onPageChange={(p) => console.log(p)} />
</Story>

<Story name="Few Pages">
  <Pagination currentPage={2} totalPages={3} onPageChange={(p) => console.log(p)} />
</Story>

<Story name="First Page">
  <Pagination currentPage={1} totalPages={5} onPageChange={(p) => console.log(p)} />
</Story>

<Story name="Last Page">
  <Pagination currentPage={10} totalPages={10} onPageChange={(p) => console.log(p)} />
</Story>
