-- Codex-2hxff.29 (Q1), step 2 of 2 — `payout-released` says when each part of
-- the payout reaches the bank (mock-b-studio emails.html M5, M6).
--
-- Ships ONE RELEASE AFTER 0118 (Codex-2hxff.93). Production runs migrations
-- before the workers deploy, and notifications-api (which lists `bankSentence`
-- and `bankLines` for this template) deploys last. In 0118's own release the
-- previous notifications-api would have rendered this row with both fields
-- blank. From 0118's release on, the drain sends both fields (batch B design
-- §5.4, §5.5). It landed after release #662 carried 0118.
--
-- Replaces exactly 0118's interim line. Only a body that still has it also
-- gains the `{{bankLines}}` row, so an edited copy is left alone and a second
-- run changes nothing. A row seeded from the current seed already has this
-- copy, and has no interim line to match.
UPDATE "email_templates"
SET
  "html_body" = CASE
    WHEN strpos("html_body", '<p>Your Earnings page shows the date each payment goes to your bank.</p>') > 0
    THEN replace(
      replace(
        "html_body",
        '<p>Your Earnings page shows the date each payment goes to your bank.</p>',
        '<p>{{bankSentence}}</p>'
      ),
      '<strong>Payouts released:</strong> {{payoutCount}}</p></div>',
      '<strong>Payouts released:</strong> {{payoutCount}}</p><p style="margin:5px 0;">{{bankLines}}</p></div>'
    )
    ELSE "html_body"
  END,
  "text_body" = CASE
    WHEN strpos("text_body", 'Your Earnings page shows the date each payment goes to your bank.') > 0
    THEN replace(
      replace(
        "text_body",
        'Your Earnings page shows the date each payment goes to your bank.',
        '{{bankSentence}}'
      ),
      E'Payouts released: {{payoutCount}}\n\n{{bankSentence}}',
      E'Payouts released: {{payoutCount}}\n{{bankLines}}\n\n{{bankSentence}}'
    )
    ELSE "text_body"
  END,
  "updated_at" = now()
WHERE "name" = 'payout-released'
  AND "deleted_at" IS NULL
  AND (
    strpos("html_body", 'Your Earnings page shows the date each payment goes to your bank.') > 0
    OR strpos("text_body", 'Your Earnings page shows the date each payment goes to your bank.') > 0
  );
