-- The leaving notice's four emails (Codex-a6ofh.6.4): content-leaving,
-- content-leaving-reminder, content-staying and content-removed, exactly as
-- packages/database/scripts/seed-email-templates.ts has them (generated from
-- it). DATA ONLY, and additive: each is inserted unless a live global row of
-- the same name exists, so a second run, or the deploy's seed (which skips a
-- template that exists), never inserts it twice and never overwrites an
-- edited row. content-api's leaving sweep sends them; without them every
-- send is refused (404) and retried until its tries run out.
INSERT INTO "email_templates" ("name", "scope", "subject", "html_body", "text_body", "description", "status")
SELECT $tpl$content-leaving$tpl$, 'global', $tpl$"{{contentTitle}}" leaves {{platformName}} on {{leaveDate}}$tpl$,
  $tpl$<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>"{{contentTitle}}" is leaving</h1><p>Hi {{userName}},</p><p>{{creatorName}} is removing <strong>{{contentTitle}}</strong> from {{platformName}}. You own it, so it stays in your library until {{leaveDate}}. {{actionLabel}} before then.</p><p style="text-align:center;margin:30px 0;"><a href="{{contentUrl}}" class="button" style="color:white;">{{actionLabel}}</a></p><p>After {{leaveDate}} it won't be in your library. Questions? Write to <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p><div class="footer"><p>You're getting this because you own this piece on {{platformName}}.</p></div></div></body></html>$tpl$,
  $tpl$Hi {{userName}},

{{creatorName}} is removing "{{contentTitle}}" from {{platformName}}. You own it, so it stays in your library until {{leaveDate}}. {{actionLabel}} before then.

{{actionLabel}}: {{contentUrl}}

After {{leaveDate}} it won't be in your library. Questions? Write to {{supportEmail}}.

You're getting this because you own this piece on {{platformName}}.$tpl$,
  $tpl$Sent to each owner of a piece its creator deleted (Codex-a6ofh.6): it leaves in 30 days, and until then it stays theirs. The sender picks actionLabel: 'Download it' or 'Save it as a PDF' with the creator's download on, else 'Watch it', 'Listen to it' or 'Read it'.$tpl$,
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates"
  WHERE "name" = $tpl$content-leaving$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL
);
--> statement-breakpoint
INSERT INTO "email_templates" ("name", "scope", "subject", "html_body", "text_body", "description", "status")
SELECT $tpl$content-leaving-reminder$tpl$, 'global', $tpl$Reminder: "{{contentTitle}}" leaves {{platformName}} on {{leaveDate}}$tpl$,
  $tpl$<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>"{{contentTitle}}" leaves on {{leaveDate}}</h1><p>Hi {{userName}},</p><p><strong>{{contentTitle}}</strong> leaves {{platformName}} on {{leaveDate}}. {{actionLabel}} before then.</p><p style="text-align:center;margin:30px 0;"><a href="{{contentUrl}}" class="button" style="color:white;">{{actionLabel}}</a></p><p>After {{leaveDate}} it won't be in your library. Questions? Write to <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p><div class="footer"><p>You're getting this because you own this piece on {{platformName}}.</p></div></div></body></html>$tpl$,
  $tpl$Hi {{userName}},

"{{contentTitle}}" leaves {{platformName}} on {{leaveDate}}. {{actionLabel}} before then.

{{actionLabel}}: {{contentUrl}}

After {{leaveDate}} it won't be in your library. Questions? Write to {{supportEmail}}.

You're getting this because you own this piece on {{platformName}}.$tpl$,
  $tpl$Sent to everyone who owns a leaving piece 3 days before it goes (D9), whoever owns it then. The same tokens as content-leaving.$tpl$,
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates"
  WHERE "name" = $tpl$content-leaving-reminder$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL
);
--> statement-breakpoint
INSERT INTO "email_templates" ("name", "scope", "subject", "html_body", "text_body", "description", "status")
SELECT $tpl$content-staying$tpl$, 'global', $tpl$"{{contentTitle}}" is staying$tpl$,
  $tpl$<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>"{{contentTitle}}" is staying</h1><p>Hi {{userName}},</p><p>Good news: {{creatorName}} has decided to keep <strong>{{contentTitle}}</strong> on {{platformName}}. It stays in your library.</p><p style="text-align:center;margin:30px 0;"><a href="{{contentUrl}}" class="button" style="color:white;">Open it</a></p><div class="footer"><p>You're getting this because you own this piece on {{platformName}}.</p></div></div></body></html>$tpl$,
  $tpl$Hi {{userName}},

Good news: {{creatorName}} has decided to keep "{{contentTitle}}" on {{platformName}}. It stays in your library.

Open it: {{contentUrl}}

You're getting this because you own this piece on {{platformName}}.$tpl$,
  $tpl$Sent when the creator keeps a leaving piece, to each owner who may last have been told it leaves (Codex-a6ofh.6).$tpl$,
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates"
  WHERE "name" = $tpl$content-staying$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL
);
--> statement-breakpoint
INSERT INTO "email_templates" ("name", "scope", "subject", "html_body", "text_body", "description", "status")
SELECT $tpl$content-removed$tpl$, 'global', $tpl$"{{contentTitle}}" has been removed$tpl$,
  $tpl$<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>"{{contentTitle}}" has been removed</h1><p>Hi {{userName}},</p><p><strong>{{contentTitle}}</strong> has been removed from {{platformName}}, so it is no longer in your library.</p><p>Questions? Write to <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p><div class="footer"><p>You're getting this because you owned this piece on {{platformName}}.</p></div></div></body></html>$tpl$,
  $tpl$Hi {{userName}},

"{{contentTitle}}" has been removed from {{platformName}}, so it is no longer in your library.

Questions? Write to {{supportEmail}}.

You're getting this because you owned this piece on {{platformName}}.$tpl$,
  $tpl$Sent to each owner of a piece a platform admin took down at once (D9): no notice period and no download.$tpl$,
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates"
  WHERE "name" = $tpl$content-removed$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL
);
