# Admin Dashboard - Phase 1 TDD (Technical Design Document)

## System Overview

The Admin Dashboard provides the Platform Owner with a secure, server-rendered interface for managing core platform entities and viewing essential business metrics. It is built using SvelteKit, leveraging server-side `load` functions for data fetching and access control, and client-side Svelte components for interactive UI.

**Key Architecture Decisions**:

- **Server-Side Rendering (SSR)**: All admin pages are SSR for security (access control before rendering) and performance.
- **Role-Based Access Control**: Strict enforcement of the 'Platform Owner' role for all admin routes.
- **Service Layer Interaction**: The dashboard components and server functions will interact with dedicated service layers (e.g., `ContentService`, `PurchasesService`, `PlatformSettingsService`) to perform operations and fetch data.
- **Modular UI**: Components are organized by function (e.g., `ContentList`, `CustomerList`, `AnalyticsSummary`).

**Architecture Diagram**:

![Admin Dashboard Architecture](./assets/admin-dashboard-architecture.png)

The diagram shows the complete flow from Platform Owner browser through SvelteKit SSR routes, service layer interaction, and database queries.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#1-admin-dashboard) document for details on dependencies between features.

### External Dependencies

- **Neon Postgres**: Primary database for all data accessed by the dashboard.

---

## Component List

### 1. Admin Dashboard Service (`packages/web/src/lib/server/admin/service.ts`)

**Responsibility**: Aggregates data from various services to provide a consolidated view for the dashboard overview and analytics.

**Interface**:

```typescript
export interface IAdminDashboardService {
  /**
   * Retrieves a summary of key business analytics for the Platform Owner.
   * @returns An object containing total revenue, customer count, purchase count, top content, and recent purchases.
   */
  getAnalyticsSummary(): Promise<AnalyticsSummary>;

  /**
   * Manually grants access to a specific content item for a customer.
   * @param customerId The ID of the customer.
   * @param itemId The ID of the item (content, offering, etc.).
   * @param itemType The type of the item (e.g., 'content').
   */
  manuallyGrantAccess(
    customerId: string,
    itemId: string,
    itemType: string
  ): Promise<void>;
}

export interface AnalyticsSummary {
  totalRevenueAllTime: number;
  totalRevenueThisMonth: number;
  customerCount: number;
  purchaseCount: number;
  topContent: { title: string; purchaseCount: number }[];
  recentPurchases: {
    customerEmail: string;
    itemTitle: string;
    amount: number;
    purchasedAt: Date;
  }[];
}
```

**Implementation Notes**:

- `getAnalyticsSummary` will query `purchases` (for revenue, purchase count, top content) and `users` (for customer count).
- `manuallyGrantAccess` will interact with the `PurchasesService` or directly create a `content_access` record.

### 2. Admin Layout (`src/routes/admin/+layout.svelte` and `+layout.server.ts`)

**Responsibility**: Provides the overall structure and navigation for the admin panel.

**`+layout.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role using `requireOwner()`.
- Passes basic user info to the layout.

**`+layout.svelte` (Frontend Component)**:

- Renders a sidebar navigation with links to Dashboard, Content, Customers, Settings.
- Displays the logged-in Platform Owner's name.

### 3. Dashboard Overview Page (`src/routes/admin/+page.svelte` and `+page.server.ts`)

**Responsibility**: Displays the summary of business analytics.

**`+page.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role.
- Calls `adminDashboardService.getAnalyticsSummary()`.
- Passes the `AnalyticsSummary` to the Svelte component.

**`+page.svelte` (Frontend Component)**:

- Renders various cards/widgets to display the analytics data.

### 4. Content Management Pages (`src/routes/admin/content/+page.svelte`, `+page.server.ts`, `/[id]/+page.svelte`, `/[id]/+page.server.ts`)

**Responsibility**: List and manage content items.

**`src/routes/admin/content/+page.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role.
- Calls `contentService.getContentList()`.
- Passes content list to the Svelte component.

**`src/routes/admin/content/+page.svelte` (Frontend Component)**:

- Renders a table or list of content items.
- Provides actions for publish/unpublish/delete (calling server actions).
- Links to content creation/edit pages.

### 5. Customer Management Pages (`src/routes/admin/customers/+page.svelte`, `+page.server.ts`, `/[id]/+page.svelte`, `/[id]/+page.server.ts`)

**Responsibility**: List customers and view their details and purchase history.

**`src/routes/admin/customers/+page.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role.
- Fetches a list of users with `role = 'customer'`.
- Passes customer list to the Svelte component.

**`src/routes/admin/customers/[id]/+page.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role.
- Fetches specific customer details from `users` table.
- Fetches customer's purchase history using `purchasesService.getCustomerPurchases(customerId)`.
- Passes customer details and purchases to the Svelte component.

**`src/routes/admin/customers/[id]/+page.svelte` (Frontend Component)**:

- Displays customer profile and a list of their purchased items.
- Provides an action to manually grant access to content (calling `adminDashboardService.manuallyGrantAccess`).

### 6. Settings Page (`src/routes/admin/settings/+page.svelte` and `+page.server.ts`)

**Responsibility**: Manage basic platform branding and business information.

**`src/routes/admin/settings/+page.server.ts` (Load Function)**:

- Requires authentication and 'Platform Owner' role.
- Calls `platformSettingsService.getSettings()`.
- Passes settings data to the Svelte component.

**`src/routes/admin/settings/+page.svelte` (Frontend Component)**:

- Renders a form for editing platform name, logo, primary color, contact email, and business name.
- Submits changes via a SvelteKit form action to `platformSettingsService.updateSettings()`.

---

## Data Models / Schema

This feature primarily interacts with existing tables:

- `users` (for customer list, Platform Owner details)
- `content` (for content list, metadata)
- `media_items` (for content media details)
- `purchases` (for revenue, purchase count, customer purchase history)
- `platform_settings` (for branding and business info)

No new tables are introduced by this feature in Phase 1, but it relies heavily on the data from other features.

---

## Access Control Flow (Detailed)

1.  **Request to Admin Route**: A user attempts to access any URL under `/admin/*`.
2.  **Layout Server Load (`src/routes/admin/+layout.server.ts`)**:
    a. `requireOwner(event)`: This guard checks if the user is authenticated and has the 'Platform Owner' role.
    b. If not, it redirects to `/login` or an unauthorized page.
    c. If yes, the request proceeds to the specific page's `+page.server.ts`.
3.  **Page Server Load (`src/routes/admin/some-page/+page.server.ts`)**:
    a. Further data fetching and business logic are executed, assuming the user is a Platform Owner.

---

## Testing Strategy

- **Unit Tests**: For `AdminDashboardService` (mocking underlying service calls).
- **Integration Tests**: For admin API routes (e.g., content status updates, manual access grant).
- **E2E Tests**: For critical Platform Owner flows (login as owner -> view dashboard -> manage content -> view customer details).

---

## Related Documents

- **PRD**: [Admin Dashboard PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Auth TDD](../auth/ttd-dphase-1.md)
  - [Content Management TDD](../content-management/ttd-dphase-1.md)
  - [E-Commerce TDD](../e-commerce/ttd-dphase-1.md)
  - [Platform Settings TDD](../platform-settings/ttd-dphase-1.md)
- **Infrastructure**:
  - [Database Schema](../../infrastructure/DatabaseSchema.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
