<script module>
  import { Pagination } from './';
</script>

<Story name="Default">
  <Template>
    <Pagination currentPage={1} totalPages={10} onPageChange={(p) => console.log(p)} />
  </Template>
</Story>

<Story name="Middle Page">
  <Template>
    <Pagination currentPage={5} totalPages={10} onPageChange={(p) => console.log(p)} />
  </Template>
</Story>

<Story name="Compact">
  <Template>
    <Pagination variant="compact" currentPage={3} totalPages={10} onPageChange={(p) => console.log(p)} />
  </Template>
</Story>

<Story name="Few Pages">
  <Template>
    <Pagination currentPage={2} totalPages={3} onPageChange={(p) => console.log(p)} />
  </Template>
</Story>
