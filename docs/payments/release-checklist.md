# Release checklist

Checks to run against **production** when a `dev` → `main` release carries a
payments change that moves data or money. Merging to `main` deploys, so the
"before" checks must be done first. Every query here is read-only.

**Where to run them:** the Neon console → the production project → SQL Editor.
Keep each result (a screenshot or CSV), so a later question about where money
went can be answered from what the data looked like at deploy time.

Remove a section once the release that needs it is live.

---

## Before the deploy: one owner per organisation (migration `0097`, PR #589)

**What changes.** Until this release, an organisation's share of a sale was
paid to the user in `organizations.primary_connect_account_user_id` (the "pin")
when one was set, and otherwise to the earliest-joined active owner. From this
release:

- an organisation has **exactly one** active owner — `0097` makes any extra
  owners admins;
- the organisation's share of a sale goes to whoever owned it **at the time of
  the sale**, read from the new `organization_ownership_periods` table; the pin
  is no longer read (dropping it is `Codex-2hxff.36`).

So for some organisations the payee changes on deploy, and an organisation with
no owner has no payee at all. R1–R4 list exactly which ones.

### R1 — organisations with more than one active owner

`0097` keeps the first user in each list (earliest-joined, then by id) as owner
and makes the rest admins.

```sql
SELECT organization_id, array_agg(user_id ORDER BY created_at, id) AS owners_kept_first
FROM organization_memberships
WHERE role = 'owner' AND status = 'active'
GROUP BY organization_id HAVING count(*) > 1;
```

- **No rows:** nothing to do.
- **Rows:** check the first user is the right owner. If not, deploy, then
  reassign the owner (see [Assigning an owner](#assigning-an-owner)).

### R2 — organisations with no active owner

These get no ownership period, so **their share of every sale has no payee: it
is logged and never recorded in the payouts ledger** (`Codex-2hxff.37`) — not
paid later either, because there is no ledger row to release.

```sql
SELECT o.id, o.slug, o.primary_connect_account_user_id AS pin
FROM organizations o
WHERE o.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.organization_id = o.id AND m.role = 'owner' AND m.status = 'active');
```

- **No rows:** nothing to do.
- **Rows:** give each one an owner. A row with a `pin` was being paid to the
  pin until now, so it appears in R3 as well.

### R3 — organisations whose payee changes on deploy

Today's payee is the pin; after the deploy it is the owner `0097` keeps.

```sql
WITH kept AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM organization_memberships
  WHERE role = 'owner' AND status = 'active'
  ORDER BY organization_id, created_at, id
)
SELECT o.id, o.slug, o.deleted_at,
       o.primary_connect_account_user_id AS pin_paid_today,
       k.user_id AS payee_after_deploy
FROM organizations o
LEFT JOIN kept k ON k.organization_id = o.id
WHERE o.primary_connect_account_user_id IS NOT NULL
  AND o.primary_connect_account_user_id IS DISTINCT FROM k.user_id;
```

- **No rows:** no organisation's payee changes.
- **`payee_after_deploy` set:** from the deploy that user is paid instead of
  the pin. If the pin is the right person, make them the owner after the
  deploy.
- **`payee_after_deploy` empty:** the organisation has no owner — same as R2.

### R4 — removed owners demoted to `member`

Informational. Rows for owners who left or were removed (`status` is not
`active`) still say `role = 'owner'`; `0097` changes them to `member` so a
later re-subscription can never make them owner again. No action.

```sql
SELECT organization_id, user_id, status, updated_at
FROM organization_memberships
WHERE role = 'owner' AND status <> 'active';
```

### Assigning an owner

The way to assign an owner arrives with this release: platform support calls

```
POST /api/admin/organizations/:orgId/owner      (admin-api, platform_owner)
{ "userId": "<new owner>", "reason": "<why, for the audit log>" }
```

- The new owner must already be an **active admin or creator** of the
  organisation. An organisation with nobody in those roles cannot be given an
  owner this way; add the person as an admin first.
- Any previous owner becomes an admin; an open ownership offer is withdrawn;
  the team is emailed.
- The new owner is paid for sales **from that moment on**. A sale between the
  deploy and the assignment stays unrecorded.

As of 2026-10-13 production takes no real payments (it runs on the Stripe
sandbox; see [status.md](status.md#decisions)), so assigning owners straight
after the deploy loses nothing. Once real payments
start, every R2 row must have an owner **before** a release like this one.

---

## After the deploy: the price-change email (migration `0098`, PR #590)

`0098` replaces "your subscription will renew at the new price on the next
billing cycle" in the `subscription-tier-price-change` email with the date the
new price applies (`Codex-2hxff.35`).

```sql
SELECT scope, organization_id,
       strpos(html_body, 'renews at the new price from') > 0 AS fixed_html,
       strpos(text_body, 'renews at the new price from') > 0 AS fixed_text
FROM email_templates
WHERE name = 'subscription-tier-price-change' AND deleted_at IS NULL;
```

Every row should show `true` / `true`. A `false` row is a copy someone reworded
(`0098` leaves those alone on purpose): read it and decide whether its wording
is still right.
