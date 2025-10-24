# Analytics - Phase 1 PRD

## Feature Summary

Real-time analytics system using Cloudflare Analytics Engine to track content performance, user engagement, revenue metrics, and platform health. Provides creators with actionable insights into their content performance and platform owners with system-wide analytics.

## Problem Statement

The platform requires analytics to:
- Show creators how their content is performing (views, plays, purchases)
- Track revenue and sales patterns
- Monitor platform health and performance
- Understand user engagement and behavior
- Make data-driven decisions about content and features

Without analytics, the platform cannot:
- Answer "how many people watched my video?"
- Show trending content
- Identify revenue opportunities
- Debug performance issues
- Prove ROI to creators

## Goals / Success Criteria

### Primary Goals
1. **Content Analytics** - Track views, plays, watch time for all media
2. **Purchase Analytics** - Monitor sales, revenue, conversion rates
3. **User Analytics** - Understand engagement patterns and behavior
4. **Platform Analytics** - System health, API usage, worker performance
5. **Real-time Dashboard** - Display metrics with < 1 minute lag
6. **Cost Effective** - Run on Cloudflare free tier for small creators

### Success Metrics
- Events tracked within 5 seconds of occurrence
- Dashboard queries return in < 2 seconds
- 99.9% event capture rate (with sampling at scale)
- Support 1M+ events/month on $5/month budget
- Zero database schema changes for new metrics
- Creator sees video view count immediately after playback
- Platform owner sees daily revenue totals
- Geographic distribution data available for all content

## Scope

### In Scope (Phase 1 MVP)

**Content Analytics:**
- Video/audio view counts
- Play events (start, complete, abandoned)
- Watch time / listen time
- Geographic distribution (country/city)
- Device/browser breakdown
- Referrer tracking

**Purchase Analytics:**
- Purchase events
- Revenue tracking (by content, creator, time period)
- Basic conversion metrics (views to purchases)

**Platform Analytics:**
- API endpoint performance
- Worker execution times
- Queue processing metrics
- Error rates
- Database query performance

**Dashboard Features:**
- Metrics display (refreshed on page load)
- Time-based filtering (7 days, 30 days, 90 days)
- Export to CSV
- Basic charts (line, bar, pie, table)

### Explicitly Out of Scope (Phase 1)
- User journey tracking / funnels
- A/B testing framework
- Predictive analytics / ML
- Heatmaps / session replay
- Custom event tracking API
- Real-time alerts/notifications
- Advanced segmentation
- Cohort analysis
- Attribution modeling
- Geographic map visualizations
- Custom date range pickers
- Offering analytics (events, services, programs)

## Cross-Feature Dependencies

### Content Management (Phase 1)
**Dependency**: Track views/plays of content
- Analytics event triggered on media playback
- Content ID associated with all events
- See [Content Management PRD](../content-management/pdr-phase-1.md)

### E-Commerce (Phase 1)
**Dependency**: Track purchases and revenue
- Purchase events written to Analytics Engine
- Revenue data aggregated by content/creator
- See [E-Commerce PRD](../e-commerce/pdr-phase-1.md)

### Admin Dashboard (Phase 1)
**Dependency**: Display analytics in admin UI
- Dashboard queries Analytics Engine
- Charts rendered in admin interface
- See [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md)

### Media Transcoding (Phase 1)
**Dependency**: Track transcoding job metrics
- Job duration, success rate tracked
- Queue processing times monitored
- See [Media Transcoding PRD](../media-transcoding/pdr-phase-1.md)

---

## User Stories & Use Cases

### US-ANALYTICS-001: Content View Tracking
**As a** creator
**I want to** see how many people have viewed my content
**So that** I can understand my audience reach

**Acceptance Criteria:**
- View count increments when video/audio starts playing
- Count displayed in admin dashboard
- Historical view data available (daily, weekly, monthly)
- Geographic breakdown shows top countries

### US-ANALYTICS-002: Revenue Tracking
**As a** creator
**I want to** see total revenue from my content
**So that** I can track earnings and identify best-performing content

**Acceptance Criteria:**
- Purchase events tracked in real-time
- Revenue totals calculated per content item
- Time-based filtering (this month, last month, all time)
- Breakdown by content type (video vs audio)

### US-ANALYTICS-003: Watch Time Analysis
**As a** creator
**I want to** know how long people watch my videos
**So that** I can optimize content length and engagement

**Acceptance Criteria:**
- Watch time tracked per video
- Average watch time calculated
- Completion rate displayed (% who finish video)

### US-ANALYTICS-004: Platform Health Monitoring
**As a** platform owner
**I want to** monitor system performance
**So that** I can identify and fix issues proactively

**Acceptance Criteria:**
- API response times tracked
- Worker execution durations logged
- Error rates monitored by endpoint
- Queue processing delays visible

### US-ANALYTICS-005: Geographic Insights
**As a** creator
**I want to** see where my audience is located
**So that** I can tailor content and timing to my audience

**Acceptance Criteria:**
- Country-level geographic data collected
- City-level data for top locations
- Map visualization in dashboard
- Time zone distribution analysis

---

## Functional Requirements

### FR-ANALYTICS-001: Event Tracking
**Requirement**: System must track comprehensive analytics events across all platform activities

**What We Track:**

**Content Metrics:**
- Video/audio views (unique and total)
- Play events (start, pause, resume, complete)
- Watch/listen time per session
- Content completion rate
- Abandonment points in media
- Content type (video vs audio)

**User Metrics:**
- Anonymous user sessions (via session ID)
- Authenticated user activity (via user ID)
- Geographic location (country and city)
- Device type (mobile, tablet, desktop)
- Browser and OS information
- Referrer source

**Purchase Metrics:**
- Purchase events
- Revenue amount and currency
- Content purchased
- Purchasing user (anonymous or authenticated)
- Purchase timestamp
- Refund events

**Platform Performance Metrics:**
- API endpoint calls
- Response times
- HTTP status codes
- Worker execution times
- Queue processing duration
- Error rates by endpoint

**Requirements:**
- Support tracking of 10M+ events per month
- Events must be captured within 5 seconds of occurrence
- Track both anonymous and authenticated users separately
- Geographic data must not include IP addresses (privacy)
- No personally identifiable information (PII) stored

### FR-ANALYTICS-002: Data Aggregation & Filtering
**Requirement**: Dashboard must provide flexible data aggregation and filtering capabilities

**Required Aggregations:**
- Count (total views, purchases, events)
- Sum (total revenue, watch time, response times)
- Average (average watch time, average response time)
- Group by content, creator, time period, geography, device

**Required Filters:**
- Time range (today, week, month, year, all-time, custom range)
- Content ID or type
- Creator ID
- Event type
- Geographic location (country/city)
- Device type
- User authentication status (anonymous vs authenticated)

**Performance Requirements:**
- Query results returned in under 2 seconds
- Support concurrent dashboard queries from multiple users
- Handle datasets with 100M+ events

### FR-ANALYTICS-003: Dashboard Display
**Requirement**: Admin interface must present analytics in clear, actionable format

**Details:**
- Real-time metric cards (total views, revenue, users)
- Line charts for time-series data
- Bar charts for comparisons
- Pie charts for distribution
- Data tables with sorting/filtering
- CSV export functionality

**Dashboard Sections:**
1. **Overview** - Key metrics at a glance
2. **Content Performance** - Individual content analytics
3. **Revenue** - Sales and earnings data
4. **Audience** - Geographic and demographic insights
5. **Platform Health** - System performance metrics

### FR-ANALYTICS-004: Privacy & Compliance
**Requirement**: Analytics must respect user privacy and comply with regulations

**Details:**
- No PII collected without consent
- IP addresses not stored (only country/city)
- Cookie-less tracking option
- GDPR-compliant data retention
- User opt-out respected
- Data deletion on request

### FR-ANALYTICS-005: Performance Tracking
**Requirement**: System must self-monitor its own performance

**Details:**
- Track Analytics Engine write latency
- Monitor query performance
- Alert on anomalies
- Log sampling rates
- Track event drop rates

---

## Non-Functional Requirements

### NFR-ANALYTICS-001: Performance
- Event ingestion: < 5 seconds from trigger to storage
- Query response: < 2 seconds for dashboard loads
- Dashboard page load: < 1 second
- Support 1000+ concurrent users viewing dashboards
- Handle 100K+ events per minute during traffic spikes

### NFR-ANALYTICS-002: Scalability
- Scale to 100M+ events/month
- No manual intervention for scaling
- Automatic sampling when needed
- Distributed across Cloudflare edge

### NFR-ANALYTICS-003: Reliability
- 99.9% event capture rate
- No data loss during failures
- Graceful degradation under load
- Self-healing if Analytics Engine unavailable

### NFR-ANALYTICS-004: Cost Efficiency
- Free tier: Support 100K events/month ($0/month)
- Low tier: Support 10M events/month ($5/month)
- Scale tier: Support 100M events/month ($50/month)
- No database costs (Analytics Engine handles storage)

### NFR-ANALYTICS-005: Data Retention
- Raw events: 90 days
- Aggregated data: 2 years
- Automatic cleanup of old data
- Export option before deletion

---

## User Experience

### Content Creator Flow
1. **Login to Admin Dashboard**
2. **Navigate to Analytics tab**
3. **See Overview**: Total views, revenue, watch time
4. **Filter by date range**: "Last 30 days"
5. **View content list**: Sorted by views
6. **Click specific video**: See detailed metrics
7. **Check geographic distribution**: Top countries listed
8. **Export data**: Download CSV for external analysis

### Platform Owner Flow
1. **Access Admin Dashboard**
2. **View Platform Health section**
3. **Check API performance**: Response times, error rates
4. **Monitor workers**: Execution times, queue depths
5. **Review revenue**: Platform-wide earnings
6. **Identify issues**: High error rates on specific endpoints
7. **Take action**: Investigate and fix performance problems

---

## Technical Considerations

> **Note**: For detailed technical implementation, see the [Technical Design Document (TDD)](./ttd-dphase-1.md)

### Architecture Overview

![Analytics Architecture](./assets/analytics-architecture.png)

For the full architecture diagram and implementation details, see the [TDD](./ttd-dphase-1.md#architecture-overview).

### Why Cloudflare Analytics Engine?

**Advantages:**
- **Cost**: $5/month for 10M events (competitors: $50-100/month)
- **Scale**: Handles spikes without configuration
- **Integration**: Native Cloudflare Workers support
- **Performance**: Global edge network
- **Simplicity**: No database to manage

**Limitations:**
- **Sampling**: High-volume data may be sampled (affects accuracy at scale)
- **Schema**: Fixed schema with three field types:
  - **Blobs** (strings): For dimensions/labels (browser, country, content_id, etc.)
  - **Doubles** (numbers): For numeric values (revenue, duration, response_time, etc.)
  - **Indexes** (strings): For sampling keys (one per event)
- **Retention**: 90 days for raw events (free tier in open beta)
- **Query language**: SQL dialect with specific functions (not full PostgreSQL)
- **Write-only from Workers**: Can only write from Cloudflare Workers (not external APIs)
- **Automatic timestamp**: Each event gets a timestamp field automatically
- **Non-blocking writes**: `writeDataPoint()` returns immediately (fire-and-forget)

**Alternatives Considered:**
- **Tinybird**: More features, 10x cost
- **PostHog**: Open source, requires self-hosting
- **Self-hosted ClickHouse**: Complex infrastructure
- **Postgres**: Not designed for analytics scale

### Event Collection Strategy

**Client-Side Events** (video views, plays):
- JavaScript tracking snippet on player
- Batches events to reduce requests
- Respects Do Not Track
- Falls back gracefully if blocked

**Server-Side Events** (purchases, API calls):
- Workers write directly to Analytics Engine
- No client involvement
- 100% capture rate
- Includes auth context

### Data Pipeline

```
[Browser/API] � [Worker] � [Analytics Engine] � [Dashboard]
     �
[Batch Events] � [Queue] � [Worker] � [Write to AE]
```

**Write Path:**
1. Event triggered (view, purchase, etc.)
2. Worker receives event
3. Validate and transform data
4. Write to Analytics Engine (async)
5. Return success to client

**Read Path:**
1. Dashboard loads
2. Query Analytics Engine via API
3. Aggregate data (sums, averages, etc.)
4. Transform to chart-ready format
5. Render in UI

### Data Accuracy

**Sampling Behavior:**
- < 100K events/month: No sampling (100% accurate)
- 100K - 1M events/month: Light sampling (~95% accurate)
- 1M - 10M events/month: Moderate sampling (~90% accurate)
- 10M+ events/month: Heavier sampling (~85% accurate)

**Deduplication:**
- Session-based deduplication for views
- Transaction IDs for purchases (no duplication)
- Idempotent writes where possible

---

## Success Metrics (Measurable)

### Product Metrics
- **Adoption**: 90% of creators view analytics weekly
- **Engagement**: Average 5+ minutes per analytics session
- **Export**: 20% of creators export data monthly

### Technical Metrics
- **Latency**: P95 event ingestion < 5 seconds
- **Query Performance**: P95 query response < 2 seconds
- **Uptime**: 99.9% analytics availability
- **Cost**: < $50/month for 100M events

### Business Metrics
- **Creator Satisfaction**: 8/10 rating for analytics features
- **Data-Driven Decisions**: Creators adjust content based on metrics
- **Support Reduction**: 30% fewer "how many views?" questions

---

## Risks & Mitigations

### Risk: Analytics Engine Sampling
**Impact**: Creators see approximate numbers, not exact counts
**Mitigation**:
- Clearly communicate sampling in UI
- Show confidence intervals
- Exact counts for purchases (critical data)
- Upgrade plan for exact counts if needed

### Risk: Event Loss During Outages
**Impact**: Missing analytics data during Cloudflare issues
**Mitigation**:
- Queue events in browser/worker if AE unavailable
- Retry failed writes
- Log dropped events for manual recovery

### Risk: Query Performance at Scale
**Impact**: Slow dashboards with large datasets
**Mitigation**:
- Pre-aggregate common queries
- Cache frequently accessed data
- Limit query time ranges
- Pagination for large result sets

### Risk: Privacy Violations
**Impact**: Regulatory fines, user trust loss
**Mitigation**:
- No PII in events
- Cookie consent for tracking
- Easy opt-out mechanism
- Regular privacy audits

---

## Creator Analytics Needs & Minimum Viable Chart Set

Based on the platform overview, creators in Phase 1 need analytics for:
- **Content** (videos, audio)
- **Monetization** (direct purchases)
- **Audience understanding** (anonymous vs authenticated users)

### What Creators Need to Understand

#### 1. Content Performance Questions
- "Which of my videos/audio are most popular?"
- "How much watch time am I getting?"
- "Are people finishing my content or dropping off?"
- "Where is my audience located?"
- "What devices are they using?"

#### 2. Revenue Questions
- "How much money did I make this week/month?"
- "Which content generates the most revenue?"
- "Is my revenue growing or declining?"

#### 3. Engagement Questions
- "How many people visited my platform?"
- "What's my conversion rate (visitor → purchase)?"

#### 4. Audience Questions
- "Who is my audience (geography, devices)?"
- "Anonymous vs logged-in traffic patterns?"
- "What brings people to my platform (referrers)?"

#### 5. Business Health Questions (Platform Owner)
- "Is my platform performing well (API speed, errors)?"
- "What are my platform-wide metrics?"

### Minimum Viable Chart Set for Phase 1

Based on these questions, here's the **essential chart set** that provides maximum insight with minimal complexity:

#### **Overview Dashboard** (First thing creators see)

**Metric Cards** (No charts, just big numbers)
- Total views (last 30 days)
- Total revenue (last 30 days)
- Total purchases (last 30 days)
- Total watch time (last 30 days)

**Chart 1: Revenue Over Time** (Line Chart)
- X-axis: Time (daily for last 30 days)
- Y-axis: Revenue in USD
- Why: Answers "Is my business growing?" at a glance

**Chart 2: Views Over Time** (Line Chart)
- X-axis: Time (daily)
- Y-axis: Number of views
- Why: Shows content engagement trends

#### **Content Analytics** (Dedicated section)

**Chart 3: Top Content by Views** (Horizontal Bar Chart)
- X-axis: Number of views
- Y-axis: Content titles (top 10)
- Why: Quickly identify best-performing content
- Clickable: Links to individual content detail page

**Chart 4: Top Content by Revenue** (Horizontal Bar Chart)
- X-axis: Revenue generated
- Y-axis: Content titles (top 10)
- Why: Shows which content makes money
- Different from views - low-view, high-price content appears here

**Data Table: All Content Performance**
- Columns: Title, Type (video/audio/post), Views, Watch Time, Revenue, Purchases
- Sortable by any column
- Searchable/filterable
- Why: Detailed view for finding specific content
- CSV export available

#### **Audience Analytics** (Dedicated section)

**Chart 5: Geographic Distribution** (Simple List/Table)
- Shows: Top 10 countries with view counts and percentage
- Why: Simple, clear data presentation

**Chart 6: Device Breakdown** (Donut/Pie Chart)
- Segments: Desktop, Mobile, Tablet
- Shows percentages and counts
- Why: Simple distribution visualization, useful for responsive design decisions

**Data Table: Traffic Sources**
- Columns: Referrer, Visits
- Why: Understand where traffic comes from

#### **Platform Health** (Platform Owner only)

**Metric Cards**
- Average API response time (last 24 hours)
- Error rate (last 24 hours)
- Total active users
- Queue processing delay

**Chart 7: API Response Times** (Line Chart)
- X-axis: Time (hourly for 24 hours)
- Y-axis: Response time in milliseconds
- Why: Detect performance degradation

**Data Table: Error Rates by Endpoint**
- Columns: Endpoint, Total Calls, Errors, Error Rate
- Why: Identify problematic endpoints quickly

---

### Chart Type Summary

**For Phase 1 MVP, we need:**

1. ✅ **Line Charts** (3 total)
   - Revenue over time
   - Views over time
   - API response times (platform owner)

2. ✅ **Horizontal Bar Charts** (2 total)
   - Top content by views
   - Top content by revenue

3. ✅ **Pie/Donut Chart** (1 total)
   - Device breakdown

4. ✅ **Metric Cards** (Big numbers, no chart visualization)
   - Used throughout for quick stats

5. ✅ **Data Tables** (3 total)
   - All content performance
   - Traffic sources
   - Error rates by endpoint

**Total unique chart types needed: 4** (Line, Bar, Pie, Table)

**Explicitly NOT in Phase 1:**
- ❌ Geographic maps
- ❌ Heatmaps
- ❌ Funnel visualizations
- ❌ Cohort retention charts
- ❌ Real-time live dashboards
- ❌ Custom date range picker
- ❌ Offering analytics (events, services, programs, credits)
- ❌ Subscription tracking
- ❌ Advanced conversion funnels
- ❌ Percentile calculations (P50/P95/P99)

---

### Why This Chart Set?

**Principles:**
1. **Answers core questions** - Every chart directly answers a creator's key question
2. **Actionable insights** - Data leads to decisions (what content to make more of, which offerings to promote)
3. **Simple to implement** - 4 chart types, reusable components
4. **Scales to Media Owners** - Same charts work for individual creators (filtered to their content)
5. **Fast to load** - Minimal queries, pre-aggregated where possible

**What creators can do with this data:**
- Identify best content → create more like it
- Find underperforming content → improve or remove
- Understand audience → optimize content format
- Track revenue trends
- Make platform faster → fix slow endpoints

---

## Open Questions

1. **Should we track anonymous users or require login?**
   - **DECISION**: Track both anonymous (via session ID) and authenticated users (via user ID). Anonymous users should be separately identifiable from authenticated users to track conversion journeys and increase conversion rates based on anonymous user behavior patterns.

2. **How much historical data should dashboard show by default?**
   - **DECISION**: Last 30 days by default, with dropdown options for: Today, Last 7 Days, Last 30 Days, Last 90 Days, All Time, Custom Range

3. **Do we need real-time alerts for metric thresholds?**
   - **DECISION**: Not Phase 1. Evaluate after launch based on user feedback and usage patterns.

4. **Should creators see platform-wide analytics or just their content?**
   - **DECISION**: Creators see only their own content analytics. Platform owners see system-wide analytics including all creators' data.

5. **What's the minimum viable chart set for MVP?**
   - **DECISION**: See "Creator Analytics Needs & Minimum Viable Chart Set" section below

6. **How do we handle database storage limits?**
   - **DECISION**: Analytics Engine provides 90-day raw retention (open beta, free)
   - Approach: Aggregate historical data into PostgreSQL for 2+ year retention
   - Export: CSV export functionality for any time range within retention
   - Note: Implementation details in TDD

7. **What retention policy should we implement?**
   - **DECISION**: 90 days raw events, 2 years aggregated data
   - Creators can export data before expiry
   - Platform owner sees all-time aggregated metrics

---

## Appendix

### Sample Event Payloads

**Video View Event:**
```json
{
  "timestamp": 1704067200000,
  "event_type": "view",
  "content_id": "content_abc123",
  "content_type": "video",
  "creator_id": "creator_xyz789",
  "user_id": "user_def456",
  "session_id": "sess_random_id",
  "country": "US",
  "city": "San Francisco",
  "device_type": "desktop",
  "browser": "Chrome",
  "os": "macOS"
}
```

**Purchase Event:**
```json
{
  "timestamp": 1704067200000,
  "event_type": "purchase",
  "content_id": "content_abc123",
  "user_id": "user_def456",
  "amount": 1999,
  "currency": "USD",
  "session_id": "sess_random_id",
  "country": "US"
}
```

**API Call Event:**
```json
{
  "timestamp": 1704067200000,
  "event_type": "api_call",
  "endpoint": "/api/content/list",
  "response_time": 45,
  "status_code": 200,
  "user_id": "user_def456"
}
```

### Reference Architecture

```
             
   Browser   
      ,      
        Track event
       �
             
   Worker           � Analytics Engine
  (Tracker)           (Cloudflare)
             

             
   Admin     
  Dashboard  
      ,      
        Query
       �
             
   Worker           � Analytics Engine
  (API)       �       (Read queries)
             
```

---

**Document Status**: Draft v1.0
**Last Updated**: 2025-01-24
**Owner**: Platform Team
**Stakeholders**: Creators, Platform Owner, Engineering
