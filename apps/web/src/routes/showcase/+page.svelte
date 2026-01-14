<script lang="ts">
  import {
    Avatar, Badge, Button, Card, Checkbox, Dialog, ErrorBanner, Input, Label, Select, Skeleton,
    Switch, Table, TextArea, toast 
  } from '$lib/components/ui';

  const switchState = $state(false);
  const checkboxState = $state(false);
  const dialogState = $state({ open: false });
  const textareaValue = $state('Initial value');
  const selectedValue = $state('option1');

  const selectOptions = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];
</script>

<div class="showcase-container">
  <h1>Design System Showcase</h1>
  <p class="subtitle">Phase 1 Foundation 2 Components</p>

  <section>
    <h2>Feedback & Layout</h2>
    <div class="space-y-4">
      <ErrorBanner
        title="Failed to sync data"
        description="Please check your internet connection and try again."
      >
        <Button variant="secondary" size="sm">Retry</Button>
      </ErrorBanner>
    </div>
  </section>

  <section>
    <h2>Buttons & Actions</h2>
    <div class="flex-row">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
    <div class="flex-row">
      <Button size="xs">Extra Small</Button>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Extra Large</Button>
    </div>
  </section>

  <section>
    <h2>Forms & Primitives</h2>
    <div class="form-grid">
      <div class="form-group">
        <Label for="username">Input Field</Label>
        <Input id="username" placeholder="@username" />
      </div>

      <div class="form-group">
        <Label for="bio">TextArea (Auto-resize)</Label>
        <TextArea id="bio" bind:value={textareaValue} placeholder="Tell us about yourself..." />
      </div>

      <div class="form-group">
        <Select
          label="Select Option"
          options={selectOptions}
          bind:value={selectedValue}
        />
      </div>

      <div class="flex-row align-center">
        <Checkbox id="terms" bind:checked={checkboxState} label="Accept terms and conditions" />
      </div>

      <div class="flex-row align-center">
        <Switch id="mode" bind:checked={switchState} />
        <Label for="mode">Airplane Mode ({switchState ? 'On' : 'Off'})</Label>
      </div>
    </div>
  </section>

  <section>
    <h2>Dialog</h2>
    <Button variant="secondary" onclick={() => dialogState.open = true}>Open Modal Dialog</Button>

    <Dialog.Root bind:open={dialogState.open}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Confirm Action</Dialog.Title>
          <Dialog.Description>Are you sure you want to proceed? This action cannot be undone.</Dialog.Description>
        </Dialog.Header>

        <p>Some additional context for the user goes here.</p>

        <Dialog.Footer>
          <Button variant="ghost" onclick={() => dialogState.open = false}>Cancel</Button>
          <Button variant="primary" onclick={() => dialogState.open = false}>Confirm</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </section>

  <section>
    <h2>Badges</h2>
    <div class="flex-row">
      <Badge variant="neutral">Beta</Badge>
      <Badge variant="success">Active</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="error">Critical</Badge>
    </div>
  </section>

  <section>
    <h2>Cards</h2>
    <Card.Root>
      <Card.Header>
        <Card.Title>Featured Project</Card.Title>
        <Card.Description>A brief overview of what this card represents.</Card.Description>
      </Card.Header>
      <Card.Content>
        <p>This card utilizes the semantic surface and border tokens for consistency across themes.</p>
      </Card.Content>
      <Card.Footer>
        <Button variant="ghost" size="sm">View Details</Button>
      </Card.Footer>
    </Card.Root>
  </section>

  <section>
    <h2>Toasts</h2>
    <div class="flex-row">
      <Button variant="ghost" onclick={() => toast.success('Operation Successful', 'Your changes have been saved.')}>Trigger Success</Button>
      <Button variant="ghost" onclick={() => toast.error('Save Failed', 'Could not reach the server.')}>Trigger Error</Button>
    </div>
  </section>

  <section>
    <h2>Data Visualisation</h2>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Name</Table.Head>
          <Table.Head>Role</Table.Head>
          <Table.Head>Status</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell>Bruce McKay</Table.Cell>
          <Table.Cell>Lead Engineer</Table.Cell>
          <Table.Cell><Badge variant="success">Active</Badge></Table.Cell>
        </Table.Row>
        <Table.Row>
          <Table.Cell>Sarah Chen</Table.Cell>
          <Table.Cell>Product Designer</Table.Cell>
          <Table.Cell><Badge variant="warning">Away</Badge></Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  </section>

  <section>
    <h2>Avatar & Loading</h2>
    <div class="flex-row align-center">
      <Avatar.Root>
        <Avatar.Image src="https://github.com/shadcn.png" alt="@shadcn" />
        <Avatar.Fallback>CN</Avatar.Fallback>
      </Avatar.Root>
      <Avatar.Root>
        <Avatar.Fallback>BM</Avatar.Fallback>
      </Avatar.Root>
      <Skeleton style="width: 120px; height: 16px; border-radius: 4px;" />
      <Skeleton style="width: 40px; height: 40px; border-radius: 999px;" />
    </div>
  </section>
</div>

<style>
  .showcase-container {
    padding-bottom: var(--space-20);
  }

  h1 {
    font-size: var(--text-4xl);
    margin-bottom: var(--space-2);
  }

  .subtitle {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-10);
  }

  section {
    margin-bottom: var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  h2 {
    font-size: var(--text-2xl);
    border-bottom: 1px solid var(--color-border);
    padding-bottom: var(--space-2);
  }

  .flex-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .align-center {
    align-items: center;
  }

  .space-y-4 > :global(*) + :global(*) {
    margin-top: var(--space-4);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
    max-width: 600px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
