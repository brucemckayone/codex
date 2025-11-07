# Codex Platform - Non-Technical Overview

**Purpose**: A single, comprehensive reference document that explains what Codex is, who it's for, and how it works—in plain English.

**Last Updated**: November 7, 2025

---

## What Is Codex?

Codex is a **creator monetization platform** that helps people sell their knowledge and expertise online. Think of it as your own Netflix + Calendly + Shopify, all in one—but designed specifically for creators, coaches, teachers, and consultants.

The platform creates a journey for your customers:
1. **Discover** → Watch free or low-cost videos
2. **Learn** → Buy courses or subscribe to your content library
3. **Engage** → Attend your workshops and events
4. **Transform** → Book one-on-one coaching or mentorship

---

## Who Is Codex For?

### Three Types of People Use This Platform

**1. The Developer (Platform Owner)**
- You—the person who built and maintains the system
- You have access to everything, but you don't run any businesses on it
- Think of this as being the "landlord" of a building where businesses operate

**2. Business Operators (Organization Owners)**
- People who run their own business on the platform
- Examples: A yoga studio owner, a life coach, a cooking instructor
- They upload videos, host workshops, and coach clients
- They are ALSO creators—they have their own media library
- In Phase 1, there's only one business operator (could be you wearing both hats)

**3. Customers**
- Regular people who buy courses, attend workshops, or book coaching sessions
- They don't need any special access—they just browse, buy, and consume

---

## The Core Architecture: How Content Works

### Media Library (What You Own)

Every creator (including organization owners) has their own **media library**—think of it like your personal Dropbox for videos and audio files.

**Key Points**:
- **You own your media files** forever, even if you leave an organization
- Your files live in your own storage space (`codex-media-{your-id}`)
- You upload once, use many times
- Example: Upload a 30-minute video about meditation

### Content Posts (What You Sell)

A **content post** is how you package your media for sale. It's like a product listing on Amazon.

**Content posts can live in two places**:

1. **Your Personal Profile** (`organization_id = NULL`)
   - It's just yours—appears on your creator profile
   - You set the price and description
   - Customers buy directly from you

2. **An Organization's Catalog** (`organization_id = org-abc`)
   - Posted to a specific business (yoga studio, coaching company, etc.)
   - Appears in that organization's store
   - You still own the underlying media file

**Example Flow**:
1. You upload a video called "Intro to Meditation" to your media library
2. You create Content Post #1: "Beginner Meditation - $9.99" on your personal profile
3. You create Content Post #2: "Meditation for Yoga Practitioners - $19.99" posted to "Peaceful Yoga Studio"
4. Same video, two different products, two different audiences

**Why this matters**:
- No duplicate uploads
- Media stays with you even if you leave the yoga studio
- You can sell the same content in different contexts

---

## Phase 1: What We're Building First

### The Setup

**One organization** (one website/business) run by one organization owner who is also a creator.

**The Database Can Handle More**, But The UI Shows One:
- The database structure supports multiple creators and organizations from day one
- But Phase 1 only builds the UI for a single organization with one creator
- This means we won't need to rebuild everything later—we're just adding UI

### Who's Who in Phase 1

| Person | What They Do | Are They A Creator? |
|--------|-------------|---------------------|
| **Platform Owner** (You) | Maintain the system, fix bugs, no business operations | No |
| **Organization Owner** (Business Operator) | Run the business, upload videos, coach clients | YES—has their own media library |
| **Customers** | Buy stuff and watch/attend | No |

**Key Point**: The organization owner IS a creator. They have their own media library and can upload videos just like any other creator would.

### What Organization Owners Can Do

#### Upload Media to Their Library
- Drag and drop a video file
- It goes to their personal storage bucket
- The system processes it (makes it streamable, generates a thumbnail)
- Now it's in their media library

#### Create Content Posts
- Pick a video from their media library
- Add a title, description, and price
- Choose: "Post to my organization" (appears in the business catalog)
- Or in the future: "Post to my personal profile"
- Publish it
- Customers can now buy it

#### See What's Selling
- Dashboard shows total revenue
- Which content is most popular
- Who has purchased what
- Basic business metrics

#### Manage Customers
- See all customers and their purchases
- Manually grant access (for refunds or customer service)
- Send emails to customers

#### Brand the Organization
- Upload a logo
- Choose colors
- Set business name and contact info

---

## The Customer Experience

### Browsing
- Customer visits the organization's website (e.g., peacefulyogastudio.com)
- Sees all published content posts
- Can filter by category, search, etc.
- Sees prices clearly

### Buying
- Click "Buy Now" on a video course
- Enter payment info (powered by Stripe)
- Purchase completes instantly
- Automatic email confirmation

### Watching
- Content now appears in "My Library"
- Click to watch
- Video streams smoothly with quality options
- Playback resumes where you left off
- Can watch on phone, tablet, or computer

---

## Phase 2 and Beyond: What Comes Later

### Phase 2 (3-6 Months Later)

**Multi-Creator Support**:
- Organization owner can invite other creators
- Example: Yoga studio invites 5 yoga instructors
- Each instructor uploads to their own media library
- They create content posts and share revenue with the studio

**Multi-Organization**:
- Platform owner can create more organizations
- One creator can belong to multiple organizations
- Example: A yoga instructor posts content to 3 different studios

**Subscriptions**:
- Monthly/annual plans instead of one-time purchases
- Example: "$29/month for access to all yoga content"
- Credits system: subscribers get credits to book classes

### Phase 3 (6-12 Months Later)

**Offerings System** (Events, Workshops, Coaching):
- One-time workshops ("Intro to Yoga Workshop - March 15")
- Recurring services ("Weekly therapy sessions - book your time")
- Retreats and multi-day programs
- Each offering gets its own "portal" with schedule, resources, and chat

**Revenue Sharing**:
- Automatic payment splits between organization and creator
- Powered by Stripe Connect
- Example: Studio keeps 30%, creator gets 70%

### Phase 4 (1+ Year Later)

**Advanced Features**:
- Mobile apps
- Live streaming
- Community features (comments, forums)
- Advanced analytics
- Marketing automation

---

## Key Business Concepts

### The Upsell Funnel

The platform is designed to move customers through a journey:

**Stage 1: Discovery (Free → $10)**
- Free content or cheap videos to get them interested
- Low risk for the customer

**Stage 2: Commitment ($29-79/month)**
- Subscribe to ongoing access
- Regular engagement

**Stage 3: Engagement (Book Services)**
- Attend workshops and classes
- Use subscription credits to book sessions

**Stage 4: Transformation (High-Value)**
- One-on-one coaching
- Intensive programs
- Retreats and immersive experiences

**Why This Works**:
- Customers start with low commitment
- Build trust through content
- Naturally progress to higher-value offers
- Platform makes each step easy

---

## Understanding the Structure

### Organizations vs. Personal Profiles

Think of it like this:

**Organization** = A business/brand
- Example: "Peaceful Yoga Studio"
- Has a website, branding, customers
- Multiple creators can post content here
- Appears at peacefulyogastudio.com

**Personal Creator Profile** = Individual creator's space
- Example: "Jane Smith - Yoga Instructor"
- Personal brand, independent of any studio
- Creators can sell their own content here
- Appears at codex.com/creators/jane-smith (future)

**Why Both Matter**:
- Freelance creators can build their own audience
- Organizations can curate content from multiple creators
- Same media file, different contexts

### Content vs. Media: What's the Difference?

**Media = The Raw File**
- The actual video or audio file
- Stored once in your media library
- Example: "meditation-intro.mp4" (500 MB file)

**Content = The Product Listing**
- How you package media for sale
- Has title, description, price
- Links to a media file
- Example: "Beginner Meditation Course - $19.99"

**Analogy**:
- Media = Your photo on your phone
- Content = That photo in an Instagram post or a print you're selling on Etsy
- Same photo, different uses

---

## How Money Flows

### Phase 1 (Simple)

**Direct Purchases**:
- Customer buys content for $50
- Stripe processes payment (keeps ~$1.50 in fees)
- Organization owner receives $48.50
- Simple, straightforward

### Phase 2+ (With Creators and Subscriptions)

**Creator Content Purchases**:
- Customer buys creator's content for $50
- Platform fee: 30% ($15) goes to organization
- Creator revenue: 70% ($35) goes to creator
- Automatic via Stripe Connect

**Subscriptions**:
- Two options for how to split subscription revenue:

**Option A (Simple - Recommended for Phase 2)**:
- Subscription revenue = 100% to organization owner
- Individual purchases = split with creators
- Easy to understand and calculate

**Option B (Complex - Maybe Phase 3+)**:
- Track what content each subscriber watches
- Split subscription money based on engagement
- Example: If 30% of watch time is Creator A's videos, they get 30% of subscription revenue

---

## Storage and Security

### Where Files Live

**Media Files**:
- Each creator has their own storage space
- Format: `codex-media-{creator-id}/`
- Example: `codex-media-jane-smith-123/originals/video.mp4`
- Isolated from other creators for security
- You own your files even if you leave an organization

**Why This Structure**:
- **Security**: One compromised account doesn't affect others
- **Ownership**: Creators truly own their content
- **Flexibility**: Use the same media file across multiple organizations
- **Accounting**: Easy to track who's using how much storage

### How Customers Access Content

**They Don't Get Direct File Access**:
- When a customer watches a video, they never get the actual file
- Platform generates a temporary, secure link
- Link expires after a few hours
- Must be logged in as the purchaser

**Why**:
- Prevents sharing paid content with friends
- Protects creator's intellectual property
- Customers can't download and distribute

---

## Common Scenarios Explained

### Scenario 1: Solo Creator Business

**Jane is a life coach who wants her own platform.**

- Jane = Platform Owner + Organization Owner (wearing both hats)
- She creates one organization: "Jane's Coaching Hub"
- She uploads 50 videos to her media library
- She creates 50 content posts in her organization catalog
- Customers buy courses from "Jane's Coaching Hub"
- All revenue goes to Jane
- **Phase 1 is perfect for Jane**

### Scenario 2: Multi-Creator Organization (Phase 2+)

**Peaceful Yoga Studio wants to feature multiple instructors.**

- Studio owner = Organization Owner
- Studio has 5 yoga instructors = Creators
- Each instructor uploads videos to their own media library
- Instructors create content posts in the studio's catalog
- Customers visit peacefulyogastudio.com and see all content
- Revenue splits automatically: Studio 30%, Instructor 70%
- **Needs Phase 2**

### Scenario 3: Freelance Creator (Phase 2+)

**Sarah is a yoga instructor who teaches at 3 studios.**

- Sarah = Creator
- She uploads 30 videos to her media library (her files, stored once)
- She posts content to Studio A's catalog
- She posts different content to Studio B's catalog
- She also posts content to her personal profile
- Same videos, different pricing/contexts
- Earns money from all three sources
- **Needs Phase 2**

### Scenario 4: The Full Ecosystem (Phase 3+)

**A yoga studio with content, workshops, and private sessions.**

- Studio uploads 100 videos
- Offers a subscription: "$49/month for all yoga videos + 2 class credits"
- Subscribers use credits to book live workshops
- Studio also offers one-on-one privates ("Book a session: $75")
- Customers progress from free content → subscription → private coaching
- **Needs Phase 3**

---

## What Makes Codex Different

### Compared to Teachable/Kajabi (Course Platforms)
- **They focus on**: Pre-recorded courses only
- **Codex adds**: Live workshops, coaching, full service offerings
- **Codex advantage**: Complete customer journey in one place

### Compared to Calendly (Booking Software)
- **They focus on**: Appointment scheduling only
- **Codex adds**: Content library, subscriptions, dedicated portals per offering
- **Codex advantage**: Booking is part of a larger relationship

### Compared to Patreon (Membership Platforms)
- **They focus on**: Recurring subscriptions with social features
- **Codex adds**: One-time purchases, services, professional booking
- **Codex advantage**: Better for professional services, not just content

### Compared to Podia/Gumroad (Creator Tools)
- **Similar scope**: Content + digital products + memberships
- **Codex different**: Built-in offerings system, multi-creator marketplace
- **Codex advantage**: Scales from solo creator to organization with team

**Codex is the "complete creator business platform"** - everything in one place.

---

## The Technical Foundation (Very High Level)

You don't need to understand this deeply, but here's the 10,000-foot view:

**Frontend** (What Users See):
- Website built with SvelteKit (modern, fast)
- Works on desktop and mobile browsers
- Responsive design

**Backend** (Where Data Lives):
- Database: Neon Postgres (stores all information)
- File Storage: Cloudflare R2 (stores videos and audio)
- Payments: Stripe (handles all money securely)
- Auth: BetterAuth (login and security)

**Infrastructure**:
- Hosted on Cloudflare (global, fast, reliable)
- Automatic backups (never lose data)
- CDN delivery (videos load fast worldwide)
- 99.9% uptime target

**Why These Choices**:
- **Cost-effective**: Starts at ~$20-30/month, scales as you grow
- **Fast**: Global content delivery
- **Secure**: Industry-standard security practices
- **Reliable**: Built on proven platforms

---

## Getting Started Roadmap

### Month 1-2: Build Phase 1 MVP

**What You'll Have**:
- One organization with one creator
- Upload videos and create content posts
- Customers can buy and watch content
- Basic admin dashboard
- Stripe payments working
- Email confirmations

**You Can**:
- Start selling content immediately
- Test with real customers
- Validate the business model
- Learn what features matter most

### Month 3-4: Enhance and Refine

**Add**:
- Better analytics
- Subscription tiers
- More payment options
- Improved organization settings
- Customer management tools

### Month 5-8: Multi-Creator (Phase 2)

**Add**:
- Invite other creators
- Revenue sharing
- Creator dashboards
- Multi-organization support

### Month 9-15: Offerings System (Phase 3)

**Add**:
- Workshop and event creation
- Booking system
- One-on-one coaching
- Customer portals for each offering

---

## Success Metrics: How You Know It's Working

### Phase 1 Success

**Week 1 After Launch**:
- [ ] First content uploaded in under 5 minutes
- [ ] First customer purchase completed
- [ ] Payment received in Stripe account
- [ ] Customer can watch purchased content
- [ ] Zero technical issues requiring developer help

**Month 1 After Launch**:
- [ ] 10+ pieces of content published
- [ ] 5+ paying customers
- [ ] $500+ in revenue
- [ ] Organization owner operates independently
- [ ] 95%+ uptime

**You'll Know It's Working When**:
- Organization owner uploads and publishes content without help
- Customers complete purchases without confusion
- Money flows smoothly from customer → Stripe → organization owner
- No calls at 2am about broken things

### Phase 2 Success

- First creator invited and onboarded
- Creator uploads their own content
- Revenue split happens automatically
- Subscription revenue starts flowing
- 20% of revenue is recurring (subscriptions)

### Phase 3 Success

- First workshop booked and delivered
- Customer books and attends one-on-one session
- Offering portals are used daily
- 30% of customers use offerings (not just content)

---

## Common Questions Answered

### "Can I change my mind about how things work?"

**Short answer**: Yes, but earlier is easier.

**Explanation**: The database is designed to support many future scenarios—multiple creators, organizations, etc.—even if we're only building UI for one scenario in Phase 1. So the foundation is flexible. But changing core concepts like "who owns what" gets harder once you have real data.

### "What if I want to add a feature not in the plan?"

**Process**:
1. Describe what you want and why (business goal)
2. Evaluate if it fits the existing structure
3. Determine which phase it makes sense in
4. Add it to the roadmap
5. Build when the time comes

**Example**: "I want customers to leave reviews"
- Fits the structure: Yes, reviews link to content
- Which phase: Phase 3 (community features)
- Complexity: Medium (need moderation)

### "How does this scale?"

**Small** (0-100 customers):
- Phase 1 handles this perfectly
- Cost: ~$30/month
- No performance issues

**Medium** (100-1,000 customers):
- Phase 2 handles this
- Cost: ~$100-200/month
- May need video optimization

**Large** (1,000-10,000 customers):
- Phase 3 infrastructure
- Cost: ~$500-1,000/month
- Needs CDN, caching, optimization

**Enterprise** (10,000+ customers):
- Phase 4 features required
- Cost: $2,000+/month
- Dedicated infrastructure

**The Architecture Scales**: Built on Cloudflare which handles millions of requests. Won't need to rebuild.

### "What if a creator leaves?"

**Their media stays with them**:
- Creator's files are in their own storage bucket
- When they leave, they take their files
- Content posts stay, but link to missing media
- Organization owner can hide those posts

**Revenue already earned**:
- Past payouts = theirs to keep
- No clawbacks or disputes

**Clean separation**:
- That's why creator-owned media matters
- No messy migration of files

### "Can I run multiple organizations?"

**Phase 1**: No, UI supports one
**Phase 2**: Yes, create multiple organizations
**Example**: Run "Yoga Studio A" and "Coaching Business B" separately

**Why wait**:
- Phase 1 is simpler, faster to build
- Most people start with one business
- Database ready, just need UI

---

## Glossary (Plain English)

**Creator**: Anyone who uploads content—could be organization owner or invited instructor

**Organization**: A business/brand that sells content (like "Peaceful Yoga Studio")

**Organization Owner**: Person who runs the business

**Platform Owner**: The developer (you) who maintains the system

**Content Post**: A product listing for sale (links to media + has price)

**Media Item**: The actual video or audio file in creator's library

**Media Library**: Creator's personal collection of uploaded files

**Offering**: Any bookable engagement (workshop, coaching, retreat)

**Portal**: Dedicated page for an offering with schedule, resources, chat

**Subscription Tier**: Monthly or annual plan for ongoing access

**Credits**: Tokens earned from subscription, spent on bookings

**Revenue Split**: Automatic payment division between organization and creator

**Personal Profile**: Creator's independent space (not tied to any organization)

**Catalog**: Organization's public store where customers browse content

**Organization ID = NULL**: Technical way to say "this content is on personal profile, not an organization"

---

## Final Thoughts

### What You're Building

A platform that lets creators make money from their expertise without needing 5 different tools. Everything in one place:
- Store (content sales)
- Membership site (subscriptions)
- Event platform (workshops)
- Booking system (coaching)
- Payment processing (Stripe)

### Why It Matters

**For Creators**:
- One platform instead of stitching together Teachable + Calendly + Patreon + Stripe
- Professional appearance
- Own their content forever
- Multiple revenue streams

**For Customers**:
- Everything in one place
- Clear access to what they bought
- Easy to book and attend
- Smooth payment experience

### How to Use This Document

**When planning**: Refer to phases and timelines

**When deciding features**: Check "What's in Phase X"

**When explaining to others**: Use the scenarios and analogies

**When stuck**: Read the common questions section

**When building**: Remember the "can a non-technical person do this?" test

---

## Next Steps

1. **Review this document**: Make sure it matches your vision
2. **Clarify any gaps**: Ask questions now before building
3. **Start with Phase 1**: Build the foundation correctly
4. **Launch small**: One organization, one creator, prove it works
5. **Iterate**: Learn what customers actually want
6. **Scale up**: Add multi-creator and offerings when ready

**Remember**: The best platforms start simple and grow based on real user needs. Build Phase 1 really well, then expand.

---

**Last Updated**: November 7, 2025
**Document Status**: ✅ Aligned with Current Architecture
**For Questions**: Ask the developer (that's you!)
