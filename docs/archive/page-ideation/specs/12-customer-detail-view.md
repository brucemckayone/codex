# Customer Detail View — Implementation Spec

## Summary

Add a customer detail drawer to the studio customers page. When a row in the `CustomerTable` is clicked, a slide-out drawer opens on the right showing the customer's profile, aggregated stats, full purchase history, and a "Grant Access" action for granting complimentary content access.

This is a medium-effort, frontend-only feature. The two backend endpoints already exist:
- `GET /api/admin/customers/:id` — returns `CustomerDetails` (profile + purchase history)
- `POST /api/admin/customers/:customerId/grant-access/:contentId` — grants complimentary access

The work is: two new API client methods, one new drawer component, one new grant-access dialog component, modifications to the customers page and table, and corresponding i18n messages.

---

## Feasibility

### Pros

- **Both API endpoints already exist and are tested.** The `AdminCustomerManagementService.getCustomerDetails()` method returns the exact data shape needed (profile, stats, purchase history). The `grantContentAccess()` method handles idempotency and validation. No backend work required.
- **The Zod validation schemas already exist.** `adminCustomerIdParamsSchema` validates the customer ID path parameter. `adminGrantAccessParamsSchema` validates both `customerId` and `contentId`.
- **The Dialog component suite is production-ready.** Melt UI-backed `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` are all available. The drawer pattern can be built as a variant of DialogContent with right-anchored positioning.
- **Table components are already in use.** The purchase history table inside the drawer reuses the same `Table.Root`, `Table.Header`, `Table.Body`, `Table.Row`, `Table.Head`, `Table.Cell` pattern that `CustomerTable` already uses.
- **Format utilities exist.** `formatDate()` and `formatPrice()` from `$lib/utils/format` handle GBP formatting and date display — the same ones `CustomerTable` already imports.
- **The `CustomerListItem` type has `userId`** which is the identifier needed for the `GET /customers/:id` call. No ID translation required.

### Gotchas & Risks

- **The API client (`api.ts`) is missing two methods.** The `admin` namespace currently only has `getCustomers()` and `getActivity()`. Two new methods are needed: `getCustomerDetail(id)` and `grantContentAccess(customerId, contentId)`.
- **The `CustomerDetails` type is defined in `@codex/admin` but not yet imported in `api.ts`.** The type import must be added alongside the existing `CustomerListItem` import.
- **Drawer vs modal decision.** A right-anchored drawer is better than a centered modal here because: (a) the customer list stays visible in the background for context, (b) purchase history can be a long scrollable list that benefits from full viewport height, (c) it matches the pattern of "detail pane beside list" used in email clients and CRM tools. A dedicated page (`/studio/customers/:id`) is overkill for what is essentially a read-only detail view with one action.
- **Content picker for grant-access.** The grant-access endpoint requires a `contentId`. The UI needs a way to select content. The simplest approach is a `Select` dropdown populated with the org's published content list. This requires fetching content — but the admin content list endpoint (`GET /api/admin/content`) already exists and is wired in the API client. The content list can be fetched lazily when the grant-access dialog opens.
- **No search or filter on the customer table yet.** This spec is scoped to the detail view only. Search/filter is a separate enhancement.
- **Date serialisation.** The `CustomerDetails` type has `createdAt: Date` and `purchaseHistory[].purchasedAt: Date` at the service layer, but JSON serialisation over HTTP converts these to ISO strings. The frontend should treat them as `string` and pass through `formatDate()`.

---

## Current State

### Customers Page

The studio customers page (`_org/[slug]/studio/customers/+page.svelte`) renders:

1. **PageHeader** with title ("Customers") and a count badge showing `pagination.total`.
2. **CustomerTable** component displaying rows with: name, email, purchase count, total spent (GBP), joined date.
3. **Pagination** component when `totalPages > 1`.
4. **EmptyState** when no customers exist.

The table rows are purely display — no click handlers, no links, no drill-down. Each row renders five `Table.Cell` components with no interactivity.

### Server Load

`+page.server.ts` fetches `api.admin.getCustomers(params)` with `organizationId`, `page`, and `limit` parameters. It guards on `userRole` being `admin` or `owner`. Returns `{ customers: { items, pagination } }`.

### API Client

The `admin` namespace in `api.ts` currently has:
- `getCustomers(params?)` — returns `PaginatedListResponse<CustomerListItem>`
- `getActivity(params?)` — returns `ActivityFeedResponse`

Missing:
- `getCustomerDetail(id)` — for the detail drawer
- `grantContentAccess(customerId, contentId)` — for the grant action

### Types Available

From `@codex/admin`:
```typescript
interface CustomerListItem {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  totalPurchases: number;
  totalSpentCents: number;
}

interface CustomerDetails {
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;         // serialised as ISO string over HTTP
  totalPurchases: number;
  totalSpentCents: number;
  purchaseHistory: PurchaseHistoryItem[];
}

interface PurchaseHistoryItem {
  purchaseId: string;
  contentId: string;
  contentTitle: string;
  amountPaidCents: number;
  purchasedAt: Date;       // serialised as ISO string over HTTP
}
```

---

## Design Spec

### 1. Customer Detail Drawer

A right-anchored slide-out panel that opens when a customer row is clicked. Uses the existing Melt UI Dialog primitives with custom positioning to slide in from the right edge.

#### Approach Rationale

A drawer (not a centered modal, not a dedicated page) because:
- The customer list remains visible behind the overlay, providing context.
- Purchase history can be long — a full-height drawer handles scrolling better than a max-height modal.
- Closing the drawer returns to the exact same list state (page, scroll position) with no navigation.
- A dedicated route (`/studio/customers/:id`) would require its own server load, layout integration, and back-navigation handling — all unnecessary for a read-only detail view.

#### Component: `CustomerDetailDrawer.svelte`

Location: `apps/web/src/lib/components/studio/CustomerDetailDrawer.svelte`

```typescript
interface Props {
  open: boolean;                      // bindable, controls drawer visibility
  customerId: string | null;          // user ID of the selected customer
  organizationId: string;             // for API calls (org-scoped)
  onOpenChange?: (open: boolean) => void;
}
```

The drawer uses the existing `Dialog` component internally but overrides `DialogContent` positioning:

```css
.drawer-content {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(28rem, 90vw);
  max-width: none;
  max-height: none;
  border-radius: 0;
  border-left: var(--border-width) var(--border-style) var(--color-border);
  border-right: none;
  border-top: none;
  border-bottom: none;
  box-shadow: var(--shadow-xl);
  background: var(--color-surface);
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
}
```

On mobile (below `--breakpoint-sm`), the drawer expands to full width.

#### Data Fetching

When `open` becomes `true` and `customerId` is non-null, the drawer fetches customer details:

```typescript
let customerData = $state<CustomerDetails | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

$effect(() => {
  if (open && customerId) {
    loading = true;
    error = null;
    fetchCustomerDetail(customerId);
  } else {
    customerData = null;
  }
});
```

The fetch calls a new remote function `getCustomerDetail(organizationId, customerId)` that invokes `api.admin.getCustomerDetail(customerId, params)` on the server.

#### Layout (top to bottom)

1. **Drawer header** — Close button (X icon, top-right), "Customer Details" title.
2. **Profile section** — Avatar placeholder (initials circle), name, email, joined date.
3. **Stats bar** — Two stat items side by side: "Total Purchases" count, "Total Spent" in GBP.
4. **Purchase history table** — Scrollable table of all purchases.
5. **Actions section** — "Grant Access" button (sticky footer or bottom section).

#### Loading State

While `loading` is true, render `Skeleton` components matching the layout: a circle for avatar, two line skeletons for name/email, two box skeletons for stats, and three row skeletons for the purchase table.

#### Error State

If the fetch fails, show an inline error message with a "Retry" button. The drawer stays open.

---

### 2. Profile Section

The top section of the drawer showing customer identity and membership info.

#### Avatar

A circular div with the customer's initials (first letter of name, or first letter of email if name is null). Background colour derived from a simple hash of the userId for visual variety.

```typescript
const initials = $derived(
  customerData?.name
    ? customerData.name.charAt(0).toUpperCase()
    : customerData?.email.charAt(0).toUpperCase() ?? '?'
);
```

```css
.avatar {
  width: var(--space-12);
  height: var(--space-12);
  border-radius: var(--radius-full, 9999px);
  background: var(--color-interactive);
  color: var(--color-text-on-interactive, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  flex-shrink: 0;
}
```

#### Profile Info

```svelte
<div class="profile-info">
  <h3 class="customer-name">{customerData.name ?? customerData.email}</h3>
  {#if customerData.name}
    <p class="customer-email">{customerData.email}</p>
  {/if}
  <p class="customer-joined">
    {m.studio_customer_joined()} {formatDate(customerData.createdAt)}
  </p>
</div>
```

```css
.customer-name {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  margin: 0;
}

.customer-email {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

.customer-joined {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  margin-top: var(--space-1);
}
```

---

### 3. Stats Bar

Two stat items displayed side by side below the profile, summarising the customer's financial relationship with the org.

```svelte
<div class="stats-bar">
  <div class="stat-item">
    <span class="stat-value">{customerData.totalPurchases}</span>
    <span class="stat-label">{m.studio_customer_total_purchases()}</span>
  </div>
  <div class="stat-item">
    <span class="stat-value">{formatPrice(customerData.totalSpentCents)}</span>
    <span class="stat-label">{m.studio_customer_total_spent()}</span>
  </div>
</div>
```

```css
.stats-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--color-surface-secondary);
  border-radius: var(--radius-md);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.stat-value {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

---

### 4. Purchase History Table

A table listing all of the customer's completed purchases from this organisation, ordered by most recent first (the API already returns them in descending `purchasedAt` order).

#### Columns

| Column | Field | Format | Alignment |
|--------|-------|--------|-----------|
| Content | `contentTitle` | Plain text, truncated with ellipsis | Left |
| Amount | `amountPaidCents` | `formatPrice()` (GBP) | Right |
| Date | `purchasedAt` | `formatDate()` | Right |

Three columns (not five like the list table) because the drawer is narrower and the data is scoped to one customer.

#### Markup

```svelte
<div class="purchase-history">
  <h4 class="section-title">{m.studio_customer_purchase_history()}</h4>

  {#if customerData.purchaseHistory.length === 0}
    <p class="empty-history">{m.studio_customer_no_purchases()}</p>
  {:else}
    <div class="table-wrapper">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{m.studio_customer_col_content()}</Table.Head>
            <Table.Head class="align-right">{m.studio_customer_col_amount()}</Table.Head>
            <Table.Head class="align-right">{m.studio_customer_col_date()}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each customerData.purchaseHistory as purchase (purchase.purchaseId)}
            <Table.Row>
              <Table.Cell class="content-title-cell">
                {purchase.contentTitle}
              </Table.Cell>
              <Table.Cell class="amount-cell">
                {formatPrice(purchase.amountPaidCents)}
              </Table.Cell>
              <Table.Cell class="date-cell">
                {formatDate(purchase.purchasedAt)}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
</div>
```

```css
.purchase-history {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

.section-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.table-wrapper {
  overflow-x: auto;
  flex: 1;
}

.empty-history {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  padding: var(--space-6) 0;
  text-align: center;
}

:global(.content-title-cell) {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.amount-cell) {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-medium);
}

:global(.align-right) {
  text-align: right;
}
```

---

### 5. Grant Access Action

A button in the drawer footer that opens a confirmation dialog for granting complimentary content access.

#### Button in Drawer

```svelte
<div class="drawer-footer">
  <Button variant="secondary" onclick={() => (grantDialogOpen = true)}>
    {m.studio_customer_grant_access()}
  </Button>
</div>
```

```css
.drawer-footer {
  padding: var(--space-4) var(--space-6);
  border-top: var(--border-width) var(--border-style) var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}
```

#### Grant Access Dialog: `GrantAccessDialog.svelte`

Location: `apps/web/src/lib/components/studio/GrantAccessDialog.svelte`

A modal dialog that appears on top of the drawer overlay. Contains a content picker (Select dropdown) and confirm/cancel buttons.

```typescript
interface Props {
  open: boolean;                        // bindable
  customerId: string;
  customerName: string | null;
  organizationId: string;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;               // callback to refresh drawer data
}
```

#### Content Picker

When the dialog opens, it fetches the org's published content list for the Select dropdown:

```typescript
let contentItems = $state<{ value: string; label: string }[]>([]);
let selectedContentId = $state<string | null>(null);
let submitting = $state(false);
let fetchError = $state<string | null>(null);
let submitError = $state<string | null>(null);
let success = $state(false);

$effect(() => {
  if (open) {
    loadContent();
  }
});

async function loadContent() {
  // Fetch published content for this org to populate the Select
  // Uses the existing content list endpoint
}
```

The Select shows content titles. The list is filtered to published content only (since granting access to drafts is not meaningful).

To avoid granting access to content the customer already owns, items that appear in `purchaseHistory` can be filtered out or shown with a "(already purchased)" suffix. This is a UX nicety, not a hard requirement — the backend is idempotent and will return success even if access already exists.

#### Dialog Layout

```svelte
<Dialog bind:open onOpenChange>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{m.studio_customer_grant_access_title()}</DialogTitle>
      <DialogDescription>
        {m.studio_customer_grant_access_description({
          name: customerName ?? 'this customer'
        })}
      </DialogDescription>
    </DialogHeader>

    <div class="grant-form">
      <Select
        options={contentItems}
        value={selectedContentId}
        onValueChange={(v) => (selectedContentId = v)}
        placeholder={m.studio_customer_select_content()}
      />

      {#if submitError}
        <p class="error-message">{submitError}</p>
      {/if}

      {#if success}
        <p class="success-message">{m.studio_customer_access_granted()}</p>
      {/if}
    </div>

    <DialogFooter>
      <Button variant="ghost" onclick={() => (open = false)}>
        {m.common_cancel()}
      </Button>
      <Button
        variant="primary"
        onclick={handleGrantAccess}
        disabled={!selectedContentId || submitting}
      >
        {submitting ? m.common_loading() : m.studio_customer_grant_access_confirm()}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### Submission

The confirm button calls a remote command `grantContentAccess(organizationId, customerId, contentId)` which invokes `api.admin.grantContentAccess(customerId, contentId, params)`.

On success:
1. Show a success message ("Access granted") briefly.
2. Call `onSuccess?.()` to let the drawer refresh its data (the customer's purchase history will not change, but the UI provides positive feedback).
3. Close the dialog after a short delay or on the next user action.

On error:
- Display the error message inline below the Select.
- Keep the dialog open for retry.

---

### 6. Integration with Customer List

#### Click Handler on Table Rows

The `CustomerTable` component gains an `onCustomerClick` callback prop:

```typescript
// In CustomerTable.svelte
interface Props {
  customers: CustomerListItem[];
  onCustomerClick?: (customerId: string) => void;  // NEW
}
```

Each `Table.Row` gets a click handler and visual affordance:

```svelte
<Table.Row
  class="clickable-row"
  onclick={() => onCustomerClick?.(customer.userId)}
  role="button"
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCustomerClick?.(customer.userId);
    }
  }}
>
```

```css
:global(.clickable-row) {
  cursor: pointer;
  transition: var(--transition-colors);
}

:global(.clickable-row:hover) {
  background: var(--color-surface-hover);
}

:global(.clickable-row:focus-visible) {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: -2px;
}
```

#### Page State Management

The customers page (`+page.svelte`) manages the drawer state:

```svelte
<script lang="ts">
  // ... existing imports ...
  import CustomerDetailDrawer from '$lib/components/studio/CustomerDetailDrawer.svelte';

  let { data }: { data: PageData } = $props();

  let drawerOpen = $state(false);
  let selectedCustomerId = $state<string | null>(null);

  function handleCustomerClick(customerId: string) {
    selectedCustomerId = customerId;
    drawerOpen = true;
  }
</script>

<!-- Existing page content -->
{#if hasCustomers}
  <CustomerTable
    customers={data.customers.items}
    onCustomerClick={handleCustomerClick}
  />
  <!-- ... pagination ... -->
{/if}

<!-- Detail drawer -->
<CustomerDetailDrawer
  bind:open={drawerOpen}
  customerId={selectedCustomerId}
  organizationId={data.org.id}
/>
```

#### Data Flow

```
CustomerTable row click
  -> handleCustomerClick(userId)
  -> sets selectedCustomerId + drawerOpen = true
  -> CustomerDetailDrawer opens
  -> $effect detects open + customerId
  -> calls getCustomerDetail(orgId, customerId) remote function
  -> server calls api.admin.getCustomerDetail(id, params)
  -> drawer renders profile, stats, purchase history
  -> "Grant Access" button click
  -> GrantAccessDialog opens
  -> fetches content list for Select
  -> user selects content, confirms
  -> calls grantContentAccess(orgId, customerId, contentId) remote command
  -> server calls api.admin.grantContentAccess(customerId, contentId, params)
  -> success feedback, dialog closes
```

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/studio/CustomerDetailDrawer.svelte` | Right-anchored drawer showing customer profile, stats, purchase history |
| `apps/web/src/lib/components/studio/GrantAccessDialog.svelte` | Modal dialog with content picker for granting complimentary access |

### Files to Modify

#### 1. `apps/web/src/lib/server/api.ts`

Add two methods to the `admin` namespace and import the `CustomerDetails` type:

```typescript
// Add to imports (line ~19)
import type {
  ActivityFeedResponse,
  CustomerDetails,      // NEW
  CustomerListItem,
  RevenueAnalyticsResponse,
  TopContentAnalyticsResponse,
} from '@codex/admin';

// Add to admin namespace (after getCustomers)
getCustomerDetail: (id: string, params?: URLSearchParams) =>
  request<CustomerDetails>(
    'admin',
    `/api/admin/customers/${id}${params ? `?${params}` : ''}`
  ),

grantContentAccess: (customerId: string, contentId: string, params?: URLSearchParams) =>
  request<{ success: boolean }>(
    'admin',
    `/api/admin/customers/${customerId}/grant-access/${contentId}${params ? `?${params}` : ''}`,
    { method: 'POST' }
  ),
```

The `params` include `organizationId` which the `procedure()` policy resolves from the membership. Since the admin endpoints use `requireOrgMembership` + `requireOrgManagement`, the `organizationId` must be passed as a query parameter (matching how `getCustomers` works today).

#### 2. `apps/web/src/lib/remote/admin.remote.ts` (or new file if admin remote does not exist)

Add two remote functions:

```typescript
export const getCustomerDetail = query(
  z.object({ organizationId: z.string().uuid(), customerId: z.string() }),
  async ({ organizationId, customerId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', organizationId);
    return api.admin.getCustomerDetail(customerId, params);
  }
);

export const grantContentAccess = command(
  z.object({
    organizationId: z.string().uuid(),
    customerId: z.string(),
    contentId: z.string().uuid(),
  }),
  async ({ organizationId, customerId, contentId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', organizationId);
    return api.admin.grantContentAccess(customerId, contentId, params);
  }
);
```

#### 3. `apps/web/src/lib/components/studio/CustomerTable.svelte`

- Add `onCustomerClick?: (customerId: string) => void` to Props interface.
- Add `onclick`, `role="button"`, `tabindex="0"`, and `onkeydown` to each `Table.Row`.
- Add `.clickable-row` hover/focus styles.

#### 4. `apps/web/src/routes/_org/[slug]/studio/customers/+page.svelte`

- Import `CustomerDetailDrawer`.
- Add `drawerOpen` and `selectedCustomerId` state.
- Add `handleCustomerClick` function.
- Pass `onCustomerClick={handleCustomerClick}` to `CustomerTable`.
- Render `CustomerDetailDrawer` with `bind:open`, `customerId`, and `organizationId`.

#### 5. i18n Messages

Add these keys to the paraglide messages file:

| Key | English Value |
|-----|---------------|
| `studio_customer_details_title` | `"Customer Details"` |
| `studio_customer_joined` | `"Joined"` |
| `studio_customer_total_purchases` | `"Purchases"` |
| `studio_customer_total_spent` | `"Total Spent"` |
| `studio_customer_purchase_history` | `"Purchase History"` |
| `studio_customer_no_purchases` | `"No purchases yet"` |
| `studio_customer_col_content` | `"Content"` |
| `studio_customer_col_amount` | `"Amount"` |
| `studio_customer_col_date` | `"Date"` |
| `studio_customer_grant_access` | `"Grant Access"` |
| `studio_customer_grant_access_title` | `"Grant Complimentary Access"` |
| `studio_customer_grant_access_description` | `"Select content to grant free access to {name}."` |
| `studio_customer_select_content` | `"Select content..."` |
| `studio_customer_grant_access_confirm` | `"Grant Access"` |
| `studio_customer_access_granted` | `"Access granted successfully"` |
| `studio_customer_error_loading` | `"Failed to load customer details"` |
| `studio_customer_retry` | `"Retry"` |

Existing keys reused: `common_cancel`, `common_loading`.

---

## Testing Notes

### Manual Testing

1. **Row click opens drawer.** Navigate to `/studio/customers`. Click a customer row. Verify the drawer slides in from the right showing a loading skeleton.
2. **Drawer content.** Verify the drawer shows: initials avatar, name (or email if name is null), email, joined date, total purchases count, total spent in GBP, and a table of purchase history items.
3. **Purchase history.** Verify purchases show content title, amount in GBP, and formatted date. Verify they are ordered by most recent first.
4. **Close drawer.** Click the X button. Verify the drawer slides out. Verify clicking the overlay also closes the drawer. Verify pressing Escape closes the drawer.
5. **Keyboard navigation.** Tab to a customer row in the table. Press Enter. Verify the drawer opens. Tab through the drawer content. Verify focus is trapped within the drawer while open.
6. **Empty purchase history.** This should not occur (the API returns 404 if a customer has zero purchases from the org), but verify the empty state message renders if `purchaseHistory` is an empty array.
7. **Grant access flow.** Click "Grant Access" in the drawer footer. Verify the dialog opens with a content Select dropdown. Verify the Select is populated with the org's published content. Select a content item and click "Grant Access". Verify success message appears.
8. **Grant access — already owned.** Grant access to content the customer already purchased. Verify the backend returns success (idempotent) and the UI shows the success message without error.
9. **Grant access — no content selected.** Verify the "Grant Access" confirm button is disabled when no content is selected.
10. **Error handling.** Stop the admin-api worker. Click a customer row. Verify the drawer shows an error message with a "Retry" button. Click "Retry". Verify it attempts the fetch again.
11. **Responsive.** Resize the browser below the `sm` breakpoint. Verify the drawer expands to full viewport width.
12. **Role gate.** The page itself is already gated to admin/owner roles in `+page.server.ts`. Verify a `creator` role user still gets the 403 error and never sees the customer page.
13. **Pagination preserved.** Navigate to page 2 of customers. Click a row. Close the drawer. Verify you are still on page 2.
14. **Multiple customers.** Open the drawer for one customer, close it, open for another. Verify the data updates correctly and does not show stale data from the previous customer.

### Edge Cases

- Customer with a very long name or email: verify text truncation in the drawer profile section.
- Customer with many purchases (50+): verify the purchase history table scrolls within the drawer without the drawer itself becoming unusably long.
- Org with no published content: when opening the grant-access dialog, the content Select should be empty with an appropriate placeholder/disabled state.
- Network error during grant-access: verify error message is shown inline and the dialog stays open for retry.
- Rapid clicking different customer rows: verify the drawer shows the most recently clicked customer (the `$effect` should cancel stale fetches or the latest response wins).
