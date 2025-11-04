# Overview

This is the high-level requirements document for a white-label creator platform. This document captures the core business requirements and stakeholder needs that will drive all technical design and implementation decisions.

## Purpose

Define the highest-level requirements for a multi-stakeholder platform that enables creators to monetize their knowledge through an upsell funnel: consumable media → events → one-on-one services.

## Platform Vision

A creator knowledge hub where non-technical platform owners can build a complete business ecosystem including:

- Content monetization (videos, audio, written content)
- Event hosting (live streaming, in-person)
- Service booking (appointments, recurring sessions)
- Multi-creator marketplace with revenue sharing

The platform creates a customer journey from passive content consumption to active personal engagement with creators.

# Core Business Requirements

## 1. Multi-Stakeholder Role-Based Access

The platform must support four distinct user types with appropriate permissions and capabilities.

## 2. Content Management & Monetization

Enable creation, organization, and sale of multiple media types with flexible pricing and bundling options.

## 3. Offering Management System

Support creation and delivery of all purchasable engagements (events, services, programs, retreats) through a unified system with dedicated customer portals for each engagement.

## 4. Flexible Monetization Model

Support multiple access methods: direct purchases, category-based subscription tiers with credits, and progressive pricing to drive customer engagement from low-commitment entry to high-value relationships.

## 5. Revenue Sharing Infrastructure

Implement payment processing with automatic revenue splits between Platform Owner and Media Owners via Stripe Connect.

## 6. Non-Technical User Experience

All platform management must be accessible to users without technical knowledge.

## 7. Content Delivery Infrastructure

Reliable streaming and file delivery for video, audio, and document content.

## 8. Authentication & Authorization

Secure user authentication with role-based access control and payment account integration.

## 9. Customer Purchase & Access

Complete e-commerce flow for browsing, purchasing, and accessing content and offerings with clear visibility into subscription benefits and credit balances.

# Stakeholders

The platform serves four distinct user types, each with specific needs and access levels.

## 1. Platform Owner (You - System Owner)

**Role**: System administrator
**Scope**: System-wide
**Access**: Full system access, all organizations, configurations, deployments

**Description**: The developer/owner (you) responsible for platform deployment, maintenance, and system-level configuration. You have access to the entire system and can manage all organizations.

**Authentication**: `user.role = 'platform_owner'` (platform level)

**Platform 1 Note**: In Phase 1, there is one organization and you operate it. Phase 2+ allows creating additional organizations.

## 2. Organization Owner (Business Owner)

**Role**: Organization administrator
**Scope**: Single organization (or multiple in Phase 2+)
**Access**: Full administrative access to their organization's content, team, users, and business operations

**Description**: The non-technical business owner who operates their organization (e.g., yoga studio, coaching business). They manage their entire business without technical knowledge. In Phase 1, you may also be the organization owner.

**Authentication**: `user.role = 'customer'` (platform level) + `organization_member.role = 'owner'` (org level)

**Phase 2+**: Organization owners can own multiple organizations.

## 3. Organization Admin (Staff)

**Role**: Organization staff with elevated permissions
**Scope**: Single organization
**Access**: Content management, team management, customer support, analytics (within their org)

**Description**: Staff members invited to help manage the organization. They can approve content, manage team members, and view analytics, but cannot change organization settings.

**Authentication**: `user.role = 'customer'` (platform level) + `organization_member.role = 'admin'` (org level)

## 4. Creator (Guest Creators - Phase 2+)

**Role**: Content creator
**Scope**: Multiple organizations (freelancer model)
**Access**: Create and manage own content, view own earnings, accept organization invitations

**Description**: Freelance creators invited to contribute content to one or more organizations. In Phase 1, they are "members" invited by the organization owner. In Phase 2+, they upgrade to "creator" role and can belong to multiple organizations, receiving payments through Stripe Connect.

**Authentication**: `user.role = 'customer'` (platform level) + `organization_member.role = 'member'` → `'creator'` in Phase 2

## 5. Customers/Subscribers (End Users)

**Role**: Content consumer
**Scope**: None (purchase from organizations)
**Access**: Public content browsing, purchased content access, offering registration, booking management

**Description**: End consumers who purchase and consume content, attend events, and book services. They do NOT need to be organization members; they simply purchase content from the platform. They represent the core revenue source and should receive the best user experience.

**Authentication**: `user.role = 'customer'` (platform level) + NO organization membership

## 6. Guests (Unauthenticated)

**Role**: Visitor
**Scope**: Public content only
**Access**: Browse public content, view details, proceed to login/register for purchase

**Description**: Unauthenticated visitors browsing the platform. They can see public content but must create an account to purchase.

---

# Stakeholder Requirements

**See [Authentication & Authorization - EVOLUTION.md](./features/auth/EVOLUTION.md) for detailed auth architecture and phase evolution.**

## 1. Platform Owner Requirements

### R1.1 System Administration

- Full access to all system configurations
- Database management and backup capabilities
- Deployment and environment management
- Monitoring and logging access
- User role and permission management

### R1.2 Development & Maintenance

- Code repository access
- API and integration management
- Security updates and patches
- Performance optimization capabilities

### R1.3 Support & Troubleshooting

- Ability to impersonate users for support
- Access to all error logs and diagnostics
- Database query capabilities for issue resolution

---

## 2. Platform Owner Requirements

### R2.1 Content Management

**Requirement**: Create, edit, publish, and organize all content types without technical knowledge

**Capabilities**:

- Upload and manage video content with metadata (title, description, tags, thumbnail)
- Upload and manage audio content with playback controls
- Create and format written content/blog posts with rich text editor
- Organize content into series, collections, or courses
- Set content visibility (public, private, members-only)
- Schedule content publication
- Preview content before publishing

**Success Criteria**: Platform Owner can upload a video, organize it into a series, and publish it in under 5 minutes without assistance.

### R2.2 Pricing & Monetization

**Requirement**: Create a flexible monetization system that supports individual purchases, subscription tiers, and credit-based access to drive progressive customer engagement from low-commitment entry points to high-value relationships.

#### Access Model Overview

The platform supports three primary ways customers can access content and offerings:

1. **Direct Purchase**: One-time payment for permanent access to specific content or participation in specific offerings
2. **Subscription Tiers**: Recurring payment for ongoing access to categories of content, offerings, and/or monthly credits
3. **Credits**: Redeemable tokens (earned through subscriptions or purchased) that can be spent on bookable offerings

#### Detailed Capabilities

**Direct Purchase Management**

- Set individual prices for any content or offering
- Offer content/offerings for free (promotional or lead magnets)
- Create one-time bundles (e.g., "All meditation videos" for $99)
- Set early-bird pricing for offerings with scheduled dates
- Configure limited-time pricing promotions

**Subscription Tier Configuration**
Platform Owner can create multiple subscription tiers, each defining:

_Access to Content Categories_

- Grant access to all content in specific categories (e.g., "Yoga Tier" includes all yoga videos)
- Grant access to all content across all categories (VIP tier)
- Mix and match category access per tier

_Access to Offerings_

- Include specific offering types (e.g., "free access to all live workshops")
- Include all offerings up to a certain capacity (e.g., "join any group session")
- Include specific offerings by name

_Monthly Credits_

- Grant credits monthly that can be spent on bookable offerings
- Examples:
  - "2 therapy session credits per month" (2 credits = 2 one-on-one sessions)
  - "5 class credits per month" (use for any group class)
- Define credit expiration rules (expire monthly, rollover, accumulate)
- Define which offerings can be booked with credits vs requiring payment

_Pricing Options_

- Monthly vs annual billing (with annual discount option)
- Introductory pricing for first month/year
- Free trial periods (7 days, 30 days)
- Family/group pricing (one subscription, multiple user accounts)

**Credit System**

- Customers can purchase credit packs (e.g., "10 class credits for $150")
- Subscription tiers grant credits monthly
- Platform Owner defines credit value for each offering (e.g., "1-on-1 yoga = 1 credit", "retreat day = 3 credits")
- Credits create urgency ("use them or lose them") and exclusivity
- Credit balance visible in customer dashboard
- Notification system for expiring credits

**Pricing Strategy Tools**

- Copy pricing from one content/offering to another
- Bulk pricing updates (e.g., "set all beginner yoga to $9.99")
- A/B testing different price points (Phase 4)
- Promotional codes and discounts:
  - Percentage off (20% off)
  - Fixed amount off ($10 off)
  - First-time customer offers
  - Referral discounts
  - Category-specific codes ("YOGALOVE" for yoga content)

**Payment Configuration**

- Connect Stripe account
- Configure accepted payment methods (card, digital wallets)
- Set platform currency (USD, EUR, GBP, etc.)
- Tax settings (automatic tax calculation by region)
- Invoice generation for business customers

**Progressive Engagement Model**

The pricing system enables a deliberate customer journey:

1. **Discovery** (Free/Low Cost): Free content, lead magnets, $5-10 individual pieces
2. **Sampling** (Low Commitment): $29/month basic subscription to one category, trial periods
3. **Engagement** (Medium Commitment): $79/month tier with multiple categories + 2 session credits
4. **Deep Relationship** (High Commitment): $299/month VIP with full access + weekly 1-on-1 sessions
5. **Transformation** (Highest Value): Custom coaching packages, retreats, ongoing mentorship

The platform should make step 1 → 2 frictionless, while creating natural upsell opportunities at each stage.

#### Revenue Attribution Strategy

**Direct Purchases**

- Simple attribution: Revenue split according to Media Owner agreement (e.g., 70/30)
- Clear, immediate payout calculation

**Subscription Revenue** (Choose One Strategy)

_Option A: Platform Owner Keeps All Subscription Revenue (Recommended for MVP)_

- Simplest to implement and understand
- Subscription revenue goes 100% to Platform Owner
- Media Owners earn only from direct purchases of their content
- Clear separation: subscriptions = Platform Owner income, direct sales = shared income
- Incentivizes Platform Owner to drive subscription growth
- **Trade-off**: May reduce Media Owner motivation if most revenue comes from subscriptions

_Option B: Engagement-Based Revenue Split (Recommended for Phase 2+)_

- Track which content/offerings each subscriber engages with
- Monthly pool: Take subscription revenue, subtract platform costs
- Distribute to Media Owners based on:
  - Content views/play time (weighted by completion rate)
  - Offering participation (attendance, bookings fulfilled)
  - Rating/feedback scores (quality bonus)
- Example: $10,000 subscription revenue this month
  - Media Owner A's content: 30% of total engagement = $3,000
  - Media Owner B's content: 20% of total engagement = $2,000
  - Media Owner C's content: 10% of total engagement = $1,000
  - Platform Owner: 40% (admin + unattributed) = $4,000
- **Trade-off**: Complex to calculate, requires robust analytics, potential disputes

_Option C: Hybrid Model_

- Subscription revenue: 80% Platform Owner, 20% split among Media Owners based on engagement
- Balances simplicity with Media Owner incentives
- **Trade-off**: Still requires engagement tracking

**Credit-Based Bookings**

- When a customer uses credits (from subscription) to book a Media Owner's offering:
  - Attribute a pro-rated amount from their subscription fee to that Media Owner
  - OR treat as Platform Owner revenue (since it's part of subscription benefit)
- Recommendation: Treat as Platform Owner revenue for MVP simplicity

**Decision for MVP**: Start with **Option A** (Platform Owner keeps subscription revenue). This allows you to launch quickly with simple revenue logic. Add engagement-based attribution in Phase 2 when you have analytics infrastructure and real usage patterns to inform the model.

#### Analytics & Reporting

Platform Owner can view:

- Revenue by source (direct purchases vs subscriptions vs credits)
- Subscription metrics:
  - MRR (Monthly Recurring Revenue)
  - Churn rate
  - Average subscription lifetime
  - Conversion rate (free user → subscriber)
- Credit usage patterns:
  - Credits issued vs credits redeemed
  - Most popular offerings booked with credits
  - Credit expiration rates
- Pricing effectiveness:
  - Conversion rates by price point
  - Bundle vs individual purchase rates
  - Discount code redemption rates
- Customer lifetime value (CLV)
- Revenue per customer segment

**Success Criteria**:

- Platform Owner can create their first subscription tier (with categories + credits) in under 10 minutes
- Customers can understand their access level and credit balance within 5 seconds of logging in
- Revenue attribution is automated and transparent to all Media Owners
- Pricing changes take effect immediately across the platform

### R2.3 Offering Management

**Requirement**: Create and manage any type of purchasable engagement (events, services, programs, retreats) through a unified "Offering" system that provides customers with dedicated portals containing all resources, scheduling, and communication for their engagement.

#### Core Concept: What is an Offering?

An **Offering** is any bookable or scheduled engagement between creator and customer(s). Unlike passive content (videos, articles), Offerings are interactive experiences that may include:

- Scheduled sessions (one-time or recurring)
- Live interaction (video calls, in-person meetings, streaming)
- Associated resources (content, files, materials)
- Customer portal (engagement-specific hub for everything related to this offering)
- Communication channel (direct messaging, group chat)

Offerings replace the traditional separation of "Events" and "Services" because they share more similarities than differences.

#### Offering Types

Platform Owners can create offerings in these categories:

**1. One-Time Event**

- Single scheduled occurrence (webinar, workshop, concert, masterclass)
- Can accommodate: 1 person, small group, large group, or unlimited attendees
- Example: "Intro to Meditation Workshop - March 15th, 7pm"

**2. Multi-Day Event/Program**

- Spans multiple days with a schedule of sessions
- Can include daily sessions, breaks, activities
- Example: "5-Day Yoga Retreat - June 10-14"
- Example: "21-Day Transformation Program" with scheduled check-ins

**3. Recurring Service - Fixed Schedule**

- Ongoing engagement with predefined recurring schedule
- Example: "Weekly Group Coaching - Every Tuesday at 6pm"
- Example: "Monthly Healing Circle - First Saturday of each month"

**4. Recurring Service - Bookable**

- Ongoing engagement where customer books individual sessions from availability
- Example: "1-on-1 Therapy Sessions" (customer books from therapist's available slots)
- Example: "Personal Training" (customer books 2x/week from available times)

**5. Course/Program with Cohort**

- Structured multi-week program with defined curriculum
- Customers join specific cohorts with start/end dates
- Example: "8-Week Mindfulness Course - Cohort starting April 1st"

**6. Retreat/Immersive**

- Multi-day in-person or intensive online experience
- Includes accommodation, meals, materials, full schedule
- Example: "Silent Meditation Retreat - Bali, 10 days"

#### Offering Configuration

When creating any offering, Platform Owner defines:

**Basic Information**

- Offering name and description
- Category/type (from above list)
- Tags and searchability settings
- Hero image and gallery
- Creator/facilitator (Platform Owner or Media Owner)

**Scheduling & Duration**

_For One-Time Events:_

- Date and time (with timezone)
- Duration (e.g., 2 hours)
- Registration deadline

_For Multi-Day Programs:_

- Start and end dates
- Session schedule (e.g., "Daily session 9am-11am", "3 sessions per week")
- Breaks and free time
- Cohort management (if applicable)

_For Recurring Services:_

- Recurrence pattern (weekly, bi-weekly, monthly)
- Fixed schedule OR available time slots for booking
- Booking window (e.g., "can book 2 weeks in advance")
- Cancellation/rescheduling policy
- Session duration and buffer time

**Capacity & Participants**

- 1-on-1 (single customer per occurrence)
- Small group (2-10 participants)
- Large group (10-100 participants)
- Unlimited (webinars, streaming events)
- Waitlist enabled/disabled

**Delivery Method**

- Online via video conference (auto-generate Zoom/Meet links)
- In-person with location details
- Hybrid (both online and in-person options)
- Self-guided (for programs without live sessions)

**Pricing & Access**

- Direct purchase price
- Can be booked with credits (if yes, credit cost)
- Included in specific subscription tiers
- Payment options (full upfront, payment plan, pay-per-session)
- Refund policy and cancellation terms

**Customer Portal Configuration**

Each offering has a dedicated portal that customers see when they've registered/booked. Platform Owner configures:

_Portal Tabs/Sections:_

- **Schedule**: Calendar view of all sessions, automatically synced to customer's calendar
- **Join/Location**: Video conference links or in-person location/directions
- **Resources**: Curated content library specific to this offering
  - Pre-selected existing content (videos, audio, posts)
  - Uploaded files (PDFs, worksheets, recordings)
  - Time-gated content (unlocks at specific milestones)
- **Communication**:
  - Direct messaging with creator (for 1-on-1)
  - Group chat (for group offerings)
  - Announcements feed
- **Notes & Progress**:
  - Customer's personal notes
  - Progress tracking (for multi-session offerings)
  - Session recordings (if enabled)
  - Homework or assignments
- **Community** (optional):
  - See other participants (if appropriate)
  - Discussion forum for this offering

_Portal Access Duration:_

- Active during engagement + X days after (e.g., "access until 30 days after retreat ends")
- Permanent access (for programs with reference materials)
- Time-limited (e.g., "access for 90 days")

**Notifications & Reminders**

- Automated reminders (1 week before, 1 day before, 1 hour before)
- Session confirmation emails
- Portal access notification
- Post-session follow-ups
- Credit usage notifications
- Cancellation/change notifications

**Associated Resources**

Platform Owner can attach resources to the offering:

- Select existing content from library (specific videos, audio, articles)
- Upload new files (PDFs, MP3s, downloads)
- Create custom text content (instructions, schedules, packing lists)
- External links (Google Docs, Dropbox folders)
- Set visibility rules (available before/during/after engagement)

**Examples of Different Offering Configurations**

_Example 1: Weekly Therapy Sessions (1-on-1 Bookable)_

- Type: Recurring Service - Bookable
- Capacity: 1-on-1
- Duration: 50 minutes per session
- Availability: Mon-Fri, 9am-5pm (customer books from open slots)
- Delivery: Online (Zoom)
- Portal includes:
  - Booking calendar to schedule next sessions
  - Session recordings (if consent given)
  - Therapist notes and homework assignments
  - Direct messaging with therapist
  - Resource library (worksheets, meditations, readings)
- Access: Ongoing while customer remains booked
- Pricing: $150 per session OR 1 credit (from subscription)

_Example 2: 5-Day Yoga Retreat in Bali (In-Person Immersive)_

- Type: Retreat/Immersive
- Capacity: 15 participants max
- Dates: June 10-14, 2025
- Delivery: In-person (resort address, directions)
- Portal includes:
  - Full retreat schedule (morning yoga, afternoon workshops, evening meditation)
  - Packing list and travel information
  - Pre-retreat preparation videos
  - Group chat for participants
  - Location details and local info
  - Post-retreat recordings and photo gallery
- Access: Available 30 days before retreat through 60 days after
- Pricing: $1,800 direct purchase (early bird $1,500)

_Example 3: Monthly Group Coaching Call (Fixed Schedule)_

- Type: Recurring Service - Fixed Schedule
- Capacity: 20 participants max
- Schedule: First Wednesday of every month, 7pm EST
- Delivery: Online (Zoom)
- Portal includes:
  - Calendar with next 6 month's dates
  - Zoom link (same for all sessions)
  - Recording library of past sessions
  - Group discussion forum
  - Submit questions before each call
  - Monthly worksheets and resources
- Access: Ongoing while subscribed
- Pricing: Included in "Community Tier" subscription ($49/month)

_Example 4: Somatic Healing Journey - 6-Week Program (Cohort)_

- Type: Course/Program with Cohort
- Capacity: 30 participants per cohort
- Structure: 6 weeks, 2 live calls per week (Tuesdays & Thursdays 6pm)
- Cohorts: Start dates every 2 months
- Delivery: Online group calls + self-paced content
- Portal includes:
  - Weekly modules with video lessons
  - Live call schedule with Zoom links
  - Recording library of all cohort calls
  - Workbook (PDF download)
  - Group chat for cohort members
  - Progress tracker (track completion of modules)
  - Bonus meditation library
- Access: Full access during 6 weeks + lifetime access to recordings and materials
- Pricing: $497 one-time OR $97/month for 6 months

#### Offering Management Dashboard

Platform Owner can manage all offerings from a unified dashboard:

**Calendar View**

- See all scheduled offerings across time
- Color-coded by type
- Filter by delivery method, capacity, creator
- Identify scheduling conflicts

**Listing Management**

- Create new offering
- Duplicate existing offering (use as template)
- Archive past offerings
- Manage registration/booking status
- View capacity and waitlist

**Participant Management**

- See who's registered/booked for each offering
- Send messages to participants
- Issue refunds or transfers
- Mark attendance
- Manage no-shows and cancellations
- Manually add/remove participants

**Offering Analytics**

- Registration/booking rates
- Revenue per offering
- Attendance rates (no-shows)
- Participant engagement (portal usage, resource access)
- Ratings and feedback
- Waitlist conversion rates
- Most popular offering types

#### Customer Experience

From the customer perspective:

**Discovering Offerings**

- Browse all offerings by category, date, creator, capacity
- Filter by "online" vs "in-person"
- Filter by "available now" vs "upcoming"
- See what's included in their subscription tier
- See credit requirements vs purchase price

**Booking/Registering**

- For events: Register and pay (or use subscription benefit)
- For bookable services: View availability calendar and book time slot
- For programs: Join next cohort or waitlist
- Choose payment method or apply credits
- Receive instant confirmation

**Accessing Portal**

- Portal appears in customer dashboard after booking
- Persistent access throughout engagement
- Mobile-friendly portal view
- Notifications for new content or messages in portal
- Easily find join links, resources, schedule

**During Engagement**

- Receive timely reminders
- Access all resources from portal
- Communicate with creator and/or other participants
- Take notes and track progress
- Reschedule sessions if allowed

**After Engagement**

- Access recordings and materials (based on settings)
- Rate and review the offering
- Book repeat engagement (for services)
- Receive follow-up content

**Success Criteria**:

- Platform Owner can create any type of offering (event, service, retreat, program) in under 15 minutes
- Offering portals automatically provision with correct resources, scheduling, and access controls
- Customers never feel confused about "where to go" for their engagement - portal is single source of truth
- 90% of customer questions answered by portal content (reduce support burden)

### R2.5 Media Owner Management

**Requirement**: Invite, manage, and compensate guest creators

**Capabilities**:

- Invite Media Owners via email
- Set revenue split percentages per Media Owner
- Approve or reject Media Owner content
- View Media Owner performance and sales
- Manage Media Owner Stripe Connect accounts
- Remove Media Owner access when needed

**Success Criteria**: Platform Owner can invite a guest creator and have them publishing content within one day.

### R2.6 Customer Management

**Requirement**: View and manage customer accounts, purchases, and bookings

**Capabilities**:

- View customer profiles and purchase history
- Manage customer subscriptions and access
- Issue refunds when necessary
- View customer booking history
- Send messages or announcements to customers
- Export customer data for marketing

**Success Criteria**: Platform Owner can quickly find any customer and view their complete interaction history.

### R2.7 Analytics & Reporting

**Requirement**: Understand business performance through clear metrics

**Capabilities**:

- Revenue reports (daily, weekly, monthly)
- Content performance (views, purchases, engagement)
- Event and service booking analytics
- Customer acquisition and retention metrics
- Media Owner performance comparison
- Export reports for accounting/tax purposes

**Success Criteria**: Platform Owner can answer "How is my business doing?" within 30 seconds of logging in.

### R2.8 Platform Configuration

**Requirement**: Customize platform appearance and settings

**Capabilities**:

- Upload logo and branding assets
- Customize color scheme and fonts
- Edit homepage and about page content
- Set up navigation menu structure
- Configure email notifications and templates
- Set business information (contact, social links, timezone)

**Success Criteria**: Platform Owner can make their platform feel uniquely branded within an hour.

---

## 3. Creator Requirements (Phase 2+)

**Note**: Phase 1 includes creators as "members" in the organization. Phase 2+ upgrades them to "creator" role with freelance capabilities.

### R3.1 Content Creation

**Requirement**: Upload and manage own content within invited organizations

**Capabilities**:

- Upload video, audio, and written content
- Add metadata and organize own content
- Preview content before submission
- View content approval status
- Manage content across multiple organizations

**Success Criteria**: Creator can upload content to their organizations and understand approval status.

### R3.2 Revenue Tracking

**Requirement**: Track earnings and receive payments transparently (Phase 2+)

**Capabilities**:

- View sales dashboard for own content
- See revenue breakdown and platform fees
- Manage Stripe Connect payout settings
- Download earnings reports
- View payment history
- Track earnings across multiple organizations

**Success Criteria**: Creator can see exactly how much they've earned per organization and when they'll be paid.

### R3.3 Organization Membership

**Requirement**: Belong to and manage relationships with multiple organizations

**Capabilities**:

- Accept invitations from multiple organizations
- Switch between organizations in dashboard
- View all organizations they belong to
- Manage their membership status
- Leave organizations if needed

**Success Criteria**: Creator can easily manage multiple organizational memberships.

### R3.4 Profile Management

**Requirement**: Maintain professional creator profile

**Capabilities**:

- Edit bio and profile information
- Upload profile photo and banner
- Add social media links
- View public-facing profile page

**Success Criteria**: Creator can create a professional presence that customers can discover.

### R3.5 Limited Analytics

**Requirement**: Understand content performance without full organization admin access

**Capabilities**:

- View own content performance (views, purchases)
- See customer engagement metrics
- Compare performance across own content
- View earnings trends

**Success Criteria**: Creator can identify their best-performing content and earnings trends.

---

## 4. Customer Requirements

### R4.1 Content Discovery

**Requirement**: Easily find content that matches interests

**Capabilities**:

- Browse content by category/topic
- Search content by keyword
- Filter by content type (video/audio/written)
- View featured and recommended content
- Preview free samples or trailers
- Read content descriptions and reviews

**Success Criteria**: Customer can find relevant content within 3 clicks from homepage.

### R4.2 Purchase Experience

**Requirement**: Quick, secure, and simple purchasing process

**Capabilities**:

- Add items to cart
- Apply discount codes
- Choose from available payment methods
- Save payment information for future purchases
- Receive instant purchase confirmation
- Access purchased content immediately

**Success Criteria**: Customer can complete a purchase in under 60 seconds.

### R4.3 Content Access

**Requirement**: Reliable access to purchased content anytime, anywhere

**Capabilities**:

- View all purchased content in library
- Stream video and audio with quality controls
- Download content for offline access (if enabled)
- Resume playback from where they left off
- Access content on mobile and desktop
- Rate and review content

**Success Criteria**: Customer can access their purchased content on any device without confusion.

### R4.4 Offering Discovery & Access

**Requirement**: Simple process to discover, book, and participate in any type of offering (events, services, programs, retreats)

**Capabilities**:

**Discovery**

- Browse all offerings by type, category, date, and creator
- Filter by delivery method (online, in-person, hybrid)
- Filter by availability (open for booking, upcoming, full/waitlist)
- See what's included in current subscription tier
- See credit cost vs direct purchase price for each offering
- Preview offering details, schedule, and included resources

**Booking/Registration**

- For one-time events: Register and pay (or use subscription benefit)
- For recurring services: View availability calendar and book specific time slots
- For programs/cohorts: Join next available cohort or join waitlist
- Apply credits or choose payment method
- Receive instant confirmation with calendar invite

**Accessing Offering Portal**

- Automatic portal access after booking/registration
- Portal appears in customer dashboard under "My Offerings"
- Single source of truth for everything related to the offering:
  - Schedule with all session dates/times
  - Join links for online sessions (Zoom, etc.)
  - Location and directions for in-person
  - All associated resources (videos, files, materials)
  - Communication with creator and other participants
  - Personal notes and progress tracking
  - Session recordings (if enabled)

**During Engagement**

- Receive automated reminders (1 week, 1 day, 1 hour before sessions)
- Access all resources from portal on any device
- Communicate with creator via portal messaging
- See other participants (if group offering)
- Track progress through multi-session offerings
- Reschedule sessions if policy allows

**After Engagement**

- Continued access to recordings and materials based on offering settings
- Rate and review the offering
- Book repeat sessions (for ongoing services)
- Receive follow-up content or offers

**Credit Management**

- View credit balance in dashboard
- See which offerings can be booked with credits
- Receive notifications when credits are expiring
- Track credit usage history
- Purchase additional credit packs

**Success Criteria**:

- Customer can find and book any offering in under 3 minutes
- Customer never asks "where do I go?" - portal provides all information
- 95% of customers successfully join their first session without support
- Customers understand their credit balance and how to use it within 10 seconds of viewing dashboard

### R4.6 Account Management

**Requirement**: Control over personal information and subscriptions

**Capabilities**:

- Update profile and preferences
- Manage subscription status
- View purchase and booking history
- Update payment methods
- Manage notification preferences
- Request account deletion

**Success Criteria**: Customer can manage all aspects of their account independently.

### R4.7 Support & Communication

**Requirement**: Get help when needed

**Capabilities**:

- Contact platform owner or support
- View FAQs and help documentation
- Request refunds when eligible
- Report issues with content or bookings
- Receive timely responses

**Success Criteria**: Customer can find help or contact support within 2 clicks from any page.

---

# System Capabilities

This section defines the major functional areas the platform must support to fulfill stakeholder requirements.

## Content Management System (CMS)

### Media Upload & Processing

- Support video formats (MP4, MOV, AVI) with automatic transcoding
- Support audio formats (MP3, WAV, AAC) with waveform generation
- Rich text editor for written content with formatting, images, embeds
- Automatic thumbnail generation for video content
- File validation and virus scanning
- Progress indicators for large file uploads
- Content versioning and revision history

### Content Organization

- Hierarchical categorization (categories, subcategories, tags)
- Series and collection grouping
- Custom sorting and ordering
- Metadata management (title, description, SEO fields)
- Content relationships (prerequisites, related content)

### Content Delivery

- Adaptive bitrate streaming for video
- Progressive audio streaming with seek support
- CDN integration for global delivery
- Download capabilities with DRM options
- Playback position tracking and resume
- Multi-device sync

### Access Control

- Visibility settings (public, private, members-only, purchased-only)
- Content gating and paywall enforcement
- Preview/trailer functionality for paid content
- Time-based access (launch dates, expiration)

---

## E-Commerce & Monetization

### Product Management

- Individual content and offering pricing
- Bundle and package creation
- Subscription tier configuration with category access
- Credit pack definition and pricing
- Pricing variations (introductory, renewal, early-bird)
- Free trials and freemium models
- Gift purchases and codes

### Subscription System

- Create and manage multiple subscription tiers
- Configure category access per tier (e.g., "Yoga tier" includes all yoga content)
- Grant offering access per tier (e.g., "free access to all workshops")
- Allocate monthly credits per tier (e.g., "2 session credits per month")
- Monthly vs annual billing options
- Subscription lifecycle management (trials, renewals, cancellations)
- Proration for mid-cycle changes
- Family/group subscription support

### Credit Management

- Define credit value for each offering type
- Track credit issuance (from subscriptions) and redemption
- Credit expiration rules (monthly, rollover, accumulate)
- Manual credit adjustments for customer service
- Credit purchase packs (e.g., "10 credits for $150")
- Credit balance display in customer dashboard
- Expiring credit notifications

### Shopping Experience

- Shopping cart with multi-item support (content, offerings, credit packs)
- Display subscription benefits (what's included vs purchase needed)
- Clear credit vs payment options for offerings
- Guest checkout option
- Saved payment methods
- Order history and receipts
- Wishlist functionality
- Recommended purchases based on subscription tier

### Payment Processing

- Stripe integration for card payments
- Stripe subscriptions for recurring billing
- Multiple currency support
- Tax calculation and collection by region
- Invoice generation
- Refund processing (full and partial)
- Payment retry logic for failed transactions
- Dunning management for failed subscription payments

### Revenue Sharing

- Stripe Connect integration for Media Owners
- Configurable revenue split percentages per Media Owner
- Automatic payout calculations for direct purchases
- Subscription revenue attribution (Platform Owner or engagement-based)
- Credit-based booking revenue handling
- Platform fee collection
- Payout scheduling and management
- Earnings reports and tax documents (1099/similar)

### Discount & Promotions

- Coupon code system
- Percentage and fixed-amount discounts
- Time-limited promotions
- First-time customer offers
- Bundle discounts
- Subscription discount codes
- Referral programs
- Category-specific codes

---

## Offering Management System

This system replaces traditional "Events" and "Services" with a unified "Offering" model that handles all types of purchasable engagements.

### Offering Configuration

- Offering type selection (one-time event, multi-day program, recurring fixed, recurring bookable, cohort course, retreat)
- Basic information (name, description, images, tags)
- Scheduling configuration:
  - Fixed dates/times for events
  - Recurring patterns for fixed-schedule services
  - Availability windows for bookable services
  - Multi-day schedules for programs and retreats
- Capacity management (1-on-1, small group, large group, unlimited)
- Delivery method (online video conference, in-person location, hybrid, self-guided)
- Creator assignment (Platform Owner or specific Media Owner)

### Pricing & Access Control

- Direct purchase pricing
- Credit cost configuration (if bookable with credits)
- Subscription tier inclusion rules
- Payment plan options (full upfront, installments, pay-per-session)
- Early-bird and tiered pricing
- Refund and cancellation policy per offering
- Waitlist configuration

### Customer Portal System

Each offering automatically generates a dedicated portal for participants:

**Portal Content Management:**

- Configure portal tabs/sections (Schedule, Join/Location, Resources, Communication, Progress, Community)
- Attach existing content from library to portal
- Upload offering-specific files (PDFs, worksheets, audio)
- Create custom text sections (instructions, packing lists, welcome messages)
- Set content visibility rules (available before/during/after engagement)
- Time-gated content unlocking based on schedule or progress

**Portal Access Control:**

- Define portal access window (X days before through Y days after)
- Lifetime access options for programs
- Time-limited access for retreats

**Communication Features:**

- Direct messaging (1-on-1 offerings)
- Group chat (group offerings)
- Announcements feed
- Q&A submission
- Discussion forums (optional)

**Progress Tracking:**

- Session attendance tracking
- Customer notes capability
- Homework/assignment submission
- Progress indicators for multi-session offerings
- Completion certificates (if configured)

### Scheduling & Calendar

- Unified calendar view of all offerings
- Timezone handling for international participants
- Automatic calendar invite generation (.ics files)
- Google Calendar integration for availability management
- iCal feed support
- Conflict detection across offerings
- Schedule override and exception handling

### Booking & Registration

**For Bookable Services:**

- Real-time availability display
- Time slot selection interface
- Booking window enforcement (e.g., must book 24 hours in advance)
- Buffer time between sessions
- Recurring booking support (book X sessions at once)

**For Events & Programs:**

- Registration forms with custom fields
- Cohort selection (for cohort-based programs)
- Group registration options
- Registration deadline enforcement
- Waitlist management with automatic promotion

### Video Conferencing Integration

- Zoom, Google Meet, or custom video platform integration
- Automatic meeting room creation per session
- Unique join links per participant (for security)
- Join link distribution via portal and email
- Recording management (start/stop, storage, access)
- Backup dial-in numbers
- Screen sharing and breakout room support (for group offerings)

### Participant Management

- View all participants per offering
- Attendance tracking and no-show management
- Send messages to individual participants or groups
- Issue refunds or transfers
- Manually add/remove participants
- Export participant lists
- Participant analytics (engagement, attendance rate)

### Notifications & Reminders

- Automated reminder schedule (1 week, 1 day, 1 hour before sessions)
- Registration/booking confirmation emails
- Portal access notifications
- Session join link distribution
- Post-session follow-ups
- Credit usage notifications when booking with credits
- Cancellation and rescheduling notifications
- Waitlist movement notifications

### Offering Analytics

- Registration and booking conversion rates
- Revenue per offering and per offering type
- Attendance rates and no-show tracking
- Participant engagement metrics:
  - Portal visits and time spent
  - Resource access rates
  - Communication activity
- Completion rates for multi-session offerings
- Ratings and feedback collection
- Waitlist conversion rates
- Repeat booking rates (for services)
- Most popular offerings report

---

## User Management & Authentication

### Account Creation & Authentication

- Email/password registration
- Social login (Google, Facebook, Apple)
- Email verification
- Password reset flow
- Two-factor authentication (2FA)
- Session management
- Account lockout after failed attempts

### Role-Based Access Control (RBAC)

- Permission system by role (Creator, Owner, Media Owner, Customer)
- Granular permission assignment
- Role inheritance
- Access audit logging
- Impersonation for support (Creator only)

### User Profiles

- Profile information (name, bio, photo, links)
- Preferences and settings
- Communication preferences
- Timezone and language settings
- Privacy settings
- Account deletion and data export (GDPR)

### Customer Relationship Management

- Customer database and search
- Purchase history view
- Lifetime value calculation
- Segmentation and tagging
- Bulk email campaigns
- Customer notes and internal tags

---

## Analytics & Reporting

### Business Metrics Dashboard

- Revenue overview (daily, weekly, monthly, yearly)
- Revenue by source (content, events, services)
- Active subscriptions and MRR (Monthly Recurring Revenue)
- Customer acquisition cost
- Average order value
- Refund rates

### Content Analytics

- Views and play time
- Completion rates
- Popular content rankings
- Search terms and discovery paths
- Content ROI (revenue per piece)
- Geographic distribution of viewers

### User Analytics

- New vs returning visitors
- User acquisition channels
- Engagement metrics (sessions, duration)
- Conversion rates (visitor → customer)
- Customer retention cohorts
- Churn analysis

### Financial Reporting

- Sales reports by date range
- Payout reports for Media Owners
- Tax reports (sales tax, VAT)
- Revenue reconciliation with Stripe
- Export to accounting software formats
- P&L statements

---

## Communication & Notifications

### Email System

- Transactional emails (confirmations, receipts, reminders)
- Marketing emails (newsletters, promotions)
- Template management with variables
- Email scheduling and automation
- Delivery tracking and bounce handling
- Unsubscribe management

### In-App Notifications

- Real-time notifications
- Notification center/inbox
- Read/unread status
- Notification preferences per type
- Push notifications (future mobile app)

### Messaging

- Customer → Owner messaging
- Support ticket system
- Announcement broadcasts
- Comment system on content (optional)
- Review and rating system

---

## Platform Configuration & Customization

### Branding

- Logo and favicon upload
- Color scheme customization
- Font selection
- Custom CSS (advanced users)
- Email template branding
- White-label options

### Content Pages

- Homepage builder with sections
- About page editor
- Terms of service and privacy policy pages
- Custom page creation
- Navigation menu management
- Footer content configuration

### Business Settings

- Business name and contact info
- Timezone and locale settings
- Currency configuration
- Social media links
- SEO settings (meta tags, sitemap)
- Domain and SSL management

### Integration Configuration

- Stripe API keys
- Email service provider (SendGrid, Mailgun)
- Analytics (Google Analytics, Plausible)
- Video streaming provider
- Calendar integration
- Backup and storage settings

---

## Security & Compliance

### Data Protection

- Encryption at rest and in transit
- Secure file storage with access controls
- API rate limiting
- DDoS protection
- Regular security audits
- Vulnerability scanning

### Privacy Compliance

- GDPR compliance (EU)
- Data export for users
- Right to be forgotten (account deletion)
- Cookie consent management
- Privacy policy enforcement
- Data retention policies

### Payment Security

- PCI DSS compliance via Stripe
- No storage of card details
- Secure payment tokenization
- Fraud detection
- Chargeback management

### Content Security

- User-uploaded content moderation
- Automated content scanning (CSAM, copyright)
- DMCA takedown process
- Content access logging
- API abuse prevention

---

## Infrastructure & Performance

### Scalability

- Horizontal scaling for web servers
- Database read replicas
- CDN for static assets and media
- Queue system for background jobs
- Caching strategy (Redis)
- Load balancing

### Reliability

- 99.9% uptime target
- Automated backups (daily, point-in-time recovery)
- Disaster recovery plan
- Health monitoring and alerts
- Graceful degradation
- Zero-downtime deployments

### Performance

- Page load time < 2 seconds
- Video buffering < 3 seconds
- API response time < 200ms (p95)
- Database query optimization
- Image and video optimization
- Lazy loading for media content

### Monitoring & Observability

- Application performance monitoring (APM)
- Error tracking and alerting
- Log aggregation and search
- User session recording (privacy-compliant)
- Uptime monitoring
- Performance metrics dashboard

---

# MVP vs Future Features Priority Framework

This section helps prioritize what to build first for a Minimum Viable Product (MVP) versus features to add in later phases.

## Phase 1: Core MVP (Must Have)

**Goal**: Launch a functional platform where Platform Owner can upload content, sell it, and customers can purchase and access it.

### Authentication & User Management

- ✅ Email/password registration and login
- ✅ Password reset
- ✅ Basic role system (Platform Owner, Customer)
- ✅ User profiles (minimal)

### Content Management

- ✅ Upload video content (single format, basic transcoding)
- ✅ Upload written content (simple text editor)
- ✅ Create and edit content metadata
- ✅ Publish/unpublish content
- ✅ Basic categorization (tags)

### E-Commerce

- ✅ Stripe payment integration
- ✅ Set individual content prices
- ✅ Simple checkout flow
- ✅ Purchase confirmation emails
- ✅ Customer purchase history

### Content Delivery

- ✅ Video streaming (basic quality)
- ✅ Content library for customers
- ✅ Access control (purchased content only)

### Essential Pages

- ✅ Homepage with featured content
- ✅ Content browsing page
- ✅ Individual content pages
- ✅ Customer dashboard
- ✅ Platform Owner admin panel

**Timeline**: 2-3 months
**Success Metric**: Platform Owner can sell first piece of content to first customer

---

## Phase 2: Enhanced Monetization (Should Have)

**Goal**: Add subscription model, events, and basic analytics to increase revenue opportunities.

### E-Commerce Enhancements

- ✅ Subscription tiers with recurring billing
- ✅ Bundle creation and pricing
- ✅ Discount codes
- ✅ Shopping cart improvements

### Events

- ✅ Create event listings
- ✅ Event registration and payment
- ✅ Calendar integration (.ics files)
- ✅ Event reminders
- ✅ Basic Zoom integration for online events

### Analytics

- ✅ Revenue dashboard
- ✅ Content views and engagement
- ✅ Sales reports
- ✅ Customer acquisition metrics

### Content Enhancements

- ✅ Audio content support
- ✅ Series and collections
- ✅ Content scheduling (publish dates)
- ✅ Rich text editor improvements

**Timeline**: 2-3 months after Phase 1
**Success Metric**: First subscription customer and first event hosted

---

## Phase 3: Service Booking & Multi-Creator (Nice to Have)

**Goal**: Add appointment booking and invite Media Owners to expand content offerings.

### Service Booking

- ✅ Service definition and configuration
- ✅ Availability calendar
- ✅ Booking flow with payment
- ✅ Calendar integration (Google Calendar)
- ✅ Booking management (reschedule, cancel)
- ✅ Automated reminders

### Media Owner Support

- ✅ Media Owner role and permissions
- ✅ Stripe Connect integration
- ✅ Revenue split configuration
- ✅ Media Owner dashboard
- ✅ Content approval workflow
- ✅ Media Owner earnings reports

### Platform Configuration

- ✅ Branding customization (logo, colors)
- ✅ Homepage customization
- ✅ Navigation menu configuration
- ✅ Email template customization

### Enhanced Discovery

- ✅ Search functionality
- ✅ Filtering by category/type
- ✅ Recommended content
- ✅ Featured content management

**Timeline**: 3-4 months after Phase 2
**Success Metric**: First Media Owner invited and first service booking completed

---

## Phase 4: Advanced Features (Future)

**Goal**: Professional platform features for scale and optimization.

### Live Streaming

- ⏳ Custom RTMP streaming
- ⏳ Stream chat and Q&A
- ⏳ Recording and replay
- ⏳ Multi-camera support

### Advanced Commerce

- ⏳ Gift purchases
- ⏳ Affiliate/referral program
- ⏳ Payment plans (installments)
- ⏳ Multiple currencies
- ⏳ Tax automation (TaxJar, Avalara)

### Content Features

- ⏳ Content reviews and ratings
- ⏳ Comments and community
- ⏳ Content prerequisites/learning paths
- ⏳ Certificates of completion
- ⏳ Downloadable content with DRM

### Mobile Experience

- ⏳ Native mobile apps (iOS/Android)
- ⏳ Push notifications
- ⏳ Offline content access

### Marketing & Growth

- ⏳ Email marketing campaigns
- ⏳ Marketing automation
- ⏳ A/B testing
- ⏳ SEO optimization tools
- ⏳ Social media integration

### Advanced Analytics

- ⏳ Customer cohort analysis
- ⏳ Predictive analytics
- ⏳ Engagement scoring
- ⏳ Revenue forecasting
- ⏳ Funnel analysis

### Platform Features

- ⏳ Multi-language support
- ⏳ White-label for sub-platforms
- ⏳ API for third-party integrations
- ⏳ Webhook system
- ⏳ Custom domain per Platform Owner

**Timeline**: 6+ months after Phase 3
**Success Metric**: Platform supports 100+ customers and 10+ Media Owners efficiently

---

## Decision Framework

When deciding whether a feature belongs in MVP or later phases, ask:

### Critical Questions

1. **Can the platform function without it?** If no → MVP
2. **Does it directly enable the core transaction (content sale)?** If yes → MVP
3. **Is it required for legal/security compliance?** If yes → MVP
4. **Can it be done manually/workaround initially?** If yes → Later phase
5. **Does it serve <10% of users initially?** If yes → Later phase

### Examples Applied

**Feature: Video transcoding to multiple qualities**

- Can platform function without it? Yes, single quality works
- Does it enable core transaction? No, just enhances it
- Can it be done manually? Platform Owner can optimize videos before upload
- **Decision**: Phase 2 or 3

**Feature: Payment processing**

- Can platform function without it? No, this is the business model
- Does it enable core transaction? Yes, absolutely
- Required for compliance? Yes, need secure payment handling
- **Decision**: Phase 1 MVP

**Feature: Content comments**

- Can platform function without it? Yes
- Does it enable core transaction? No, nice to have for engagement
- Serves <10% initially? Yes, only valuable with community
- **Decision**: Phase 4

---

# Technical Stack Alignment

Based on your noted tech stack, here's how requirements map to technologies:

## Infrastructure

- **Next.js**: Frontend framework, API routes, SSR for SEO
- **PostgreSQL**: Primary database for all entities (users, content, orders, bookings)
- **BetterAuth**: User authentication and session management
- **R2 Buckets (Cloudflare)**: Video, audio, image storage and CDN delivery
- **Stripe**: Payment processing and Stripe Connect for revenue sharing

## Additional Technologies Needed

- **Video transcoding**: Consider services like Mux, Cloudflare Stream, or AWS MediaConvert
- **Email**: SendGrid, Resend, or Postmark for transactional emails
- **Calendar**: Google Calendar API or custom solution
- **Live streaming**: Zoom SDK, Mux, or custom RTMP
- **Queue/Background jobs**: BullMQ with Redis or similar
- **Real-time**: Pusher, Ably, or WebSockets for notifications

---

# Success Metrics by Phase

## Phase 1 (MVP) Success Metrics

- Time to first sale < 1 week after launch
- Platform Owner can upload content in < 5 minutes
- Customer can purchase and access content in < 2 minutes
- Zero payment failures
- 95% uptime

## Phase 2 Success Metrics

- First subscription within 2 weeks of Phase 2 launch
- 20% of customers are subscribers
- First event with 10+ attendees
- 30% increase in total revenue
- Content engagement (completion rate) > 40%

## Phase 3 Success Metrics

- First Media Owner onboarded within 1 month
- Media Owner content represents 20% of catalog
- First service booking within 2 weeks
- 10% of customers book services
- 50% repeat booking rate

## Phase 4 Success Metrics

- Support 100+ concurrent users
- Page load time < 1.5 seconds
- 95% customer satisfaction score
- <5% churn rate
- Mobile app adoption > 30% of users

---

# Next Steps

## Immediate Actions

1. ✅ Complete this requirements document
2. **Create database schema design** based on entities identified
3. **Design wireframes** for key user flows (MVP focus)
4. **Set up development environment** (Next.js + PostgreSQL + auth)
5. **Define API contracts** for frontend-backend communication
6. **Create project backlog** with Phase 1 MVP stories

## Documents to Create

- **Database Schema Document**: ERD and table definitions
- **API Specification**: Endpoints, methods, request/response formats
- **UI/UX Design Document**: Wireframes and user flows
- **Security & Privacy Plan**: Implementation details for compliance
- **Deployment Plan**: Infrastructure setup and CI/CD pipeline
- **Testing Strategy**: Unit, integration, and E2E test approach

## Key Decisions Needed

1. Video transcoding service selection (Mux vs Cloudflare Stream vs AWS)
2. Email service provider selection
3. Live streaming approach for events
4. Calendar integration vs custom booking system
5. Content moderation strategy (automated vs manual)
6. Hosting infrastructure (Vercel, AWS, Cloudflare Pages)

---

# Conclusion

This document provides the highest-level requirements for your creator platform. The core value proposition is creating an **upsell funnel from passive content consumption to active creator engagement**, while supporting multiple creators through a **revenue-sharing marketplace model**.

The platform combines:

- **LMS** (content management and delivery)
- **E-commerce** (payments and subscriptions)
- **Event management** (live streaming and ticketing)
- **Booking system** (appointment scheduling)
- **Multi-tenant marketplace** (Platform Owner + Media Owners)

By following the phased approach (MVP → Enhanced Monetization → Multi-Creator → Advanced Features), you can deliver value quickly while building toward a comprehensive platform.

**Key Success Factor**: Keep the Platform Owner experience simple and intuitive. They are non-technical and need to manage everything without developer assistance. Every feature should pass the "can a non-technical user do this independently?" test.
