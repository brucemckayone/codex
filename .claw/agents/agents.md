# Codex Platform Agents

This directory contains specialized AI agents designed to implement specific work packets in the Codex platform. Each agent document primes the LLM with expertise keywords, design patterns, and domain knowledge required for its work packet.

---

## Purpose

These agent documents serve to **confine the vector space** for LLM context by:
- Providing specific keywords and imperatives that guide implementation
- Documenting critical design patterns (without excessive code examples)
- Describing agent expertise and specialized knowledge
- Referencing work packets for detailed architectural guidance

---

## Available Agents

### Payment & Commerce

**[Stripe Checkout Agent](./stripe-checkout-agent.md)** - P1-ECOM-001
- Stripe Checkout Sessions API, Payment Intent lifecycle
- Idempotency patterns, revenue split calculations
- Integer cents money handling, service factory pattern
- Status: 🚧 Not Started

**[Stripe Webhook Agent](./stripe-webhook-agent.md)** - P1-ECOM-002
- HMAC signature verification, event routing patterns
- Thin handler pattern, webhook idempotency
- Always return 200 OK error handling
- Status: 🏗️ 50% Complete (infrastructure exists)

---

### Media & Content Delivery

**[Transcoding Agent](./transcoding-agent.md)** - P1-TRANSCODE-001
- RunPod Serverless API, GPU job orchestration
- FFmpeg H.264 encoding, HLS adaptive bitrate streaming
- Async job with webhook callback pattern
- Docker containerization for GPU processing
- Status: 🚧 Not Started

**[Content Access Agent](./content-access-agent.md)** - P1-ACCESS-001
- Access control rules (free, purchased, members-only)
- R2 presigned URL generation with time-limited expiration
- Playback progress tracking with upsert pattern
- User library aggregation across access types
- Status: 🚧 Not Started (Blocked by P1-ECOM-001)

---

### Communication & Notifications

**[Notification Agent](./notification-agent.md)** - P1-NOTIFY-001
- Resend API for transactional email
- Strategy pattern for email provider abstraction
- Pure template functions (testable, composable)
- PII redaction for GDPR compliance
- HTML + text email versions for accessibility
- Status: 🚧 Not Started

---

### Administration & Analytics

**[Admin Dashboard Agent](./admin-dashboard-agent.md)** - P1-ADMIN-001
- SQL aggregations (database-level, not application)
- Role-based middleware composition
- Revenue analytics with organization scoping
- Manual access grant workflows (idempotent)
- Status: 🚧 Not Started

---

### Platform Configuration

**[Platform Settings Agent](./platform-settings-agent.md)** - P1-SETTINGS-001
- Upsert pattern for atomic one-row-per-organization updates
- R2 file upload validation (type, size, content)
- Composition pattern (not BaseService inheritance)
- Graceful default handling when settings missing
- Status: 🚧 Not Started

---

## Agent Document Structure

Each agent document follows this structure:

1. **Work Packet Reference**: Links to detailed architectural documentation
2. **Agent Expertise**: Keywords that define the vector space for this agent
3. **Core Responsibilities**: What the agent is responsible for (not how)
4. **Key Concepts**: Critical design patterns with minimal code examples
5. **Domain Knowledge**: Specific APIs, protocols, and integration points
6. **Security Imperatives**: Non-negotiable security requirements
7. **Integration Points**: Upstream dependencies and downstream consumers
8. **Testing Strategy**: Unit, integration, and E2E testing approaches
9. **MCP Tools Available**: Which MCP servers can help (Context7, IDE tools)
10. **Work Packet Reference**: Link to detailed implementation guidance
11. **Common Pitfalls**: Things to avoid based on architectural decisions

---

## Using These Agents

### For Humans
1. Read the relevant agent document before implementing its work packet
2. Use it to understand the domain expertise required
3. Cross-reference with the work packet for detailed architecture
4. Follow the design patterns documented in the agent

### For AI Assistants
1. Load the relevant agent document into context when implementing a work packet
2. Use the expertise keywords to guide implementation decisions
3. Follow the design patterns exactly as documented
4. Reference the work packet for implementation details

---

## Design Principles

**Minimal Code Examples**: Agent documents avoid code examples unless demonstrating critical design patterns (service factory, strategy pattern, event router, etc.). This keeps documents focused on expertise rather than implementation.

**Vector Space Confinement**: Each agent uses specific keywords and domain terminology to prime the LLM for the right context. This improves output quality by narrowing the solution space.

**Reference Work Packets**: Agents link to work packets for detailed implementation guidance. Agents provide expertise, work packets provide architecture.

**Focus on Expertise**: Agents describe what the specialist knows and can do, not step-by-step implementation. They define the knowledge domain.

---

## Relationship to Work Packets

```
Work Packets (design/roadmap/work-packets/)
  └─ Detailed architectural documentation
  └─ Database schemas, API specs, pseudocode
  └─ Implementation checklists and testing strategies
  └─ "What to build" and "How to build it"

Agent Documents (.claw/agents/)
  └─ Expertise and domain knowledge
  └─ Critical design patterns
  └─ Security imperatives and integration points
  └─ "Who is building it" and "What they know"
```

Both are required for successful implementation:
- **Work Packet**: Provides the architectural blueprint
- **Agent Document**: Provides the specialized knowledge to execute the blueprint

---

## Contributing New Agents

When creating new agent documents:

1. **Identify the domain expertise** required for the work packet
2. **Extract key concepts** and design patterns (not full implementations)
3. **Document security imperatives** that are non-negotiable
4. **List integration points** with other services
5. **Link to the work packet** for detailed guidance
6. **Keep code examples minimal** - only show critical patterns
7. **Use domain keywords** to define the vector space

---

**Last Updated**: 2025-11-24
**Agent System Version**: 1.0
