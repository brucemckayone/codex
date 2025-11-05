# Platform Settings: Long-Term Evolution

**Purpose**: This document defines the complete evolution of organization and platform settings from Phase 1 through Phase 4+. It covers branding, business configuration, notifications, integrations, and compliance settings.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Core Architecture References

This feature builds on core platform patterns. For foundational architecture details, see:

- **[Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)** - Organization model, organization settings scoping
- **[R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)** - Logo storage in R2, asset management patterns

---

## Part 1: Core Principles

### Design Philosophy

1. **Non-technical configuration** - Organization owner needs no technical knowledge
2. **Intelligent defaults** - Smart defaults minimize configuration needed
3. **Real-time validation** - Catch errors immediately (email format, etc.)
4. **Progressive disclosure** - Show advanced options only when needed
5. **Organization-scoped** - All settings belong to one organization
6. **Version controlled** - Track setting changes for compliance (Phase 3+)

### Settings Categories

```
Organization Settings (Owner only)
├─ Basic Information
│   ├─ Organization name
│   ├─ Business legal name
│   ├─ Contact email
│   ├─ Business category
│   └─ Timezone
├─ Branding & Appearance
│   ├─ Logo upload
│   ├─ Primary color (intelligent palette generation)
│   ├─ Font selection (Phase 2+)
│   └─ Custom CSS (Phase 3+)
├─ Business Configuration
│   ├─ Currency selection
│   ├─ Tax settings
│   ├─ Payment method setup
│   ├─ Refund policy text
│   └─ Terms & conditions
├─ Content Defaults
│   ├─ Default visibility (public/private)
│   ├─ Allow downloads toggle
│   ├─ Enable reviews toggle
│   └─ Content moderation level
├─ Communication
│   ├─ Email notification preferences
│   ├─ Email template customization (Phase 2+)
│   ├─ Support email address
│   └─ Support channel settings
├─ Integrations (Phase 2+)
│   ├─ Payment processor (Stripe)
│   ├─ Email provider configuration
│   ├─ Analytics platform
│   ├─ Video hosting provider
│   └─ Custom webhook endpoints (Phase 3+)
├─ Security & Compliance
│   ├─ Password requirements
│   ├─ MFA enforcement (Phase 2+)
│   ├─ Session policies (Phase 3+)
│   └─ Data retention policies
└─ Advanced
    ├─ Custom domain (Phase 2+)
    ├─ API key management (Phase 3+)
    ├─ Webhook configuration (Phase 3+)
    └─ White-label options (Phase 4+)
```

---

## Part 2: Phase-by-Phase Evolution

### Phase 1: Foundation (Basic Organization Setup)

**When**: MVP launch
**Scope**: Single organization owner configures basics

#### Phase 1 Settings

**Basic Information** (Required during setup)
- Organization name: Used in emails and branded everywhere
- Business legal name: For invoices and compliance
- Contact email: For customer inquiries
- Timezone: For scheduling, analytics timestamps
- Business category: Optional, used for discovery

**Branding** (Customization)
- Logo upload: For header, emails, icons
- Primary color selection: Creates entire color palette automatically
- Auto-generated secondary colors and shades for contrast compliance
- Color preview showing how palette applies to UI

**Business Configuration**
- Currency selection: USD, EUR, GBP, CAD, etc.
- Platform fees display: Read-only, set by Platform Owner
- Refund policy text: Free text field for custom policy
- Terms of service: Rich text editor
- Privacy policy: Rich text editor

**Content Defaults**
- Default content visibility: Public or private
- Allow downloads: Toggle for customer file downloads
- Enable customer reviews: Toggle for review system
- Moderation level: None / light / strict

**Email Notifications**
- Notification preferences: Which events trigger emails
- Recipient email address
- Frequency settings: Immediate, daily digest, weekly

**Support Configuration**
- Support email address for customer inquiries
- Support page URL: Link where customers can find help
- Expected response time: Setting expectations

#### Phase 1 Implementation Approach

Settings are stored in organization table as metadata or separate settings table. Branding settings generate entire color palette algorithmically - from one primary color, the system creates:
- 10 shades (50, 100, 200, ... 900)
- Functional colors (success, warning, error) by hue adjustment
- Contrast validation (WCAG AA compliance)

All settings updates trigger owner-only permission check. Settings changes are logged for audit trail (prepared for Phase 3).

---

### Phase 2: Enhanced Configuration (Multi-Org, Integrations)

**When**: 3-6 months after Phase 1
**New Settings**: Integrations, custom domain, advanced branding, team settings

#### Phase 2 Settings Additions

**Branding Enhancements**
- Font selection: Google Fonts or system fonts
- Additional color controls: Background, text, link colors
- Email template branding: Logo, colors, footer
- Favicon upload

**Integrations** (New in Phase 2)

Stripe Integration:
- API key input (via OAuth flow)
- Test vs production mode toggle
- Webhook configuration (auto-handled)
- Account verification status
- Payout settings display

Email Provider Setup:
- API key input for email service (Resend, SendGrid, etc.)
- Custom domain for email sending
- From email address configuration
- Reply-to address setting

Analytics Platform:
- Google Analytics ID or Plausible token
- Event tracking setup
- Privacy-first analytics option

Video Hosting:
- API key for video platform (Mux, Cloudflare Stream)
- Quality/bitrate preferences
- Thumbnail generation settings

**Domain & Custom Hosting**
- Custom subdomain (studio.revelations.com)
- SSL certificate management (auto-handled)
- Domain DNS configuration helper

**Team Settings**
- Who can invite members: Owner only or admins too
- Default role for new invites: Admin or member
- Member self-invitation permissions

**Feature Toggles**
- Enable subscriptions feature
- Enable offerings/bookings feature
- Enable credits system
- Enable social features (reviews, comments)

#### Phase 2 Implementation Approach

New settings are added to existing settings storage without breaking Phase 1 structure. Integration setup flows guide non-technical users through OAuth and API key generation. Sensitive values (API keys, tokens) are encrypted at rest. Settings validation happens both client and server side.

---

### Phase 3: Advanced Settings (Granular Control)

**When**: 6-9 months after Phase 2
**Scope**: Custom roles, webhooks, advanced security, compliance tracking

#### Phase 3 Settings Additions

**Security & Compliance Enhanced**
- Session duration configuration
- Re-authentication requirements for sensitive actions
- IP whitelist for admin access
- MFA enforcement toggles
- Password complexity rules
- Login attempt limits before lockout
- GDPR compliance status tracking
- Data retention policies by data type

**API & Webhooks** (New)
- Generate/revoke API keys
- Set API rate limits
- Configure webhook endpoints
- Manage webhook event subscriptions
- Review webhook logs
- Webhook signature verification toggle

**Email Template Customization** (New)
- Welcome email template
- Purchase confirmation template
- Password reset email template
- Refund notification template
- Custom variables support
- Template preview and testing

**Custom Roles & Permissions** (New)
- Define custom role names
- Assign specific permissions to roles
- Role-based UI customization
- Permission combination presets

**Advanced Branding**
- Custom CSS injection (for power users)
- Custom HTML headers/footers
- Subdomain custom branding
- Email header image and colors

#### Phase 3 Implementation Approach

Settings changes are now fully audited - tracking who changed what, when, and why. Sensitive settings require additional confirmation. API keys are generated with expiration and rotation support. Webhook configuration includes failure handling and retry logic.

---

### Phase 4+: Enterprise Settings

**When**: 9+ months
**Scope**: White-label, SSO, enterprise compliance, advanced automation

#### Phase 4 Additions

**White-Label** (New)
- Remove all Codex branding
- Custom company name everywhere
- Custom support contact information
- Custom terms and privacy pages
- Custom footer content
- Custom logo in all contexts

**Single Sign-On** (New)
- SAML IdP configuration
- OIDC provider setup
- Automatic user provisioning
- Group/role synchronization
- Just-in-time provisioning

**Advanced Automation**
- Workflow builder interface
- Automation execution logs
- Performance metrics
- Cost/resource usage estimates

**Enterprise Compliance**
- Full audit log export
- Compliance certification tracking
- User data export (GDPR)
- Account deletion timeline
- Data residency selection
- Encryption at rest options

**Advanced Analytics**
- Custom event tracking configuration
- Advanced segmentation rules
- Predictive analytics toggle
- Machine learning model selection

#### Phase 4 Implementation Approach

Enterprise features are behind feature flags or separate tier. White-label removes all platform branding and is fully customizable. SSO requires careful user/team synchronization. Compliance features generate exportable reports for audit purposes.

---

## Part 3: Settings UI Experience

### Phase 1 UI Pattern

Simple, clean form-based interface:
- Grouped settings in clear sections
- Inline validation with helpful error messages
- Preview of color palette as it's being selected
- Rich text editors for policy fields
- Save button disables until changes made
- Success notification on save

### Phase 2+ UI Pattern

Progressive disclosure:
- Basic settings visible by default
- "Advanced" sections collapsible
- Integration setup via oauth/guided flow
- API key generation with copy-to-clipboard
- Webhook testing interface
- Settings change history timeline

---

## Part 4: Permission & Access Model

**Who Can Change Settings**

Owner only:
- Organization name and branding
- Business information
- Payment and tax settings
- Security policies
- Integrations (API keys)
- Custom domain
- White-label options

Admin + Owner (Phase 2+):
- Content defaults
- Email notification preferences
- Support contact information
- Some team settings

Creator/Member:
- View-only access to public settings
- Cannot change any settings

---

## Part 5: Security Considerations

**Sensitive Information Protection**
- API keys, tokens, secrets: Encrypted at rest
- Stripe keys: Never logged or displayed plaintext
- OAuth tokens: Refreshed automatically
- Settings changes: Logged with actor and timestamp

**Validation & Safety**
- Client-side format validation (email, color hex, etc.)
- Server-side validation on all changes
- Authorization checks on every settings change
- Rate limiting on sensitive operations
- Notification to owner when sensitive settings change

**Compliance**
- Settings audit trail for regulatory compliance
- Data retention policies enforcement
- GDPR data export capability
- Right to deletion support
- Terms and privacy policy hosting

---

## Part 6: Related Documentation

- **Auth EVOLUTION**: [authentication/EVOLUTION.md](../auth/EVOLUTION.md)
- **Admin Dashboard EVOLUTION**: [admin-dashboard/EVOLUTION.md](../admin-dashboard/EVOLUTION.md)
- **Content Access EVOLUTION**: [content-access/EVOLUTION.md](../content-access/EVOLUTION.md)
- **Phase 1 PRD**: [platform-settings/pdr-phase-1.md](./pdr-phase-1.md)
- **Phase 1 TDD**: [platform-settings/ttd-dphase-1.md](./ttd-dphase-1.md)

---

## Conclusion

Platform settings evolve from simple organization setup (Phase 1) to comprehensive integration management and enterprise compliance (Phase 4+). At each phase:

- Settings remain non-technical and owner-friendly
- New integrations are additive without breaking changes
- Sensitive data is encrypted and protected
- All changes are validated and audited
- Organization isolation is maintained throughout

This foundation allows quick Phase 1 launch while supporting enterprise needs in future phases.