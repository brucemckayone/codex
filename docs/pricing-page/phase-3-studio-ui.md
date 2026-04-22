# Phase 3: Studio UI — Recommended Toggle + FAQ Editor

**Version**: 1.1 (post-review)
**Date**: 2026-04-15
**Status**: Implementation-ready
**Depends on**: Phase 1A (isRecommended), Phase 1B (pricingFaq)

---

## 1. Overview

Two Studio additions:

| Feature | Location | Scope |
|---------|----------|-------|
| **3A: Recommended tier toggle** | Existing monetisation page | Small addition to tier list |
| **3B: FAQ simple list editor** | New settings sub-page | New page with CRUD form |

---

## Part 3A: Recommended Tier Toggle

### File: `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`

### What Changes

Add a "Recommended" toggle to each tier card in the existing tier list. The monetisation page already has full tier CRUD (create, edit, delete, reorder) — this adds one more control per tier.

### UI Design

Each tier item in the list currently uses plain `<div>` elements (NOT `Card.Root`):

```svelte
<!-- Actual structure (lines 437-467): -->
<div class="tier-item">
  <div class="tier-info">
    <div class="tier-rank">{i + 1}</div>
    <div class="tier-details">
      <span class="tier-name">{tier.name}</span>
      <span class="tier-description">{tier.description}</span>
    </div>
  </div>
  <div class="tier-prices">...</div>
  <div class="tier-actions"><!-- edit / delete --></div>
</div>
```

Add the recommended toggle and badge to the existing `.tier-info` section:

```svelte
{#each tiers as tier, i (tier.id)}
  <div class="tier-item">
    <div class="tier-info">
      <div class="tier-rank">{i + 1}</div>
      <div class="tier-details">
        <div class="tier-name-row">
          <span class="tier-name">{tier.name}</span>
          {#if tier.isRecommended}
            <Badge variant="accent">Recommended</Badge>
          {/if}
        </div>
        {#if tier.description}
          <span class="tier-description">{tier.description}</span>
        {/if}
      </div>
    </div>
    <div class="tier-recommended">
      <Switch
        checked={tier.isRecommended}
        onclick={() => handleToggleRecommended(tier)}
        aria-label="Set as recommended tier"
      />
    </div>
    <div class="tier-prices">...</div>
    <div class="tier-actions"><!-- edit / delete --></div>
  </div>
{/each}
```

**Note**: Uses `onclick` (not `onCheckedChange`) to match the existing Switch usage pattern on this page (see line 370-374 for subscriptions toggle).

### Handler

```ts
async function handleToggleRecommended(tier: SubscriptionTier) {
  try {
    await updateTier({
      orgId: data.org.id,
      tierId: tier.id,
      isRecommended: !tier.isRecommended,
    });
    // Re-fetch tier list to reflect the change
    // (backend clears other recommended flags)
    await invalidateAll();
    toast.success(
      tier.isRecommended
        ? 'Removed recommended status'
        : `${tier.name} set as recommended`
    );
  } catch (err) {
    toast.error('Failed to update tier');
  }
}
```

### Imports

The monetisation page already imports `Switch`, `Badge`, `updateTier`, and `invalidateAll`. 

**One new import needed** — toast is NOT currently imported on this page:

```ts
import { toast } from '$lib/components/ui/Toast/toast-store';
```

### Styling

```css
.tier-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
}

.tier-header-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tier-header-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
```

---

## Part 3B: FAQ Simple List Editor

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/routes/_org/[slug]/studio/settings/pricing-faq/+page.svelte` | FAQ editor page |

**No `+page.ts` needed** — the parent Studio layout (`studio/+layout.ts`) already has `export const ssr = false`, which applies to the entire studio subtree.

### Navigation

The settings nav is **hardcoded in the layout** (NOT from the unused `SETTINGS_NAV` array in `navigation.ts`).

### File: `apps/web/src/routes/_org/[slug]/studio/settings/+layout.svelte`

Find the hardcoded `tabs` derived array (around line 37) and add the new tab:

```ts
const tabs = $derived([
  {
    value: 'general',
    href: '/studio/settings',
    label: m.settings_general(),
  },
  {
    value: 'branding',
    href: '/studio/settings/branding',
    label: m.settings_branding(),
  },
  {
    value: 'pricing-faq',                    // <-- NEW
    href: '/studio/settings/pricing-faq',
    label: m.settings_pricing_faq(),         // Add i18n message
  },
]);
```

Also update the `activeTab` derived (around line 24) to detect the new path:

```ts
const activeTab = $derived(
  page.url.pathname.endsWith('/pricing-faq') ? 'pricing-faq' :
  page.url.pathname.endsWith('/branding') ? 'branding' : 'general'
);
```

### Page Design

```
┌─────────────────────────────────────────────────────┐
│  Pricing FAQ                            [+ Add Item] │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │  Can I cancel anytime?                    ↑ ↓ ✎ 🗑│
│  │  Yes, you can cancel your subscription... │   │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │  What payment methods?                    ↑ ↓ ✎ 🗑│
│  │  We accept all major credit...            │   │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │  Do I get instant access?                 ↑ ↓ ✎ 🗑│
│  │  Yes, immediately after...                │   │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌─────────────────────────────────────┐             │
│  │           Save Changes              │             │
│  └─────────────────────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

### Component Structure

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Input from '$lib/components/ui/Input/Input.svelte';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import { EmptyState } from '$lib/components/ui';
  import {
    PlusIcon, TrashIcon, EditIcon,
    ChevronUpIcon, ChevronDownIcon,
  } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getOrgBranding, updateBranding } from '$lib/remote/org.remote';
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
      const branding = await getOrgBranding(data.org.id);
      if (branding?.pricingFaq) {
        const parsed = JSON.parse(branding.pricingFaq) as PricingFaqItem[];
        items = parsed.sort((a, b) => a.order - b.order);
      }
    } catch {
      toast.error('Failed to load FAQ');
    } finally {
      loading = false;
    }
  });
</script>
```

### CRUD Operations

```ts
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
    // Update existing
    items = items.map((i) =>
      i.id === editItem!.id
        ? { ...i, question: editQuestion.trim(), answer: editAnswer.trim() }
        : i
    );
  } else {
    // Add new
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
```

### Save Handler

```ts
async function handleSave() {
  saving = true;
  try {
    await updateBranding({
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
```

### Edit Dialog

```svelte
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
```

### Styling

```css
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
  flex-direction: column;
  gap: var(--space-1);
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
```

### Remote Functions

Branding remote functions already exist in `$lib/remote/branding.remote.ts` (NOT `org.remote.ts`):

- `getBrandingSettings(orgId)` — query, calls `api.org.getSettings(orgId)` and extracts branding
- `updateBrandingCommand` — command for programmatic branding updates

Create dedicated FAQ functions in `$lib/remote/branding.remote.ts`:

```ts
export const getPricingFaq = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const settings = await api.org.getSettings(orgId);
  return settings?.branding?.pricingFaq
    ? JSON.parse(settings.branding.pricingFaq)
    : null;
});

export const updatePricingFaq = command(
  z.object({
    orgId: z.string().uuid(),
    pricingFaq: z.union([z.literal(null), z.string().min(1)]),
  }),
  async ({ orgId, pricingFaq }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.updateBranding(orgId, { pricingFaq });
  }
);
```

### Validation Pattern

Studio forms use **HTML5 constraints** (`required`, `maxlength`), NOT client-side Zod. Server-side Zod validation happens in the remote function. Match this pattern:

```svelte
<Input
  id="faq-question"
  bind:value={editQuestion}
  placeholder="e.g., Can I cancel anytime?"
  maxlength={200}
  required
/>
```

### Empty State

When no FAQ items exist:

```svelte
{#if items.length === 0 && !loading}
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
{/if}
```

---

## Verification

### 3A: Recommended Toggle

1. Open Studio > Monetisation with 3 tiers
2. Toggle "Recommended" on tier 2 → verify badge appears
3. Toggle "Recommended" on tier 3 → verify tier 2 badge disappears, tier 3 shows badge
4. Navigate to `/pricing` → verify "Most Popular" badge on correct tier
5. Toggle all off → verify pricing page falls back to middle tier highlight

### 3B: FAQ Editor

1. Open Studio > Settings > Pricing FAQ
2. Empty state shows "No FAQ items yet" with add button
3. Click "Add" → dialog opens with question/answer fields
4. Add an item → appears in list
5. Click edit → dialog pre-fills with existing values
6. Click delete → item removed
7. Use up/down arrows to reorder
8. Click "Save Changes" → toast success
9. Navigate to `/pricing` → verify FAQ accordion shows saved items
10. Clear all items + save → pricing page shows default FAQ
11. Character count displays correctly (200/2000 limits)
