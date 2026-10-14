-- Codex-2hxff.35 — the price-change email tells subscribers when they move.
--
-- Since Codex-2hxff.3 (PR #589) a Studio price change reaches a subscriber at
-- their FIRST renewal at least 30 days after this email, so a monthly
-- subscriber renewing in 10 days renews once more at the old price. The
-- template still said "your subscription will renew at the new price on the
-- next billing cycle", which is now false. The seed was corrected, but
-- `seed-email-templates.ts` skips a template that already exists, so no deploy
-- ever reaches the row production has had since it was first seeded.
--
-- Replaces exactly that sentence and nothing else: a body that does not
-- contain it (edited since, or seeded after the fix) is left untouched. The
-- rest of the copy is byte-identical between the old and new seed, so on an
-- unedited row this yields exactly the current seed text. Org- and
-- creator-scoped copies are included: the sentence describes platform billing,
-- which is wrong whoever copied it.
UPDATE "email_templates"
SET
  "html_body" = replace(
    "html_body",
    'your subscription will renew at the new price on the next billing cycle.',
    'your subscription renews at the new price from {{effectiveDate}}. Renewals before then stay at your current price.'
  ),
  "text_body" = replace(
    "text_body",
    'your subscription will renew at the new price on the next billing cycle.',
    'your subscription renews at the new price from {{effectiveDate}}. Renewals before then stay at your current price.'
  ),
  "updated_at" = now()
WHERE "name" = 'subscription-tier-price-change'
  AND "deleted_at" IS NULL
  AND (
    strpos("html_body", 'your subscription will renew at the new price on the next billing cycle.') > 0
    OR strpos("text_body", 'your subscription will renew at the new price on the next billing cycle.') > 0
  );
