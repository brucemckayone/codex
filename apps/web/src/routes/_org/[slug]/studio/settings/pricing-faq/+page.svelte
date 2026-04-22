<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { EmptyState } from '$lib/components/ui';
  import {
    PlusIcon,
    TrashIcon,
    EditIcon,
    ChevronUpIcon,
    ChevronDownIcon,
  } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getPricingFaq, updatePricingFaq } from '$lib/remote/branding.remote';
  import type { PricingFaqItem } from '@codex/validation';

  let { data } = $props();

  let items = $state<PricingFaqItem[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let hasChanges = $state(false);

  // Edit dialog state
  let editOpen = $state(false);
  let editItem = $state<PricingFaqItem | null>(null);
  let editQuestion = $state('');
  let editAnswer = $state('');

  onMount(async () => {
    try {
      const result = await getPricingFaq(data.org.id);
      if (result && Array.isArray(result) && result.length > 0) {
        items = (result as PricingFaqItem[]).sort((a, b) => a.order - b.order);
      }
    } catch {
      toast.error('Failed to load FAQ');
    } finally {
      loading = false;
    }
  });

  function addItem() {
    editItem = null;
    editQuestion = '';
    editAnswer = '';
    editOpen = true;
  }

  function editExisting(item: PricingFaqItem) {
    editItem = item;
    editQuestion = item.question;
    editAnswer = item.answer;
    editOpen = true;
  }

  function saveEdit() {
    if (!editQuestion.trim() || !editAnswer.trim()) return;

    if (editItem) {
      items = items.map((i) =>
        i.id === editItem!.id
          ? { ...i, question: editQuestion.trim(), answer: editAnswer.trim() }
          : i
      );
    } else {
      items = [
        ...items,
        {
          id: crypto.randomUUID(),
          question: editQuestion.trim(),
          answer: editAnswer.trim(),
          order: items.length,
        },
      ];
    }

    editOpen = false;
    hasChanges = true;
  }

  function deleteItem(id: string) {
    items = items
      .filter((i) => i.id !== id)
      .map((i, idx) => ({ ...i, order: idx }));
    hasChanges = true;
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const copy = [...items];
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
    items = copy.map((i, idx) => ({ ...i, order: idx }));
    hasChanges = true;
  }

  function moveDown(index: number) {
    if (index >= items.length - 1) return;
    const copy = [...items];
    [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
    items = copy.map((i, idx) => ({ ...i, order: idx }));
    hasChanges = true;
  }

  async function handleSave() {
    saving = true;
    try {
      await updatePricingFaq({
        orgId: data.org.id,
        pricingFaq: items.length > 0 ? JSON.stringify(items) : null,
      });
      hasChanges = false;
      toast.success('Pricing FAQ saved');
    } catch {
      toast.error('Failed to save FAQ');
    } finally {
      saving = false;
    }
  }
</script>

<div class="faq-editor">
  <div class="faq-editor-header">
    <h2>Pricing FAQ</h2>
    {#if items.length > 0}
      <Button variant="secondary" size="sm" onclick={addItem}>
        <PlusIcon size={14} />
        Add Item
      </Button>
    {/if}
  </div>

  {#if loading}
    <div class="faq-loading">
      {#each Array(3) as _}
        <div class="faq-item-skeleton">
          <div class="skeleton skeleton--text"></div>
          <div class="skeleton skeleton--text-sm"></div>
        </div>
      {/each}
    </div>
  {:else if items.length === 0}
    <EmptyState
      title="No FAQ items yet"
      description="Add frequently asked questions to help visitors on your pricing page."
    >
      {#snippet action()}
        <Button onclick={addItem}>
          <PlusIcon size={14} />
          Add your first FAQ
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="faq-list">
      {#each items as item, index (item.id)}
        <div class="faq-item">
          <div class="faq-item-content">
            <p class="faq-item-question">{item.question}</p>
            <p class="faq-item-answer">{item.answer}</p>
          </div>
          <div class="faq-item-actions">
            <button
              class="icon-btn"
              onclick={() => moveUp(index)}
              disabled={index === 0}
              aria-label="Move up"
            >
              <ChevronUpIcon size={14} />
            </button>
            <button
              class="icon-btn"
              onclick={() => moveDown(index)}
              disabled={index === items.length - 1}
              aria-label="Move down"
            >
              <ChevronDownIcon size={14} />
            </button>
            <button
              class="icon-btn"
              onclick={() => editExisting(item)}
              aria-label="Edit"
            >
              <EditIcon size={14} />
            </button>
            <button
              class="icon-btn icon-btn--danger"
              onclick={() => deleteItem(item.id)}
              aria-label="Delete"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if hasChanges}
      <div class="save-bar">
        <Button onclick={handleSave} loading={saving}>
          Save Changes
        </Button>
      </div>
    {/if}
  {/if}
</div>

<!-- Edit/Add Dialog -->
<Dialog.Root bind:open={editOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {editItem ? 'Edit FAQ Item' : 'Add FAQ Item'}
      </Dialog.Title>
    </Dialog.Header>

    <div class="faq-edit-form">
      <div class="field">
        <Label for="faq-question">Question</Label>
        <Input
          id="faq-question"
          bind:value={editQuestion}
          placeholder="e.g., Can I cancel anytime?"
          maxlength={200}
          required
        />
        <span class="char-count">{editQuestion.length}/200</span>
      </div>

      <div class="field">
        <Label for="faq-answer">Answer</Label>
        <TextArea
          id="faq-answer"
          bind:value={editAnswer}
          placeholder="Write a helpful answer..."
          rows={4}
          maxlength={2000}
        />
        <span class="char-count">{editAnswer.length}/2000</span>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={() => { editOpen = false; }}>
        Cancel
      </Button>
      <Button
        onclick={saveEdit}
        disabled={!editQuestion.trim() || !editAnswer.trim()}
      >
        {editItem ? 'Update' : 'Add'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .faq-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .faq-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .faq-editor-header h2 {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .faq-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
  }

  .faq-item-content {
    flex: 1;
    min-width: 0;
  }

  .faq-item-question {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .faq-item-answer {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: var(--space-1) 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .faq-item-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .icon-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .icon-btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  .icon-btn--danger:hover:not(:disabled) {
    color: var(--color-error-600);
    background-color: var(--color-error-50);
  }

  .faq-edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .char-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-align: right;
  }

  .save-bar {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  /* Loading skeleton */
  .faq-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .faq-item-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary, var(--color-surface-secondary)) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-sm);
  }

  .skeleton--text { width: 60%; height: var(--text-sm); }
  .skeleton--text-sm { width: 90%; height: var(--text-xs); }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--color-surface-secondary);
    }
  }
</style>
