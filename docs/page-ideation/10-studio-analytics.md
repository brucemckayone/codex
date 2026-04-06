# Org Studio Analytics — Feature Ideation

**Route**: `{slug}.*/studio/analytics` → `_org/[slug]/studio/analytics/+page.svelte`
**Current state**: Basic revenue stats and content performance. Very minimal.
**Priority**: MEDIUM — business intelligence for decision-making.

---

## Vision

Analytics should turn data into **decisions**. Not just "you made £2,340" but "your revenue grew 23% because 'Yoga Basics' went viral — create more beginner content." Think Shopify Analytics meets YouTube Studio.

---

## Analytics Dashboard Sections

### 1. Period Selector (Global)
- Date range picker: Last 7 days, 30 days, 90 days, Year, All time, Custom range
- Comparison toggle: "Compare to previous period"
- Applies to all charts on the page
- Sticky at top of page

### 2. Revenue Analytics

#### Revenue KPI Strip
- Total Revenue (period): "£2,340" with trend arrow
- Avg Order Value: "£34" with trend
- Number of Sales: "68" with trend
- Revenue per Customer: "£18.50"

#### Revenue Chart
- Line chart: Daily revenue over time
- Comparison: Previous period as dotted line
- Hover: Exact amount + date
- Toggle: Revenue vs Sales count vs AOV
- Annotations: "Content published" / "Promotion started" markers

#### Revenue Breakdown
- By Content: Horizontal bar chart, ranked by revenue
- By Category: Donut/pie chart showing category distribution
- By Creator: Bar chart showing per-creator revenue (multi-creator orgs)
- By Period: Monthly heatmap calendar showing daily revenue intensity

### 3. Customer Analytics

#### Customer KPI Strip
- Total Customers: "156"
- New Customers (period): "+12"
- Returning Customers: "34 (22%)"
- Customer Lifetime Value: "£45"

#### Customer Growth Chart
- Line chart: Cumulative customers over time
- New customers per day/week overlay
- Churn indicator (future): Customers who haven't returned in 30 days

#### Customer Segments
- New (first purchase this period)
- Active (purchased and accessed content recently)
- At Risk (purchased but inactive for 30+ days)
- Churned (no activity for 90+ days)
- Segment counts with trend arrows

### 4. Content Performance

#### Top Content Table
- Rank | Content | Views | Purchases | Revenue | Conversion Rate | Avg Watch Time
- Sortable by any column
- Sparkline for views trend (last 7 days)
- "Content Health" indicator: Green (growing), Yellow (stable), Red (declining)

#### Content Funnel
- Views → Preview Watched → Purchase → Completion
- Show conversion rates at each step
- Identify where people drop off
- Per-content or aggregate

#### Engagement Metrics
- Average watch time per content
- Completion rate (% who finish)
- Re-watch rate (% who come back)
- Resource download rate

### 5. Traffic Sources (Future)

- Where do customers come from?
  - Direct, Social (Twitter, Instagram, YouTube), Referral, Search
- UTM parameter tracking
- "Best converting source" highlight

### 6. Geographic Distribution (Future)

- Map showing customer locations
- Top countries/regions
- Currency considerations for pricing strategy

---

## Report Export

- "Export Report" button
- Format: CSV for raw data, PDF for formatted report
- Date range selection for export
- Include: Revenue summary, customer list, content performance

---

## Analytics for Different Roles

### Org Owner / Admin
- Full analytics: Revenue, customers, all content, team performance
- Export capabilities
- Goal setting and tracking

### Creator (Non-Admin)
- Only their own content performance
- Views, purchases, revenue for their items
- No access to customer PII
- No org-wide revenue

---

## Responsive Behavior

### Desktop
- Full dashboard with side-by-side charts
- Interactive chart hover/zoom
- Table with all columns

### Tablet
- Stacked charts
- Scrollable tables
- Simplified KPI strip

### Mobile
- Single column, everything stacked
- Swipeable KPI cards
- Simplified charts (bar → horizontal bar)
- Expandable sections

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Revenue metrics | admin/analytics API | Partial |
| Revenue time series | admin/analytics API | Partial |
| Customer count/growth | admin API | Partial |
| Content views | analytics API | Needs work |
| Purchase funnel | analytics API | Needs work |
| Watch time/completion | progress API aggregated | Needs work |
| Traffic sources | Not built | Future |
| Geographic data | Not built | Future |
| Export | admin API | Partial |

---

## Priority Ideas (Top 5)

1. **Revenue chart** with period selector and previous-period comparison
2. **Top content performance table** with views, purchases, revenue, conversion
3. **KPI strip** with revenue, customers, sales, AOV — all with trend indicators
4. **Customer segments** (new, active, at-risk, churned) with counts
5. **Content funnel visualization** showing views → purchase → completion conversion
