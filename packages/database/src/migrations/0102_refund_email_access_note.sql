-- Codex-2hxff.8 — the refund email says whether the buyer keeps access.
--
-- A partial refund now keeps access (owner decision P-1, "Keep access"), and a
-- charge refunded in parts sends one email per refund (owner decision
-- 2026-10-19, "One per refund"). So "Your refund has been processed." gains
-- {{accessNote}}: "You keep access to …" or "Your access to … has ended.", and
-- empty for a subscription's charge. The seed was corrected, but
-- `seed-email-templates.ts` skips a template that already exists, so no deploy
-- ever reaches the row production has had since it was first seeded (the same
-- reason as 0098_price_change_email_copy).
--
-- Appends the token to exactly that sentence and nothing else: a body that no
-- longer contains it, or already has the token, is left untouched. Org- and
-- creator-scoped copies are included, so their buyers are told too.
UPDATE "email_templates"
SET
  "html_body" = replace(
    "html_body",
    '<p>Your refund has been processed.</p>',
    '<p>Your refund has been processed. {{accessNote}}</p>'
  ),
  "text_body" = replace(
    "text_body",
    'Your refund has been processed.' || E'\n',
    'Your refund has been processed. {{accessNote}}' || E'\n'
  ),
  "updated_at" = now()
WHERE "name" = 'refund-processed'
  AND "deleted_at" IS NULL
  AND strpos("html_body", '{{accessNote}}') = 0
  AND strpos("text_body", '{{accessNote}}') = 0
  AND (
    strpos("html_body", '<p>Your refund has been processed.</p>') > 0
    OR strpos("text_body", 'Your refund has been processed.' || E'\n') > 0
  );
