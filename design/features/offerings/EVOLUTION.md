# Offerings & Bookings: Long-Term Evolution

**Purpose**: This document defines the complete evolution of the Offerings system (events, services, programs, retreats) from Phase 2 through Phase 4+. Phase 1 focuses on digital content only. This document covers offering types, scheduling, capacity management, customer portals, and revenue integration.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Part 1: Core Principles

### Design Philosophy

1. **Unified offering model** - Events, services, and programs share same system, not separate features
2. **Flexible scheduling** - Support one-time, recurring fixed, and on-demand bookable offerings
3. **Dedicated customer portal** - Each offering has engagement-specific hub with all resources, communication, scheduling
4. **Organization-scoped** - All offerings belong to one organization, with access controlled per org
5. **Non-technical creation** - Organization owner needs no technical knowledge to create/manage
6. **Revenue integration** - Seamless pricing, payment processing, credit system integration
7. **Scalable design** - Supports 1-on-1 services, small groups, large events, and unlimited attendees

### Offering Concept

An **Offering** is any interactive, scheduled engagement between organization and customer(s). Unlike passive content (videos, articles), offerings involve:

- Scheduled sessions (one-time or recurring)
- Live interaction (video calls, in-person, livestream)
- Associated resources (content, files, materials)
- Dedicated customer portal for engagement-specific hub
- Communication channels (messaging, group chat, announcements)
- Capacity management and waitlists
- Attendance tracking and progress

---

## Part 2: Phase Evolution

### Phase 1: Digital Content Foundation (Out of Scope for Offerings)

**When**: MVP launch
**Scope**: Video, audio, and written content only

Offerings system does not launch in Phase 1. Phase 1 focuses exclusively on:
- Digital content monetization (video, audio, written)
- Direct purchases and subscriptions for content
- Content access control and delivery
- Basic content discovery and browsing

---

### Phase 2: Foundation (Basic Offering Management)

**When**: 6-9 months after Phase 1
**Scope**: Single offering types, fixed scheduling, basic customer portal

#### Phase 2 Offering Types

**1. One-Time Event**
- Single scheduled occurrence (webinar, workshop, concert, masterclass)
- Capacity: 1-on-1, small group, large group, or unlimited
- Example: "Intro to Meditation Workshop - March 15th, 7pm"

**2. Multi-Day Event/Program**
- Spans multiple days with defined schedule
- Example: "5-Day Yoga Retreat - June 10-14"
- Example: "21-Day Transformation Program" with check-ins

**3. Recurring Service - Fixed Schedule**
- Ongoing engagement with predefined recurring schedule
- Example: "Weekly Group Coaching - Every Tuesday at 6pm"
- Example: "Monthly Healing Circle - First Saturday of each month"

**4. Recurring Service - Bookable**
- Customer books individual sessions from creator's availability
- Example: "1-on-1 Therapy Sessions" (customer picks from available times)
- Example: "Personal Training" (book 2x/week from available slots)

#### Phase 2 Offering Configuration

**Basic Information**
- Offering name, description, category
- Hero image and gallery
- Creator/facilitator assignment
- Tags for searchability

**Scheduling**
- For events: Date, time, duration, timezone, registration deadline
- For multi-day: Start/end dates, session schedule, breaks
- For recurring fixed: Recurrence pattern (weekly, bi-weekly, monthly), fixed times
- For recurring bookable: Available time slots, booking window, cancellation policy

**Capacity & Participants**
- Capacity type: 1-on-1, small group (2-10), large group (10-100), unlimited
- Waitlist enabled/disabled

**Delivery Method**
- Online (auto-generate Zoom/Meet links)
- In-person (location details)
- Hybrid (both options)
- Self-guided (for programs without live sessions)

**Pricing & Access**
- Direct purchase price (optional, can be free)
- Bookable with credits (if yes, credit cost)
- Included in subscription tiers
- Refund policy and cancellation terms

#### Phase 2 Customer Portal

**Structure**: Dedicated hub for each registered/booked customer

**Portal Sections**
- **Schedule**: Calendar view of sessions, sync to customer's calendar
- **Join/Location**: Video conference links or in-person location details
- **Resources**: Curated content library specific to this offering (pre-selected existing content, uploaded files, time-gated content)
- **Communication**: Direct messaging with creator (1-on-1) or group chat (groups), announcements feed
- **Notes & Progress**: Customer notes, progress tracking, recordings (if enabled)

**Portal Access**
- Active during engagement + X days after (configurable)
- Creator can set permanent or time-limited access

#### Phase 2 Implementation Approach

Offerings stored in database with organization scope. Each offering tracks:
- Basic metadata (name, description, type)
- Schedule information (dates, times, recurrence rules if applicable)
- Capacity and participant tracking
- Pricing and access rules
- Resource associations (which content pieces are included)

Customer portal generated dynamically based on offering configuration and customer's access status. Session records track customer participation, attendance, completion.

---

### Phase 3: Enhanced Offerings (Cohorts, Advanced Scheduling)

**When**: 9-12 months after Phase 2
**New Capabilities**: Cohort-based programs, enhanced scheduling, payment plans

#### Phase 3 Offering Additions

**Cohort Management** (New)
- Structured multi-week program with defined curriculum
- Customers join specific cohorts with start/end dates
- Example: "8-Week Mindfulness Course - Cohort starting April 1st"
- Cohort progress tracking (all students move through content together)

**Advanced Scheduling** (New)
- Payment plans for expensive offerings (e.g., pay $500/month over 3 months)
- Flexible rescheduling policies (allow customers to move between dates/times)
- Buffer time between sessions (avoid back-to-back bookings)
- Blackout dates (creator unavailable)

**Session Recording & Playback** (New)
- Recordings available to students during engagement
- Archive access after engagement ends (configurable)
- Video processing for multi-session offerings

**Enhanced Capacity Management** (New)
- Oversold sessions (allow signups beyond capacity, manage with waitlist)
- Upsell waitlist customers to next available session
- Capacity by participant type (e.g., "2 student spots + 1 staff spot")

#### Phase 3 Database Concepts

Cohort tracking:
- Offerings can have multiple cohorts (same offering, different start dates)
- Cohort membership (which customers belong to which cohort)
- Progress tracking (which session each customer attended)

Session recordings:
- Reference from offering to recording storage (R2)
- Metadata (duration, processing status)
- Access control (who can view)

Payment plans:
- Split offering price across multiple installments
- Track payment schedule and customer compliance

---

### Phase 4+: Advanced Features (Content Gating, Advanced Portal, Enterprise)

**When**: 12+ months after Phase 2
**Scope**: Structured learning paths, advanced communication, progress tracking, personalization, enterprise integrations

#### Phase 4 Offering Additions

**Curriculum & Content Gating** (New)
- Offerings organized as structured curriculum
- Content unlocks at specific milestones or dates
- Example: "Week 1 materials unlock on Monday, Week 2 on the following Monday"
- Prerequisites between offerings (complete Course A before taking Course B)

**Advanced Portal Features** (New)
- **Assignments & Homework**: Creator posts assignments, customers submit, creator provides feedback
- **Discussion Forum**: Per-offering conversation threads
- **Certificates**: Automatic or manual issuance upon completion
- **Badges & Achievements**: Unlock badges for milestones (attend all sessions, complete assignments, etc.)
- **Peer Interaction**: See other participants (if enabled), create study groups

**Advanced Communication** (New)
- Scheduled announcements (send on specific dates/times)
- Conditional notifications (send when customer falls behind, completes milestone)
- Broadcast to specific cohort subsets

**Analytics & Progress** (New)
- Creator dashboard showing attendance per session
- Engagement metrics (time in portal, assignments completed, forum posts)
- Completion rates and dropoff points
- Individual student progress reports

**Personalized Learning Paths** (New)
- AI-generated custom curricula based on student goals
- Branching paths (different content based on student choices)
- Adaptive pacing (speed up/slow down based on progress)

**Advanced Automations** (New)
- Workflow builder (create rules like "if student misses 2 sessions, send reminder email")
- Auto-assign students to follow-up offerings based on completion
- Automatic upsells (recommend next course after completion)

**Enterprise Integration** (New)
- Integration with external calendar systems (Outlook, Google Calendar)
- Zoom/Meet native integration (no manual link generation)
- Export student data and attendance records
- Bulk import of students and schedules

**Advanced Availability** (New)
- Student-submitted availability (suggest times that work for group)
- Timezone-aware scheduling (automatically suggest customer's local time)
- Capacity optimization (auto-schedule overflow sessions when nearly full)

**Scale & Multi-Creator** (New)
- Assign multiple facilitators to single offering
- Teaching assistant roles (partial facilitator access)
- Facilitator handoff (transition students between facilitators)

---

## Part 3: Offering Portal Architecture

### Portal Structure

Each offering has a dedicated customer-facing portal that serves as the engagement hub.

**Portal Composition**:
- **Navigation**: Tab/section menu for quick access
- **Header**: Offering name, facilitator info, progress indicator (if applicable)
- **Content Sections**: Dynamic based on offering type and configuration

### Phase 2 Portal Sections

**Schedule**
- Calendar view of all sessions
- Sync to customer's calendar (iCal export)
- Upcoming vs past sessions
- Session details (time, duration, facilitator notes)

**Join/Location**
- For online offerings: Clickable video conference link (Zoom, Google Meet, etc.)
- For in-person: Location address, map, directions, parking info
- For hybrid: Both options clearly labeled
- Join button available 15 minutes before session

**Resources**
- Content library curated for this offering
- Pre-selected existing content (videos, audio, posts)
- Uploaded files (PDFs, worksheets, recordings)
- Time-gated content (shows when milestone is reached)
- Organized by category or week

**Communication**
- Direct messaging (for 1-on-1) or group chat (for groups)
- Message history accessible during and after engagement
- Creator can pin announcements
- Notification settings (email notifications on/off)

**Notes & Progress**
- Customer's personal notes section
- Progress tracker (e.g., "3 of 8 sessions completed", progress bar)
- Session recordings (if available)
- Homework or assignments (Phase 4+)

### Portal Access Control

Portal visible to:
- Customer who booked/purchased offering
- Facilitator(s) of offering
- Organization admins

Portal access duration:
- Begins: When customer registers or booking is confirmed
- Ends: Configurable (during engagement + X days after, permanent, or time-limited)
- Post-engagement: Creator can disable access to live elements (chat, booking links) while keeping resources available

---

## Part 4: Scheduling & Calendar System

### Scheduling Concepts

**One-Time Events**
- Single date/time occurrence
- Timezone-aware (convert to customer's local time)
- Registration deadline (prevent last-minute signups)

**Multi-Day Programs**
- Date range with sessions distributed across days
- Session schedule defined (e.g., "9am-11am daily", "MWF 6pm-7pm")
- Breaks and rest days

**Recurring Fixed Schedule**
- Recurrence pattern (weekly, bi-weekly, monthly)
- Fixed times (e.g., "Every Tuesday at 6pm")
- End date or infinite
- Skip/override individual occurrences

**Recurring Bookable**
- Creator defines availability slots (e.g., "Mon-Fri 9am-5pm, 1-hour slots")
- Customer books from available slots
- Auto-prevent double-booking
- Automatic rescheduling (if customer cancels, slot reopens)

### Calendar Logic

Offerings integrate with customer's personal calendar:
- iCal export for sync to Google Calendar, Outlook, Apple Calendar
- Automatic reminders (configurable by customer)
- Conflict detection (warn if booking overlaps with existing calendar)

---

## Part 5: Capacity & Participant Management

### Capacity Types

**1-on-1 Service**
- Only one customer per session occurrence
- No capacity concerns

**Small Group (2-10)**
- Fixed number of spots available
- Waitlist available if full
- Group dynamics important (avoid adding customer late)

**Large Group (10-100)**
- Can accommodate many participants
- Waitlist support
- Participant list visibility (configurable)

**Unlimited**
- Webinars, livestream events (no practical capacity limit)
- Everyone welcome
- Scale to thousands if needed

### Waitlist Management

When offering at capacity:
- New signups automatically added to waitlist
- Ordered by signup time
- Automatic promotion (when spot opens, next waitlisted customer offered spot)
- Notification when spot becomes available
- Customer can decline and stay on waitlist

### Capacity Tracking

Creator can see:
- Total capacity
- Current signups
- Waitlist count
- Cancellations/no-shows
- Attendance rate per session

---

## Part 6: Revenue & Pricing Integration

### Pricing Models

**Direct Purchase**
- One-time payment for access to offering
- Can be one-time event or offering series
- Integrated with E-commerce system

**Subscription Inclusion**
- Offering included in specific subscription tier(s)
- Example: "Yoga Tier includes access to all group classes"
- No additional payment needed by subscriber
- Access tied to subscription validity

**Credit-Based Booking**
- Customer spends credits (from subscription or credit pack) to book
- Creator defines credit cost (e.g., "1-on-1 session costs 1 credit")
- Integrated with Credits system
- Credits deducted at booking confirmation

**Payment Plans** (Phase 3+)
- Split expensive offering price across multiple installments
- Example: "$500 offering = $200 now + $150 in 2 weeks + $150 in 4 weeks"
- Track payment schedule and compliance
- Suspend access if payment late

### Revenue Attribution

Bookings are attributed to offering and tracked for:
- Revenue reports (how much revenue from each offering)
- Creator/facilitator earnings (if applicable in Phase 2+)
- Analytics (conversion rates, popularity)

---

## Part 7: Security & Access Control

### Offering-Level Access

**Who can see offering:**
- Published offerings: Any authenticated customer
- Private offerings: Only invited customers
- Subscription-included: Only active subscribers of that tier

**Who can create offering:**
- Organization owner
- Organization admin (Phase 3+)
- Designated creator if invited (Phase 3+)

**Who can manage offering:**
- Creator/facilitator
- Organization owner
- Organization admin

### Portal Access Control

**Customer Portal Access**:
- Only accessible to registered/booked customers
- View own portal (cannot see other customers' portals)
- Access restricted to offering's active period + configured post-engagement window

**Facilitator Portal Access**:
- Full access to manage offering
- See all customer registrations and progress
- Access to communication, attendance, feedback

---

## Part 8: Related Documentation

- **Auth EVOLUTION**: [authentication/EVOLUTION.md](../auth/EVOLUTION.md)
- **Content Access EVOLUTION**: [content-access/EVOLUTION.md](../content-access/EVOLUTION.md)
- **Admin Dashboard EVOLUTION**: [admin-dashboard/EVOLUTION.md](../admin-dashboard/EVOLUTION.md)
- **Platform Settings EVOLUTION**: [platform-settings/EVOLUTION.md](../platform-settings/EVOLUTION.md)
- **Payments EVOLUTION**: [e-commerce/EVOLUTION.md](../e-commerce/EVOLUTION.md) (forthcoming)
- **Credits System**: [credits/EVOLUTION.md](../credits/EVOLUTION.md) (forthcoming)

---

## Conclusion

Offerings evolve from simple event scheduling (Phase 2) to sophisticated cohort-based learning platforms with advanced analytics and personalization (Phase 4+). Phase 1 focuses exclusively on digital content monetization. At each offering phase:

- Unified system handles all offering types (events, services, programs)
- Customer portal remains the engagement hub with expanding capabilities
- Scheduling remains flexible (one-time, recurring, bookable)
- Pricing seamlessly integrates with subscription and credit systems
- Organization isolation is maintained throughout
- Non-technical creators can manage all aspects without code

This foundation enables Phase 2 launch of event/service management while supporting complex cohort-based learning and enterprise integrations in future phases.
