<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Badge } from '../Badge/index';
  import * as Table from './index';

  const { Story } = defineMeta({
    title: 'UI/Table',
    tags: ['autodocs'],
  });

  const invoices = [
    { id: 'INV001', status: 'Paid', method: 'Credit Card', amount: '$250.00' },
    { id: 'INV002', status: 'Pending', method: 'PayPal', amount: '$150.00' },
    { id: 'INV003', status: 'Unpaid', method: 'Bank Transfer', amount: '$350.00' },
    { id: 'INV004', status: 'Paid', method: 'Credit Card', amount: '$450.00' },
    { id: 'INV005', status: 'Paid', method: 'PayPal', amount: '$550.00' },
  ];

  const users = [
    { name: 'John Doe', email: 'john@example.com', role: 'Admin' },
    { name: 'Jane Smith', email: 'jane@example.com', role: 'Editor' },
    { name: 'Bob Johnson', email: 'bob@example.com', role: 'Viewer' },
  ];
</script>

<Story name="Default">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Invoice</Table.Head>
        <Table.Head>Status</Table.Head>
        <Table.Head>Method</Table.Head>
        <Table.Head>Amount</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each invoices as invoice}
        <Table.Row>
          <Table.Cell>{invoice.id}</Table.Cell>
          <Table.Cell>{invoice.status}</Table.Cell>
          <Table.Cell>{invoice.method}</Table.Cell>
          <Table.Cell>{invoice.amount}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</Story>

<Story name="With Badges">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Invoice</Table.Head>
        <Table.Head>Status</Table.Head>
        <Table.Head>Method</Table.Head>
        <Table.Head style="text-align: right;">Amount</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each invoices as invoice}
        <Table.Row>
          <Table.Cell style="font-weight: 500;">{invoice.id}</Table.Cell>
          <Table.Cell>
            <Badge variant={invoice.status === 'Paid' ? 'success' : invoice.status === 'Pending' ? 'warning' : 'error'}>
              {invoice.status}
            </Badge>
          </Table.Cell>
          <Table.Cell>{invoice.method}</Table.Cell>
          <Table.Cell style="text-align: right;">{invoice.amount}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
    <Table.Footer>
      <Table.Row>
        <Table.Cell colspan="3">Total</Table.Cell>
        <Table.Cell style="text-align: right; font-weight: 600;">$1,750.00</Table.Cell>
      </Table.Row>
    </Table.Footer>
  </Table.Root>
</Story>

<Story name="User Table">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>Name</Table.Head>
        <Table.Head>Email</Table.Head>
        <Table.Head>Role</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each users as user}
        <Table.Row>
          <Table.Cell style="font-weight: 500;">{user.name}</Table.Cell>
          <Table.Cell style="color: var(--color-text-secondary);">{user.email}</Table.Cell>
          <Table.Cell>
            <Badge variant="neutral">{user.role}</Badge>
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</Story>
