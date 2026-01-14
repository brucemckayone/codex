<script lang="ts">
  import * as Avatar from '$lib/components/ui/Avatar';
  import { Badge } from '$lib/components/ui/Badge';
  import { Button } from '$lib/components/ui/Button';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Input } from '$lib/components/ui/Input';
  import { Label } from '$lib/components/ui/Label';
  import { Skeleton } from '$lib/components/ui/Skeleton';
  import { Switch } from '$lib/components/ui/Switch';
  import * as Table from '$lib/components/ui/Table';
  import { toast } from '$lib/components/ui/Toast';

  const switchState = $state(false);
  const dialogState = $state({ open: false });
</script>

<div class="p-8 space-y-8 container mx-auto" style="padding: var(--space-8); max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-8);">

  <section>
    <h2>Buttons</h2>
    <div style="display: flex; gap: var(--space-4);">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  </section>

  <section>
    <h2>Badges</h2>
    <div style="display: flex; gap: var(--space-4);">
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
    </div>
  </section>

  <section>
    <h2>Card</h2>
    <Card.Root>
      <Card.Header>
        <Card.Title>Card Title</Card.Title>
        <Card.Description>Card Description goes here.</Card.Description>
      </Card.Header>
      <Card.Content>
        <p>This is the main content of the card.</p>
      </Card.Content>
      <Card.Footer>
        <Button>Action</Button>
      </Card.Footer>
    </Card.Root>
  </section>

  <section>
    <h2>Avatar & Skeleton</h2>
    <div style="display: flex; gap: var(--space-4); align-items: center;">
      <Avatar.Root>
        <Avatar.Image src="https://github.com/shadcn.png" alt="@shadcn" />
        <Avatar.Fallback>CN</Avatar.Fallback>
      </Avatar.Root>

      <Avatar.Root>
        <Avatar.Fallback>BM</Avatar.Fallback>
      </Avatar.Root>

      <Skeleton style="width: 100px; height: 40px;" />
      <Skeleton style="width: 40px; height: 40px; border-radius: 999px;" />
    </div>
  </section>

  <section>
    <h2>Table</h2>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Name</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head>Role</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell>Alice</Table.Cell>
          <Table.Cell>Active</Table.Cell>
          <Table.Cell>Admin</Table.Cell>
        </Table.Row>
        <Table.Row>
          <Table.Cell>Bob</Table.Cell>
          <Table.Cell>Inactive</Table.Cell>
          <Table.Cell>User</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  </section>

  <section>
    <h2>Dialog</h2>
    <Button onclick={() => dialogState.open = true}>Open Dialog</Button>

    <Dialog.Root bind:open={dialogState.open}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Edit Profile</Dialog.Title>
          <Dialog.Description>Make changes to your profile here.</Dialog.Description>
        </Dialog.Header>

        <div style="display: flex; flex-direction: column; gap: var(--space-4); margin: var(--space-4) 0;">
          <Label for="username">Username</Label>
          <Input id="username" placeholder="@username" />
        </div>

        <Dialog.Footer>
          <Button variant="secondary" onclick={() => dialogState.open = false}>Cancel</Button>
          <Button onclick={() => dialogState.open = false}>Save changes</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </section>

  <section>
    <h2>Toast</h2>
    <div style="display: flex; gap: var(--space-4);">
      <Button onclick={() => toast.success({ title: 'Success', description: 'Operation completed.' })}>Success Toast</Button>
      <Button onclick={() => toast.error({ title: 'Error', description: 'Something went wrong.' })}>Error Toast</Button>
    </div>
  </section>

  <section>
    <h2>Switch</h2>
    <div style="display: flex; align-items: center; gap: var(--space-2);">
      <Switch bind:checked={switchState} id="mode" />
      <Label for="mode">Airplane Mode</Label>
    </div>
  </section>

</div>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
</style>
