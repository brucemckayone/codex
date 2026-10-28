-- Codex-2hxff.84 (from Codex-bnxhw) — the team-invitation email names the
-- organisation and opens it.
--
-- Adding someone to an organisation makes them a member at once
-- (`inviteMember` writes an active membership), so nothing is accepted and
-- nothing expires. The email said "has invited you to join", its "Accept
-- Invitation" button went to /accept-invite (a route the web app does not
-- have), and it said "This invitation expires in {{expiryDays}} days." Owner
-- decision 2026-10-27, "Open the org": the email names the organisation, and
-- its one button, "Open {{orgName}}", goes to the org Studio for an admin or
-- creator and to the organisation's home page for a member. The seed was
-- corrected, but `seed-email-templates.ts` skips a template that already
-- exists, so no deploy reaches the row production has (the same reason as
-- 0098, 0102 and 0106).
--
-- This ships ONE RELEASE AFTER the code that sends `orgUrl` and `roleLabel`.
-- Production runs migrations before the workers deploy. In the same release,
-- the previous notifications-api would render this row, and its allowlist has
-- no `orgUrl`: a blank button for the deploy window. That code also passes
-- `acceptUrl` (the same link), `expiryDays` and the plain `roleName`, which the
-- stock row uses until this runs.
--
-- Every change replaces one exact phrase wherever it is, in global, org- and
-- creator-scoped copies alike:
--   - the `{{acceptUrl}}` token becomes `{{orgUrl}}`, so a customised copy
--     keeps its own words and its button still opens the organisation once
--     the sender stops passing `acceptUrl` (Codex-2hxff.83);
--   - the stock expiry sentence goes;
--   - the stock wording becomes the new wording;
--   - "as a {{roleName}}" becomes "as {{roleLabel}}", which carries its
--     article ("as an admin", where the stock row said "as a admin"). Any
--     other `{{roleName}}` keeps the plain role.
-- A phrase that is absent is left alone, and only a row that changes is
-- written, so a second run changes nothing.
--
-- A customised copy with its OWN expiry wording keeps `{{expiryDays}}`:
-- nothing here can reword a sentence it doesn't know. It renders "7" while
-- the sender passes it. Once Codex-2hxff.83 stops passing it, each send of
-- such a row is warned by NotificationsService ("Email data lacks tokens its
-- template uses"), or, if the allowlist drops it too, "uses tokens it does
-- not allow".
UPDATE "email_templates" AS "t"
SET
  "subject" = "n"."subject",
  "html_body" = "n"."html_body",
  "text_body" = "n"."text_body",
  "updated_at" = now()
FROM (
  SELECT
    "id",
    replace(
      "subject",
      'You''ve been invited to {{orgName}}',
      'You''ve been added to {{orgName}}'
    ) AS "subject",
    replace(replace(replace(replace(replace(replace(replace(
      "html_body",
      '<h1>You''ve been invited!</h1>',
      '<h1>You''ve been added to {{orgName}}</h1>'),
      'has invited you to join',
      'has added you to'),
      'as a <strong>{{roleName}}</strong>',
      'as <strong>{{roleLabel}}</strong>'),
      'as a {{roleName}}',
      'as {{roleLabel}}'),
      '>Accept Invitation</a>',
      '>Open {{orgName}}</a>'),
      '<p style="color:#666;font-size:13px;">This invitation expires in {{expiryDays}} days.</p>',
      ''),
      '{{acceptUrl}}',
      '{{orgUrl}}'
    ) AS "html_body",
    replace(replace(replace(replace(replace(
      "text_body",
      'has invited you to join',
      'has added you to'),
      'as a {{roleName}}',
      'as {{roleLabel}}'),
      'Accept your invitation: {{acceptUrl}}',
      'Open {{orgName}}: {{orgUrl}}'),
      E'\n\nThis invitation expires in {{expiryDays}} days.',
      ''),
      '{{acceptUrl}}',
      '{{orgUrl}}'
    ) AS "text_body"
  FROM "email_templates"
  WHERE "name" = 'org-member-invitation'
    AND "deleted_at" IS NULL
) AS "n"
WHERE "t"."id" = "n"."id"
  AND ("t"."subject", "t"."html_body", "t"."text_body")
    IS DISTINCT FROM ("n"."subject", "n"."html_body", "n"."text_body");
