<script lang="ts">
  import Tabs from './Tabs.svelte';
  import TabsContent from './TabsContent.svelte';
  import TabsList from './TabsList.svelte';
  import TabsTrigger from './TabsTrigger.svelte';

  interface Props {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string | undefined) => void;
    orientation?: 'horizontal' | 'vertical';
    listVariant?: 'underlined' | 'bare';
  }

  let {
    value = $bindable(),
    defaultValue = 'tab-1',
    onValueChange,
    orientation,
    listVariant,
  }: Props = $props();
</script>

<Tabs bind:value {defaultValue} {onValueChange} {orientation}>
  <TabsList variant={listVariant}>
    <TabsTrigger value="tab-1" data-testid="trigger-1">Tab One</TabsTrigger>
    <TabsTrigger value="tab-2" data-testid="trigger-2">Tab Two</TabsTrigger>
    <TabsTrigger value="tab-3" data-testid="trigger-3" disabled>Tab Three</TabsTrigger>
  </TabsList>
  <TabsContent value="tab-1" data-testid="panel-1">Panel One Content</TabsContent>
  <TabsContent value="tab-2" data-testid="panel-2">Panel Two Content</TabsContent>
  <TabsContent value="tab-3" data-testid="panel-3">Panel Three Content</TabsContent>
</Tabs>
