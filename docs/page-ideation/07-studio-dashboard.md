# Org Studio Dashboard — Feature Ideation

**Route**: `{slug}.revelations.studio/studio` → `_org/[slug]/studio/+page.svelte`
**Current state**: Basic stat cards (content count, revenue, customer count). Very sparse.
**Priority**: HIGH — this is the admin's command center. First thing they see every day.

---

## Vision

The studio dashboard should feel like a **mission control** — giving the org admin/creator instant awareness of their business health, what needs attention, and what to do next. Think Shopify dashboard meets YouTube Studio analytics.

It should answer in 5 seconds:
1. How's the business doing? (revenue, growth)
2. What happened recently? (new purchases, new customers)
3. What needs my attention? (drafts to publish, pending reviews)
4. What should I do next? (quick actions)

---

## Dashboard Sections

### 1. Welcome / Status Bar
- "Good morning, {name}" with time-aware greeting
- Current date
- Quick org status: "3 drafts pending • 2 new customers today • £47 revenue today"
- Or: Alert banner if something needs attention (e.g., "Stripe connection expiring")

### 2. Key Metrics Row (KPI Strip)
Four primary stat cards in a row:

| Metric | Detail | Icon |
|--------|--------|------|
| **Revenue** (period) | "£2,340 this month" with % change from last month (green up / red down arrow) | Currency |
| **Customers** | "156 total" with "+12 this month" | Users |
| **Content** | "34 published, 5 drafts" | Film/File |
| **Views / Engagement** | "1,230 views this month" or "45 active students" | Eye/Chart |

Each card clickable → navigates to relevant detail page (analytics, customers, content).

### 3. Revenue Chart
- Line chart showing revenue over time (last 30 days default)
- Toggle: 7 days / 30 days / 90 days / 12 months
- Comparison: "vs previous period" dotted line
- Hover: Show exact amount per day/week
- Below chart: "Best day: £340 on March 15" highlight

### 4. Recent Activity Feed
- Chronological feed of recent events:
  - "Sarah purchased 'Yoga Basics' — £29" (timestamp)
  - "New customer: Emily Jones signed up" (timestamp)
  - "Content 'Advanced Flow' published by Alex" (timestamp)
  - "Team member invited: Tom (Creator)" (timestamp)
- Each item has a small icon indicating type
- "View All Activity" link
- Max 10 items, auto-refreshes

### 5. Quick Actions Grid
- Common tasks as icon + label buttons:
  - "Create Content" → /studio/content/new
  - "Upload Media" → /studio/media
  - "View Analytics" → /studio/analytics
  - "Manage Team" → /studio/team
  - "Edit Branding" → /studio/settings/branding (or live brand editor)
  - "View as Customer" → opens org public page in new tab
- 2x3 grid of action cards
- Each card: Icon + label, hover highlights

### 6. Top Content (This Period)
- Table or ranked list of best-performing content:
  - Rank | Content Title | Views | Purchases | Revenue
- Top 5 items
- "View All" → /studio/analytics
- Helps admin understand what's working

### 7. Pending Actions / To-Do
- Items that need the admin's attention:
  - "3 draft content items ready to publish"
  - "New team join request from Tom" (future)
  - "Stripe payout pending review"
  - "Content 'Meditation Guide' has 0 views — consider promoting"
- Actionable: Each item has a primary action button
- Dismissible once handled

### 8. Customer Insights (Mini)
- "New customers this week: 8"
- "Repeat purchasers: 12 (returning customers who bought 2+ items)"
- "Top customer: Emma Wilson (£340 total spent)"
- Link to /studio/customers for full view

### 9. Content Pipeline (Mini)
- Visual summary of content status:
  - Draft: 5 | Published: 34 | Archived: 3
- Small progress bar or donut chart
- "Oldest draft: 'Breathwork Series' — created 14 days ago" (nudge to publish)

---

## Dashboard Customization Ideas (Future)

### Widget System
- Admin can rearrange dashboard widgets
- Add/remove widgets from a widget gallery
- Save layout preference per user
- Available widgets: Revenue, Activity, Top Content, Calendar, Goals, etc.

### Goals & Targets
- Set monthly revenue target: "Goal: £5,000/month"
- Progress bar: "62% of monthly goal (£3,100)"
- Celebration when goal reached

### Calendar Widget
- Show upcoming events/launches
- "This week: Publishing 'Advanced Yoga' on Thursday"
- Integration with content scheduling (future)

---

## Role-Based Dashboard Variations

### Org Owner / Admin
- Full dashboard with all sections
- Revenue, customers, team management visible

### Creator (Non-Admin)
- Only their own content metrics
- No revenue data (unless revenue sharing is enabled)
- Quick actions: Create Content, Upload Media, View Analytics (own only)
- No team or customer management

---

## Responsive Behavior

### Desktop
- Full 4-column KPI strip
- 2-column layout: Left (60% - chart + content), Right (40% - activity + actions)
- Side-by-side widgets

### Tablet
- 2-column KPI strip (2x2)
- Stacked layout
- Activity feed collapses to compact view

### Mobile
- Single column, everything stacked
- KPI strip: Swipeable horizontal cards
- Chart: Full-width, simplified
- Activity: Condensed list
- Quick actions: 2-column icon grid

---

## Loading & Empty States

### First-Time Dashboard (New Org)
- Welcome wizard / onboarding checklist:
  - [ ] Upload your first video
  - [ ] Create your first content
  - [ ] Set up branding
  - [ ] Connect Stripe
  - [ ] Invite team members
- Progress: "2 of 5 steps complete"
- Each step links to the relevant page

### Loading
- Skeleton stat cards
- Skeleton chart placeholder
- Activity feed shimmer

---

## Data Requirements

| Feature | Data Source | Exists? |
|---------|------------|---------|
| Revenue metrics | analytics/admin API | Partial |
| Customer count | admin API | Yes |
| Content count | content API | Yes |
| Revenue chart data | analytics API (time series) | Partial |
| Recent activity | No activity feed endpoint | Needs work |
| Top content | analytics API (ranked) | Partial |
| Pending actions | aggregated from multiple APIs | Needs work |

---

## Priority Ideas (Top 5)

1. **KPI strip** with revenue, customers, content, engagement — with period comparison
2. **Revenue chart** with time period toggle and trend comparison
3. **Recent activity feed** showing purchases, signups, content updates
4. **Quick actions grid** for common tasks (create content, upload media, view analytics)
5. **Onboarding checklist** for new orgs guiding setup completion
