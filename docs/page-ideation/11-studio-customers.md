# Org Studio Customers — Feature Ideation

**Route**: `{slug}.*/studio/customers` → `_org/[slug]/studio/customers/+page.svelte`
**Current state**: Basic customer list table. Minimal CRM functionality.
**Priority**: MEDIUM — customer relationship management.

---

## Vision

The customers page is the org's **lightweight CRM**. Not Salesforce — but enough to understand who your customers are, what they've bought, and how to keep them engaged. Think Stripe Dashboard customer view meets Shopify customer list.

---

## Customer List

### Enhanced Table
- Columns: Avatar, Name, Email, Joined, Total Spent, Purchases, Last Active, Status, Actions
- Sortable by any column
- Status badges: Active (accessed in last 30 days), Inactive (30-90 days), Churned (90+ days)
- "VIP" badge for top spenders (configurable threshold)
- Row click: Opens customer detail panel/page

### Search & Filters
- Search: Name, email
- Filter by: Status (active/inactive/churned), Purchase range, Join date range, Content purchased
- Saved filter presets: "VIP Customers", "New This Month", "At Risk"

### Bulk Actions
- Select multiple → Email selected (future), Export selected, Tag selected

---

## Customer Detail View (Drawer or Page)

### Profile Section
- Avatar, name, email
- Joined date
- Account status (active/verified)
- Social links (if available from their profile)

### Purchase History
- Table: Date, Content, Amount, Status (completed/refunded)
- Total spent: "£127 across 4 purchases"
- "Grant Free Access" button → give them content without purchase

### Engagement Metrics
- Content in library: X items
- Watch time: X hours total
- Completion rate: X% of purchased content completed
- Last active: Date + what they did
- Favorite category: Based on purchase/watch patterns

### Actions
- "Grant Access" → Give free access to specific content
- "Send Email" (future) → Direct message
- "Refund" → Initiate refund for specific purchase
- "Notes" → Admin can add private notes about this customer
- "Block" (rare) → Prevent access

---

## Customer Insights Summary (Top of Page)

- Total customers: 156
- New this month: +12 (with trend)
- Average spend: £45
- Most popular content among customers
- Customer retention rate: "78% have purchased more than once"

---

## Export

- "Export Customers" → CSV download
- Include: Name, email, total spent, purchase count, join date, last active
- GDPR-compliant: Option to anonymize emails

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Customer list | admin API | Yes |
| Purchase history per customer | admin/ecom API | Yes |
| Engagement metrics | analytics/progress API | Partial |
| Grant access | admin API | Yes |
| Export | admin API | Partial |
| Customer notes | Not built | Future |

---

## Priority Ideas (Top 5)

1. **Enhanced customer table** with status badges, total spent, last active
2. **Customer detail drawer** with purchase history and engagement metrics
3. **Search and filter** by status, spend, date range
4. **Customer insights summary** at top of page (total, new, avg spend)
5. **Grant free access** action for customer support scenarios
