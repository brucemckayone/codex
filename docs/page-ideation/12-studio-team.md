# Org Studio Team — Feature Ideation

**Route**: `{slug}.*/studio/team` → `_org/[slug]/studio/team/+page.svelte`
**Current state**: Basic team member list with role display. Invite functionality.
**Priority**: LOW — admin-only, lower traffic.

---

## Vision

Team management for orgs. Simple, clear, role-focused. Admins manage who can do what.

---

## Team Member List

### Table
- Avatar, Name, Email, Role (Owner/Admin/Creator), Joined, Last Active, Content Count, Actions
- Role badges: Color-coded (Owner=purple, Admin=blue, Creator=green)
- "Invite Member" CTA button (prominent)

### Actions Per Member
- Change role (dropdown)
- Remove from org (with confirmation)
- View their content → filtered content list
- Send message (future)

---

## Invite Flow

### Invite Modal
- Email input (single or multi-line for bulk)
- Role selector: Admin or Creator
- Personal message (optional): "Hey, join our yoga studio!"
- "Send Invite" button
- Pending invites list with: Email, Role, Sent date, Status (pending/accepted/expired), Resend/Cancel

---

## Role Permissions Display

### Visual Permission Matrix
- Table showing what each role can do:
  - | Feature | Creator | Admin | Owner |
  - | Create content | Yes | Yes | Yes |
  - | Publish content | No | Yes | Yes |
  - | View analytics | Own only | All | All |
  - | Manage team | No | Yes | Yes |
  - | Billing | No | No | Yes |
- Helps admins understand what they're granting

---

## Priority Ideas (Top 3)

1. **Clear role permission matrix** visible when inviting
2. **Pending invites management** with resend/cancel
3. **Per-member content count** and last-active tracking
