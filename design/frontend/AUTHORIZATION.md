# Authorization

**Status**: Design
**Last Updated**: 2026-01-10

---

## Role System

Codex uses two levels of roles:

### Platform Role

Every user has a platform-level role in the `users` table:

| Role | Description |
|------|-------------|
| `customer` | Default role for all users |

**Note**: Currently only `customer` exists. Platform admin roles may be added later.

### Organization Membership Role

Users can have different roles in different organizations via `organizationMemberships`:

| Role | Description |
|------|-------------|
| `owner` | Full org control: billing, team, settings |
| `admin` | Content management, customer support |
| `creator` | Create and manage own content |
| `subscriber` | Subscription-based content access |
| `member` | Basic org membership |

---

## Role Hierarchy

Roles are hierarchical—higher roles inherit lower role permissions:

```mermaid
graph TD
    Owner[owner] --> Admin[admin]
    Admin --> Creator[creator]
    Creator --> Subscriber[subscriber]
    Subscriber --> Member[member]
```

An `owner` can do anything an `admin`, `creator`, `subscriber`, or `member` can do.

---

## Context Resolution

Authorization requires knowing both the user and the context:

```mermaid
graph TD
    Request[Incoming Request] --> Auth{Authenticated?}
    Auth -->|No| Public[Public Access Only]
    Auth -->|Yes| Context{Which Context?}

    Context --> Personal[Personal Creator Context]
    Context --> Org[Organization Context]

    Personal --> PersonalCheck{Is owner of username?}
    Org --> OrgCheck{Org membership role?}

    PersonalCheck -->|Yes| PersonalAccess[Personal Studio Access]
    PersonalCheck -->|No| PublicProfile[Public Profile Only]

    OrgCheck --> RoleGate[Role-Gated Access]
```

### Context Determination

| Subdomain | Context | How Resolved |
|-----------|---------|--------------|
| `creators.*.studio/{username}/studio` | Personal | Username must match authenticated user |
| `{org-slug}.*` | Organization | Lookup user's membership in org |
| `revelations.studio` | Platform | Platform role (if any) |

---

## Permission Matrix

### Personal Creator Context

| Resource | Owner | Others |
|----------|-------|--------|
| View profile | ✓ | ✓ |
| View content | ✓ | ✓ (if published) |
| Access studio | ✓ | ✗ |
| Manage content | ✓ | ✗ |
| Manage settings | ✓ | ✗ |

### Organization Context

| Resource | Owner | Admin | Creator | Subscriber | Member |
|----------|-------|-------|---------|------------|--------|
| View space | ✓ | ✓ | ✓ | ✓ | ✓ |
| View content | ✓ | ✓ | ✓ | ✓ | ✓ |
| Purchase content | ✓ | ✓ | ✓ | ✓ | ✓ |
| Access library | ✓ | ✓ | ✓ | ✓ | ✓ |
| Access studio | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create content | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage own content | ✓ | ✓ | ✓ | ✗ | ✗ |
| Manage all content | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage team | ✓ | ✓ | ✗ | ✗ | ✗ |
| View customers | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage billing | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage org settings | ✓ | ✗ | ✗ | ✗ | ✗ |

---

## Guard Patterns

### Layout-Level Guards

Route groups have `+layout.server.ts` that enforce access:

```mermaid
graph TD
    Request[Request to /studio] --> LayoutLoad[+layout.server.ts]
    LayoutLoad --> AuthCheck{Authenticated?}
    AuthCheck -->|No| Redirect[Redirect to /login]
    AuthCheck -->|Yes| OrgCheck{Org exists?}
    OrgCheck -->|No| 404[404 Not Found]
    OrgCheck -->|Yes| RoleCheck{Has creator+ role?}
    RoleCheck -->|No| 403[403 Forbidden]
    RoleCheck -->|Yes| Allow[Allow Access]
```

### Guard Hierarchy

| Route Group | Guards Applied |
|-------------|----------------|
| `(space)` | None (public) |
| `(app)` | Require authentication |
| `studio` | Require authentication + creator role |

### Fine-Grained Guards

Some actions require additional checks beyond role:

| Action | Additional Check |
|--------|------------------|
| Edit content | Must be content creator OR admin+ |
| Delete content | Must be content creator OR admin+ |
| Manage team member | Cannot demote self if last owner |
| Access billing | Owner only |

---

## Frontend vs Backend Authorization

### Frontend (UX Only)

- Hide UI elements user shouldn't see
- Disable buttons for actions user can't take
- Never trust for security

### Backend (Actual Security)

- Every API endpoint validates permissions
- Database queries scoped by user/org
- Workers enforce role requirements

```mermaid
graph LR
    subgraph "Frontend (UX)"
        UI[Hide/Show UI]
    end

    subgraph "Backend (Security)"
        API[API Validation]
        DB[Query Scoping]
    end

    UI -.->|Not trusted| API
    API --> DB
```

**Rule**: If a user manipulates the frontend to show a hidden button and clicks it, the backend must still reject the action.

---

## Organization Resolution

The hooks resolve organization and membership:

```mermaid
sequenceDiagram
    participant Request
    participant Hooks
    participant IdentityAPI

    Request->>Hooks: yoga-studio.*/studio
    Hooks->>Hooks: Extract subdomain
    Hooks->>IdentityAPI: GET /org/slug/yoga-studio

    alt Org exists
        IdentityAPI->>Hooks: {org}
        Hooks->>Hooks: Set locals.organization

        alt User authenticated
            Hooks->>IdentityAPI: GET /org/{id}/membership/{userId}
            IdentityAPI->>Hooks: {role}
            Hooks->>Hooks: Set locals.organizationRole
        end
    else Org not found
        IdentityAPI->>Hooks: 404
        Hooks->>Request: 404 page
    end
```

### Locals After Resolution

| Property | Type | Description |
|----------|------|-------------|
| `organization` | `Organization \| null` | Current org (if on org subdomain) |
| `organizationRole` | `Role \| null` | User's role in current org |

---

## Multi-Org Users

Users can have memberships in multiple organizations with different roles:

```mermaid
graph TD
    User[Alice] --> M1[yoga-studio: creator]
    User --> M2[cooking-school: owner]
    User --> M3[fitness-club: admin]
```

The role is always resolved **per request** based on which org subdomain is being accessed.

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Not authenticated | Redirect to `/login?redirect=...` |
| Org not found | 404 page |
| No membership | Redirect to org home (public) |
| Insufficient role | 403 page or redirect |

---

## Related Documents

- [AUTH.md](./AUTH.md) - How authentication works
- [ROUTING.md](./ROUTING.md) - Route structure and guards
