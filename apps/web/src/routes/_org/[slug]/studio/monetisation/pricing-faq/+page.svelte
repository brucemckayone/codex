<!--
  @component StudioPricingFaq

  The Pricing FAQ tab of the monetisation hub — the questions answered on the
  org's PUBLIC pricing page, in the order visitors read them.

  Per the hub layout's masthead contract this carries a `variant="compact"`
  PageHeader (an <h2>) and NO kicker: the kicker used to be a back-link to
  `/studio/monetisation`, which is the tab strip 24px above it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import * as m from '$paraglide/messages';
  import { Alert, EmptyState, PageHeader } from '$lib/components/ui';
  import { Skeleton } from '$lib/components/ui/Skeleton';
  import {
    PlusIcon,
    TrashIcon,
    EditIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    ExternalLinkIcon,
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

  // Delete confirmation. `deleteItem` used to remove a question with no
  // confirmation at all, and there is no route guard on unsaved changes — so an
  // accidental click plus a tab switch silently discarded work the save bar had
  // just promised to keep.
  let deleteOpen = $state(false);
  let deleteTarget = $state<PricingFaqItem | null>(null);

  onMount(async () => {
    try {
      const result = await getPricingFaq(data.org.id);
      if (result && Array.isArray(result) && result.length > 0) {
        items = (result as PricingFaqItem[]).sort((a, b) => a.order - b.order);
      }
    } catch {
      toast.error(m.monetisation_faq_load_error());
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

  function askDelete(item: PricingFaqItem) {
    deleteTarget = item;
    deleteOpen = true;
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    items = items
      .filter((i) => i.id !== id)
      .map((i, idx) => ({ ...i, order: idx }));
    hasChanges = true;
    deleteOpen = false;
    deleteTarget = null;
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
      toast.success(m.monetisation_faq_saved());
    } catch {
      toast.error(m.monetisation_faq_save_error());
    } finally {
      saving = false;
    }
  }
</script>

<div class="faq-editor">
  <PageHeader
    variant="compact"
    title={m.monetisation_pricing_faq_title()}
    description={m.monetisation_pricing_faq_description()}
  >
    {#snippet meta()}
      {#if !loading && items.length > 0}
        <li>
          {items.length === 1
            ? m.monetisation_faq_count_one()
            : m.monetisation_faq_count({ count: String(items.length) })}
        </li>
      {/if}
    {/snippet}
    {#snippet actions()}
      <!-- You are editing copy for a page you could not see from here. -->
      <a class="faq-public-link" href="/pricing" target="_blank" rel="noreferrer">
        {m.monetisation_faq_view_public()}
        <ExternalLinkIcon size={14} />
      </a>
      {#if items.length > 0}
        <Button variant="secondary" size="sm" onclick={addItem}>
          <PlusIcon size={14} />
          {m.monetisation_faq_add_item()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if loading}
    <!-- Shaped like the row it becomes: a bounded question line and a wrapped
         answer, not three full-column bars for content that resolves to ~580px. -->
    <div class="faq-loading">
      {#each Array(3) as _, i (i)}
        <div class="faq-item faq-item--skeleton">
          <div class="faq-item-content">
            <Skeleton width="60%" height="var(--text-sm)" />
            <Skeleton width="90%" height="var(--text-xs)" />
          </div>
        </div>
      {/each}
    </div>
  {:else if items.length === 0}
    <div class="faq-empty-panel">
      <EmptyState
        size="lg"
        title={m.monetisation_faq_empty_title()}
        description={m.monetisation_faq_empty_description()}
      >
        {#snippet action()}
          <Button onclick={addItem}>
            <PlusIcon size={14} />
            {m.monetisation_faq_add_first()}
          </Button>
        {/snippet}
      </EmptyState>
    </div>
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
              aria-label={m.monetisation_faq_move_up()}
            >
              <ChevronUpIcon size={14} />
            </button>
            <button
              class="icon-btn"
              onclick={() => moveDown(index)}
              disabled={index === items.length - 1}
              aria-label={m.monetisation_faq_move_down()}
            >
              <ChevronDownIcon size={14} />
            </button>
            <button
              class="icon-btn"
              onclick={() => editExisting(item)}
              aria-label={m.monetisation_faq_edit_aria()}
            >
              <EditIcon size={14} />
            </button>
            <button
              class="icon-btn icon-btn--danger"
              onclick={() => askDelete(item)}
              aria-label={m.monetisation_faq_delete_aria()}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if hasChanges}
      <div class="save-bar" role="status">
        <span class="save-bar__note">{m.monetisation_faq_unsaved()}</span>
        <Button onclick={handleSave} loading={saving}>
          {m.monetisation_faq_save_changes()}
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
        {editItem ? m.monetisation_faq_edit_title() : m.monetisation_faq_add_title()}
      </Dialog.Title>
    </Dialog.Header>

    <div class="faq-edit-form">
      <div class="field">
        <Label for="faq-question">{m.monetisation_faq_question()}</Label>
        <Input
          id="faq-question"
          bind:value={editQuestion}
          placeholder={m.monetisation_faq_question_placeholder()}
          maxlength={200}
          required
        />
        <span class="char-count">{editQuestion.length}/200</span>
      </div>

      <div class="field">
        <Label for="faq-answer">{m.monetisation_faq_answer()}</Label>
        <TextArea
          id="faq-answer"
          bind:value={editAnswer}
          placeholder={m.monetisation_faq_answer_placeholder()}
          rows={4}
          maxlength={2000}
        />
        <span class="char-count">{editAnswer.length}/2000</span>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={() => { editOpen = false; }}>
        {m.monetisation_faq_cancel()}
      </Button>
      <Button
        onclick={saveEdit}
        disabled={!editQuestion.trim() || !editAnswer.trim()}
      >
        {editItem ? m.monetisation_faq_update() : m.monetisation_faq_add()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirmation -->
<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{m.monetisation_faq_delete_title()}</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <p class="delete-confirm">{m.monetisation_faq_delete_description()}</p>
      {#if deleteTarget}
        <Alert variant="info">{deleteTarget.question}</Alert>
      {/if}
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => { deleteOpen = false; deleteTarget = null; }}>
        {m.monetisation_faq_cancel()}
      </Button>
      <Button variant="destructive" onclick={confirmDelete}>
        {m.monetisation_faq_delete_confirm()}
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

  .faq-public-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors);
  }

  .faq-public-link:hover {
    color: var(--color-text);
    border-bottom-color: var(--color-border-strong, var(--color-border));
  }

  .faq-public-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Grid with a bounded prose column and an `auto` action cluster packed right
     after it, rather than `flex: 1` on the content — which pushed four icon
     buttons 1054px away from the question they act on. The `1fr` spacer keeps
     the actions at the row's right edge, the conventional place for row
     actions; everything meaning-bearing stays associated on the left. */
  .faq-item {
    display: grid;
    /* prose · actions · slack. The actions used to sit in the LAST track with a
       `1fr` spacer before them, which measured 1054px of empty row between a
       question and the four buttons that reorder, edit and delete it. Right-edge
       row actions are conventional when the row is FULL of content; this row
       holds ~580px of prose in an 1808px column, so the convention just bought
       a void. Reorder controls especially need adjacency — you compare rows
       vertically, and the eye cannot hold x=105 and x=1750 at once. */
    grid-template-columns: minmax(0, var(--measure-lede)) auto 1fr;
    align-items: start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
  }

  @media (--below-sm) {
    .faq-item {
      grid-template-columns: minmax(0, 1fr);
    }

    .faq-item-actions {
      grid-column: 1;
    }
  }

  .faq-item-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .faq-item-question {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
    text-wrap: pretty;
  }

  .faq-item-answer {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .faq-item-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
    grid-column: 2;
  }

  .faq-empty-panel {
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
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
    outline-offset: var(--space-0-5);
  }

  .icon-btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  /* `--color-status-error-*`, NOT the raw `--color-error-600` / `--color-error-50`
     this used to carry. Those are fixed light-mode sRGB steps with no
     `[data-theme]` remap, so on a dark page the -50 tint became the brightest
     thing on the screen. `styles/themes/status.css` derives its triple from the
     page's own surface and ink. The revenue-share page's comment documents the
     same fix — this file was simply missed. */
  .icon-btn--danger:hover:not(:disabled) {
    color: var(--color-status-error-text);
    background-color: var(--color-status-error-surface);
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

  .delete-confirm {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .save-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .save-bar__note {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Loading skeleton — shimmer + reduced-motion guard live in <Skeleton>. */
  .faq-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
