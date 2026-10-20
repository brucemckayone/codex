-- Codex-2hxff.17 — the 30-day agreement email is a REVIEW reminder.
--
-- The term's end is a review date, not an expiry (owner decision AGR-01,
-- "Keeps paying"): an agreement past it keeps paying until either side ends
-- it or a renegotiated one replaces it. The email said the agreement
-- "expires" and that "after expiry the org reverts to keeping 100%", which is
-- now untrue. The seed was corrected, but `seed-email-templates.ts` skips a
-- template that already exists, so no deploy reaches the row production has
-- (the same reason as 0098 and 0102).
--
-- Replaces exactly the sentences that changed and nothing else, in global,
-- org- and creator-scoped copies alike. A body that no longer contains the old
-- closing sentence (already reworded, or customised) is left untouched, so the
-- migration is safe to run again.
UPDATE "email_templates"
SET
  "subject" = replace(
    "subject",
    'Revenue-share agreement with {{orgName}} expires soon',
    'Time to review your revenue-share agreement with {{orgName}}'
  ),
  "html_body" = replace(replace(replace(replace(
    "html_body",
    '<h1>Agreement expiring soon</h1>',
    '<h1>Agreement review due</h1>'),
    'is approaching its expiry date.</p>',
    'reaches its review date soon.</p>'),
    '<strong>Expires on:</strong>',
    '<strong>Review by:</strong>'),
    '<p>If you wish to extend or renegotiate, open a new proposal before the expiry date. After expiry the org reverts to keeping 100% of post-platform {{revenueTypeLabel}} revenue.</p>',
    '<p>Nothing changes on that date: the agreement keeps paying until either of you ends it, or a new agreement replaces it. To agree different terms, open a new proposal.</p>'
  ),
  "text_body" = replace(replace(replace(
    "text_body",
    'is approaching its expiry date.',
    'reaches its review date soon.'),
    'Expires on: {{expiryDate}}',
    'Review by: {{expiryDate}}'),
    'If you wish to extend or renegotiate, open a new proposal before the expiry date. After expiry the org reverts to keeping 100% of post-platform {{revenueTypeLabel}} revenue.',
    'Nothing changes on that date: the agreement keeps paying until either of you ends it, or a new agreement replaces it. To agree different terms, open a new proposal.'
  ),
  "updated_at" = now()
WHERE "name" = 'agreement-expiring-soon'
  AND "deleted_at" IS NULL
  AND strpos("html_body", 'After expiry the org reverts') > 0;
