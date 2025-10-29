# Codex Platform - MVP Definition

**Last Updated**: October 20, 2025
**Version**: 1.0
**Architecture**: Cloudflare + Neon Serverless

> **Related Documents**:
>
> - [Platform Overview](./overview.md) - Complete platform vision and requirements
> - [Infrastructure Plan](./infrastructure/infraplan.md) - Technical architecture details
> - [Environment Management](./infrastructure/EnvironmentManagement.md) - Deployment configuration

---

## Executive Summary

This document defines the **Minimum Viable Product (MVP)** for the Codex platform - a white-label creator platform that enables creators to monetize knowledge through an upsell funnel: **consumable media → events → one-on-one services**.

### MVP Goal

Launch a functional platform where a Platform Owner can:

1. Upload and organize **video and audio content**
2. Set prices and sell content to customers
3. Process payments securely
4. Deliver content reliably to paying customers

### Success Criteria

- **Time to First Sale**: Platform Owner makes first sale within 1 week of launch
- **Upload Simplicity**: Platform Owner can publish content in <5 minutes without technical help
- **Purchase Experience**: Customer can buy and access content in <2 minutes
- **Reliability**: 99% uptime, zero payment failures
- **Independence**: Platform Owner operates platform without developer assistance

### Architecture Philosophy

**Serverless-First with Cloudflare + Neon**: Minimize infrastructure management by leveraging serverless platforms. Start with minimal cost (~$20-30/month), scale automatically as usage grows, maintain ability to migrate if needed.

**Why this matters**: Platform Owner is non-technical. Infrastructure must be invisible, reliable, and maintenance-free.

---

## Stakeholders

The MVP serves **two primary stakeholders**. Multi-creator support (Media Owners) comes in Phase 3.

### 1. Platform Owner

**Who**: Non-technical business owner who operates the platform

**MVP Needs**:

- Upload video and audio content without technical knowledge
- Set prices on individual content items
- View sales and revenue
- Manage customer access
- Basic platform branding (logo, colors, business name)

**Success Metric**: Can run entire platform independently without developer assistance

**Critical Requirement**: Every feature must pass the "can a non-technical user do this independently?" test.

### 2. Customers

**Who**: End users who purchase and consume content

**MVP Needs**:

- Discover content easily (browse, search)
- Purchase content securely
- Access purchased content reliably on any device
- Stream video and audio without buffering
- Resume playback where they left off

**Success Metric**: Complete purchase and start watching/listening in <3 minutes

---

## MVP Scope

### What We're Building

A **content monetization platform** with:

- Video and audio upload
- Payment processing (Stripe)
- Streaming delivery (Cloudflare R2)
- Access control (purchased content only)

**Core Value Proposition**:

```
Platform Owner uploads content → Sets prices → Customers buy → Customers access content
```

---

## What's Included (MVP Features)

### 1. Authentication & User Management

**Stakeholder Need**: Secure login and role-based access control

**Features**:

- ✅ Email/password registration and login
- ✅ Password reset flow via email
- ✅ Basic user profiles (name, email, avatar)
- ✅ Two user roles:
  - **Platform Owner**: Full admin access
  - **Customer**: Purchase and access content
- ✅ Session management (stay logged in)
- ✅ Email verification on registration

**User Stories**:

**As a Customer:**

- I can register with my email and password
- I can log in to access my purchased content
- I can reset my password if I forget it
- I stay logged in across sessions
- I can update my profile (name, avatar)

**As Platform Owner:**

- I have admin access to manage content and customers
- I can view all customers and their purchase history
- My role is distinct from regular customers

### 2. Content Management

**Stakeholder Need**: Platform Owner uploads and organizes media without technical knowledge

**Content Types**:

- ✅ **Video**: MP4, MOV (up to 5GB per file)
- ✅ **Audio**: MP3, WAV, AAC (up to 500MB per file)

**Features**:

- ✅ Upload video and audio files
- ✅ Automatic video transcoding (1080p, 720p for quality options)
- ✅ Automatic thumbnail generation from video (frame at 2 seconds)
- ✅ Content metadata:
  - Title
  - Description
  - Price (in USD)
  - Tags (simple array, e.g., ["meditation", "beginner"])
- ✅ Publish/unpublish toggle (draft vs live)
- ✅ Processing status visibility:
  - Uploading
  - Processing (transcoding video)
  - Ready to publish
  - Published
  - Failed (needs re-upload)

**User Stories**:

**As Platform Owner:**

- I can upload a video file and see upload progress
- I can upload an audio file
- I can add title, description, and price while uploading
- I can add tags to organize content
- I see when processing is complete (video transcoded, thumbnail generated)
- I can preview content before publishing
- I can publish content to make it visible to customers
- I can unpublish content to hide it from customers
- I can edit content metadata (title, description, price, tags)
- I can delete content with confirmation prompt
- I can view all my content (published and unpublished)

**Upload Flow**:

```
1. Platform Owner selects file (video or audio)
2. Enters title, description, price, tags
3. Upload begins (progress bar shows status)
4. File uploads directly to Cloudflare R2
5. For video: RunPod transcodes and generates thumbnail (5-10 min)
6. For audio: Ready immediately after upload
7. Platform Owner sees "Ready to publish"
8. Platform Owner clicks "Publish"
9. Content appears to customers
```

**Content States**:

- `uploading`: File being uploaded
- `processing`: Video being transcoded (audio skips this)
- `ready`: Processed, ready to publish
- `published`: Visible to customers
- `unpublished`: Hidden from customers
- `failed`: Processing failed (Platform Owner can retry)

### 3. E-Commerce (Payment & Purchase)

**Stakeholder Need**: Customers purchase content securely, Platform Owner receives payments

**Features**:

- ✅ Stripe payment integration
- ✅ Individual content pricing (USD only for MVP)
- ✅ Simple checkout flow:
  - Customer clicks "Buy Now"
  - Stripe embedded payment form
  - Instant access after payment
- ✅ Purchase confirmation email (via Resend)
- ✅ Customer purchase history
- ✅ Prevent duplicate purchases (if already purchased, show "Access" instead of "Buy")
- ✅ Platform Owner receives payment directly to Stripe account

**User Stories**:

**As a Customer:**

- I can see content price clearly before purchasing
- I click "Buy Now" and enter payment details securely
- I receive instant access after successful payment
- I receive email confirmation of purchase
- I cannot accidentally buy the same content twice
- I can view all my past purchases

**As Platform Owner:**

- I set prices on each piece of content
- I receive payments directly to my Stripe account
- I can view total revenue
- I can see which content has been purchased
- I can manually grant access to customers (for support/refunds)

**Purchase Flow**:

```
1. Customer browses content catalog
2. Clicks on content to view details
3. Sees price and "Buy Now" button
4. Clicks "Buy Now"
5. Stripe payment form appears
6. Customer enters card details
7. Stripe processes payment
8. Purchase record created
9. Access granted immediately
10. Email confirmation sent
11. Customer redirected to library (can start watching/listening)
```

**Payment Rules**:

- Minimum purchase: $1.00
- Maximum purchase: $999.99 (MVP limit)
- Currency: USD only
- Payment methods: Credit/debit cards (via Stripe)
- Test mode for development, live mode for production

**Security**:

- ✅ Stripe webhook signature verification (prevent fake payment confirmations)
- ✅ Atomic transaction: purchase + access grant happen together (if one fails, both fail)
- ✅ Check for existing purchase before creating payment
- ✅ Store price at purchase time (if price changes later, customer paid what was shown)
- ✅ Never trust client-side payment status (only Stripe webhook confirms payment)

### 4. Content Delivery (Streaming & Playback)

**Stakeholder Need**: Customers watch/listen to purchased content reliably on any device

**Video Player Features**:

- ✅ Play/pause
- ✅ Volume control
- ✅ Fullscreen toggle
- ✅ Quality selector (1080p vs 720p for video)
- ✅ Playback speed (0.5x, 1x, 1.5x, 2x)
- ✅ Resume from last position
- ✅ Keyboard shortcuts (space = play/pause, f = fullscreen, arrows = seek)
- ✅ **Video Player**: Mux Web Component Player (excellent UX, handles HLS streaming)

**Audio Player Features**:

- ✅ Play/pause
- ✅ Volume control
- ✅ Playback speed (0.5x, 1x, 1.5x, 2x)
- ✅ Seek bar with time display
- ✅ Resume from last position
- ✅ Background playback (audio continues if browser tab changes)

**Access Control**:

- ✅ Only customers who purchased content can watch/listen
- ✅ Signed URLs (expire after 4 hours, customer must be logged in to renew)
- ✅ Cannot share direct video/audio URLs (signed URLs prevent unauthorized access)

**User Stories**:

**As a Customer:**

- I can watch purchased videos in high quality (1080p or 720p based on connection)
- I can listen to purchased audio
- I can adjust playback speed (faster or slower)
- Video/audio resumes where I left off
- I can use keyboard shortcuts for quick control
- I can watch fullscreen (video)
- Playback starts quickly (<3 seconds on broadband)

**Access Flow**:

```
1. Customer logs in
2. Goes to Library (purchased content)
3. Clicks content thumbnail
4. Player loads
5. Access check: Does customer own this content?
   - Yes: Generate signed streaming URL (expires in 4 hours)
   - No: Redirect to purchase page
6. Player streams from Cloudflare R2
7. Every 30 seconds: Save playback position (so resume works)
8. Next visit: Player resumes at saved position
```

**Browser Support**:

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile Safari (iOS 14+)
- Chrome Mobile (Android 10+)

### 5. Customer Library

**Stakeholder Need**: Customers view all purchased content in one organized place

**Features**:

- ✅ Grid view of all purchased content
- ✅ Thumbnail, title, duration displayed for each item
- ✅ "Continue Watching/Listening" section (shows content with playback progress >0%)
- ✅ Search purchased content by title
- ✅ Filter by tags
- ✅ Sort options:
  - Recently purchased (default)
  - Title (A-Z)
  - Duration (longest first)
- ✅ Progress indicators (e.g., "60% complete")

**User Stories**:

**As a Customer:**

- I see all my purchased content in one place
- I can quickly find content by searching title
- I can filter by tags (e.g., show only "meditation" content)
- I see which content I've started but not finished ("Continue Watching")
- I can sort by different criteria
- I click thumbnail to start watching/listening immediately

### 6. Platform Owner Admin Panel

**Stakeholder Need**: Platform Owner manages content, customers, and views business metrics

**Admin Sections**:

#### Content Management

- List all content (published, unpublished, processing)
- Create new content (upload flow)
- Edit content metadata (title, description, price, tags)
- Publish/unpublish content
- View content statistics:
  - Number of purchases
  - Total revenue from this content
  - Number of views/plays
- Delete content (with confirmation)

#### Customer Management

- List all customers
- View customer details:
  - Email, join date
  - Purchase history
  - Total spent
- View what content each customer owns
- Manually grant access (for support, refunds, promotions)

#### Analytics Dashboard (Simple)

- **Total Revenue**: All-time and this month
- **Customer Count**: Total registered customers
- **Purchase Count**: Total purchases made
- **Top Content**: 5 most purchased items
- **Recent Activity**: Last 10 purchases

#### Settings

- **Branding**:
  - Upload logo
  - Set primary color (color picker)
  - Set platform name
- **Business Info**:
  - Contact email
  - Business name
- **Integrations**:
  - Stripe connection status
  - Email settings (from name, reply-to email)

**User Stories**:

**As Platform Owner:**

- I can see all my content in one dashboard
- I can quickly publish or unpublish content
- I can see which content is selling best
- I can see total revenue at a glance
- I can find any customer and view their purchases
- I can grant access to a customer manually (for refunds or support)
- I can customize platform branding (logo, colors)
- I can manage business information and settings

### 7. Email Notifications

**Stakeholder Need**: Automated email communication for important events

**Email Types**:

- ✅ Welcome email (on registration)
- ✅ Email verification (after registration)
- ✅ Password reset email (with secure reset link)
- ✅ Purchase confirmation (receipt with access link)
- ✅ Platform Owner sale notification (when customer purchases)

**Email Customization**:

- ✅ Platform Owner can set:
  - From name (e.g., "Acme Meditation Platform")
  - Reply-to email
- ✅ Simple text-based templates for MVP
- ✅ Platform Owner can edit basic email content
- ✅ Platform Owner can toggle email types on/off

**User Stories**:

**As a Customer:**

- I receive email confirmation immediately after purchase
- I receive password reset link when I request it
- Emails include clear next steps (e.g., "Click here to access your content")

**As Platform Owner:**

- I receive email notification when a sale is made
- I can set the "from name" for all customer emails
- I can customize basic email content

---

## What's NOT Included (Future Phases)

These features are important but **explicitly out of scope for MVP**. They will be added in subsequent phases.

### Phase 2: Enhanced Monetization

**Goal**: Add recurring revenue and advanced pricing

- ❌ **Subscription tiers** (monthly/annual billing)
- ❌ **Category-based access** (subscription includes all content in category)
- ❌ **Credits system** (earn credits via subscription, spend on bookings)
- ❌ **Content bundles** (e.g., "All meditation videos for $99")
- ❌ **Discount codes** (promotional pricing)
- ❌ **Content series/collections** (organize related content together)
- ❌ **Advanced analytics** (cohorts, funnels, retention analysis)
- ❌ **Written content / blog posts** (text-based content type)
- ❌ **Shopping cart** (multi-item checkout)

**Why Phase 2**: MVP validates core value (content upload → sale → delivery). Subscriptions add complexity (recurring billing, tier management, prorated upgrades). Better to perfect single purchases first.

**Alternative to Shopping Cart**: Wishlist (save items to buy later) provides better value for content platforms.

### Phase 3: Multi-Creator & Offerings

**Goal**: Add guest creators and live/scheduled engagements

- ❌ **Media Owner role** (invite guest creators)
- ❌ **Stripe Connect** (revenue sharing with Media Owners)
- ❌ **Offering system** (events, services, programs, retreats)
- ❌ **Booking and scheduling** (customers book time slots)
- ❌ **Customer portals** (dedicated pages per offering)
- ❌ **Live streaming** (live video events)
- ❌ **Calendar integration** (Google Calendar sync, .ics files)

**Why Phase 3**: Requires infrastructure for scheduling, revenue splits, and live delivery. MVP focuses on async content (videos, audio). Live events and multi-creator revenue sharing add significant complexity.

### Phase 4: Advanced Features

**Goal**: Scale platform and add community features

- ❌ **Content comments and ratings**
- ❌ **Community features** (forums, member profiles)
- ❌ **Mobile native apps** (iOS/Android)
- ❌ **Downloadable content with DRM**
- ❌ **Certificates of completion**
- ❌ **Marketing automation** (email campaigns, drip sequences)
- ❌ **A/B testing** (test different pricing, layouts)
- ❌ **Multi-language support** (i18n)
- ❌ **White-label sub-platforms** (Platform Owner can create sub-brands)

**Why Phase 4**: These are scaling and optimization features. Wait until platform has proven product-market fit and meaningful user base.

---

## Infrastructure Overview

> **Detailed architecture documentation**: See [Infrastructure Plan](./infrastructure/infraplan.md)

### Required Services

| Service                   | Purpose                              | Cost                   |
| ------------------------- | ------------------------------------ | ---------------------- |
| **Cloudflare Pages**      | Host SvelteKit app (SSR + API)       | Free                   |
| **Neon Postgres**         | Database (users, content, purchases) | $5-10/month            |
| **Cloudflare R2**         | Store videos, audio, thumbnails      | $2-5/month             |
| **Cloudflare Workers**    | Queue consumer for video processing  | $5/month               |
| **Cloudflare Queues**     | Async job queue (video transcoding)  | Included with Workers  |
| **RunPod Serverless GPU** | Video transcoding                    | $3-10/month            |
| **Stripe**                | Payment processing                   | 2.9% + $0.30/txn       |
| **Resend**                | Transactional email                  | Free (3k emails/month) |

**Total Fixed Cost**: $15-25/month + Stripe fees

### Key Architectural Decisions

**Cloudflare Queue + Workers**

Queues are **required for MVP** because:

- Decouples video upload from processing (better UX)
- Handles processing failures gracefully (retries)
- Allows Platform Owner to upload multiple videos without waiting
- Prevents timeouts (transcoding can take 10+ minutes)

**MVP Architecture**:

```
Upload → Queue → Worker → RunPod → Webhook → Update DB
```

**Mux Web Component Player for Video**

Use Mux player because:

- Excellent UX out of the box
- Handles HLS streaming (adaptive bitrate)
- Works on all browsers/devices
- Keyboard shortcuts built-in
- Free and open-source

**Platform Owner Controls Email Templates**

MVP includes:

- Simple text-based email templates
- Platform Owner can edit email content (basic text editor)
- Set from name and reply-to email
- Toggle email types on/off

**Phase 2**: Rich HTML templates with visual editor

### Technology Justifications

**Why SvelteKit?**

- Modern framework with excellent developer experience
- Built-in SSR and form actions (no separate API needed)
- Easy deployment to Cloudflare Pages
- Type-safe with TypeScript

**Why Neon over Cloudflare D1?**

- Production-grade Postgres (ACID transactions)
- Critical for payment processing (requires strong consistency)
- No SQLite limitations
- Easy migration to any Postgres provider
- BetterAuth native support

**Why BetterAuth?**

- Framework-agnostic (works with SvelteKit)
- Type-safe, modern architecture
- Built-in session management
- Excellent documentation

**Why RunPod over Cloudflare Stream?**

- Much cheaper: $0.06/video vs $1/1000 min stored
- Pay only for processing time (no ongoing storage fees)
- Can add AI features later (subtitles, chapters)
- Full control over transcoding pipeline

**Why Cloudflare R2 over AWS S3?**

- Zero egress fees (S3 charges $0.09/GB for downloads)
- S3-compatible API (easy to migrate if needed)
- Native Cloudflare integration
- Better economics for video streaming

---

## Success Metrics

### Launch Criteria (Must Achieve Before Launch)

**Technical Requirements**:

- ✅ Platform Owner can upload a video in <5 minutes
- ✅ Video processing completes in <15 minutes (for 1-hour video)
- ✅ Customer can purchase content in <2 minutes
- ✅ Zero payment processing failures in testing
- ✅ Video playback starts in <3 seconds on broadband
- ✅ Audio playback starts in <2 seconds
- ✅ All critical user flows tested end-to-end

**User Experience**:

- ✅ Platform Owner can operate platform without developer help
- ✅ Clear error messages for all failure cases
- ✅ Mobile-responsive on all pages

### Post-Launch Success Indicators

**Validation Metrics** (indicates MVP is working):

- ✅ Platform Owner makes first sale (validates core flow)
- ✅ Customer purchases and accesses content successfully
- ✅ Platform Owner publishes multiple pieces of content
- ✅ Zero critical bugs blocking core flows
- ✅ 99%+ uptime

**Engineering Success**:

- System reliability (uptime, error rates)
- Performance (upload speed, playback latency)
- User experience (Platform Owner operates independently)

### Analytics & Observability

**Metrics Tracked for Platform Owner** (visible in admin dashboard):

**Business Metrics**:

- Total revenue
- Number of customers
- Number of purchases
- Top 5 most purchased content

**Technical Metrics** (internal monitoring, not shown to Platform Owner):

- Video upload success rate
- Video processing success rate
- Payment processing success rate
- Video playback start time (p95)
- Platform uptime

**User Experience Metrics** (internal):

- Time to first purchase (new customer)
- Video upload time (Platform Owner)
- Purchase completion rate
- Playback completion rate

---

## Appendix

### Technology Justifications

**Why SvelteKit?**

- Modern framework with excellent developer experience
- Built-in SSR and form actions (no separate API needed)
- Great performance out of the box
- Easy deployment to Cloudflare Pages
- Type-safe with TypeScript

**Why Neon over D1?**

- Production-grade Postgres (ACID transactions)
- Better for payment processing (requires strong consistency)
- No SQLite limitations (better JOINs, complex queries)
- Easy migration path to any Postgres provider
- BetterAuth has native support

**Why BetterAuth over NextAuth/Lucia?**

- Framework-agnostic (works with SvelteKit)
- Type-safe with excellent DX
- Modern architecture
- Built-in session management
- Good documentation

**Why RunPod over Cloudflare Stream?**

- Much cheaper ($0.06/video vs $1/1000 min stored)
- Pay only for processing time (no ongoing storage fees)
- Can add custom AI features later (subtitles, chapters)
- We control the transcoding pipeline

**Why R2 over S3?**

- Zero egress fees (S3 charges $0.09/GB for downloads)
- S3-compatible API (easy to migrate if needed)
- Native Cloudflare integration
- Better for video streaming cost

### Glossary

**MVP**: Minimum Viable Product - the smallest version that delivers core value

**Platform Owner**: The non-technical business owner who operates the platform

**Customer**: End user who purchases and consumes content

**Media Owner**: Guest creator who contributes content (not in MVP, added in Phase 3)

**Content**: Any purchasable media (video or audio in MVP)

**Offering**: Bookable engagement like event or service (not in MVP, added in Phase 3)

**SvelteKit**: Web framework for building the application

**Neon**: Serverless Postgres database provider

**R2**: Cloudflare's S3-compatible object storage

**RunPod**: GPU cloud platform for video processing

**BetterAuth**: Authentication library

**Stripe**: Payment processing platform

**Resend**: Transactional email service

---

**Document Status**: ✅ Ready for Implementation

**Related Documents**:

- [Platform Overview](./overview.md) - Complete platform vision
- [Infrastructure Plan](./infrastructure/infraplan.md) - Technical architecture
- [Environment Management](./infrastructure/EnvironmentManagement.md) - Deployment configuration
