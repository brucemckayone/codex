<!--
  @component SettingsGeneral

  General & Social settings for organisation admins: platform name, support
  email, contact URL, timezone, and the four social URLs.

  Uses `form()` progressive enhancement — works without JS, enhances with JS.
  Contact settings are fetched client-side to avoid __data.json round-trips.

  VALIDATION IS SURFACED, and that is the point of this file. The previous
  version read only `updateContactForm.result?.error`, which is populated
  exclusively by the try/catch inside the handler — i.e. by API failures.
  Schema failures short-circuit BEFORE the handler and land in the form's
  `issues`, which nothing read; combined with `novalidate` (which suppresses
  the browser's own bubbles) a bad email produced no role=alert, no
  aria-invalid and no error text at all. The server was answering
  `{"issues":[{"name":"supportEmail","message":"Invalid email format"}]}` and
  the UI was inert. Every control now spreads `fields.<name>.as(type)` — which
  is what carries `aria-invalid` — and renders `fields.<name>.issues()` beneath
  itself, wired with `aria-describedby`. `novalidate` stays deliberately: the
  server schema is the single source of truth, so all feedback arrives through
  one styled channel instead of two competing ones.

  Note on `.as()` arity: on SvelteKit 2.55 only `radio | submit | hidden |
  checkbox` accept a second `value` argument (see `AsArgs` in
  `@sveltejs/kit/types`), so text-ish fields are seeded through
  `fields.set(...)` below rather than `.as(type, value)`. Newer docs show the
  two-argument form; it does not typecheck here yet.

  @prop data - orgId from settings layout + org/userRole from studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import { getContactSettings, updateContactForm } from '$lib/remote/settings.remote';
  import { Alert, Button, Card, Label, Select } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';

  let { data } = $props();

  const orgId = $derived(data.org?.id);

  // Role guard: admin/owner only. Wait for data.userRole to populate —
  // studio is ssr=false, so on first render data.userRole is undefined
  // and a naive check redirects authorised users before the role is known.
  $effect(() => {
    if (
      data.userRole !== undefined &&
      data.userRole !== 'admin' &&
      data.userRole !== 'owner'
    ) {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');

  const contactQuery = $derived(
    isAuthorized ? getContactSettings(orgId) : null
  );

  const contact = $derived(contactQuery?.current);

  /**
   * FIRST-LOAD gate, not `contactQuery.loading`. `form()` invalidates every
   * live query after a successful submit, so a loading-gated skeleton replaced
   * the whole populated form with grey blocks on every save (measured
   * `hasForm:false, hasSkeleton:true` at t≈1.5s of a real save) and then
   * rebuilt it. `current` retains the previous value across a refresh, so
   * gating on "no value yet" shows the skeleton exactly once.
   */
  const showSkeleton = $derived(isAuthorized && contact === undefined);

  const fields = $derived(updateContactForm.fields);

  /**
   * Seed the submitted values from the loaded settings. Only re-runs when
   * `orgId` or the fetched `contact` changes — NOT on a rejected submit, which
   * neither refetches the query nor mutates it, so a user's typed values
   * survive a validation failure and come back populated.
   */
  $effect(() => {
    updateContactForm.fields.set({
      orgId,
      platformName: contact?.platformName ?? '',
      supportEmail: contact?.supportEmail ?? '',
      contactUrl: contact?.contactUrl ?? '',
      timezone: contact?.timezone ?? 'UTC',
      twitterUrl: contact?.twitterUrl ?? '',
      youtubeUrl: contact?.youtubeUrl ?? '',
      instagramUrl: contact?.instagramUrl ?? '',
      tiktokUrl: contact?.tiktokUrl ?? '',
    });
  });

  /**
   * Form-level issue list. Individual controls render their own issue too;
   * this is the summary a keyboard/screen-reader user lands on, and it is what
   * makes a rejected save legible when the offending field is scrolled out of
   * view. `allIssues()` returns undefined when the form is valid or has not
   * been submitted yet.
   */
  const allIssues = $derived(fields.allIssues() ?? []);

  /**
   * Enhanced purely to SUPPRESS the automatic form reset. An un-enhanced
   * `form()` resets the <form> after a successful submit, and because these
   * values are driven by `fields.set(...)` rather than by `value` attributes,
   * reset() blanked every input to its empty default — measured: every field
   * read "" for ~1s after a save, until the invalidated query refetched and
   * re-seeded them. `enhance` does not auto-reset (we simply never call
   * `form.element.reset()`), so the values stay put. `submit()` performs the
   * identical submission, so validation issues, `result` and the single-flight
   * query invalidation all behave exactly as before.
   */
  const enhanced = $derived(
    updateContactForm.enhance(async ({ submit }) => {
      await submit();
    })
  );

  const submitting = $derived(updateContactForm.pending > 0);

  /**
   * `result` is ephemeral — SvelteKit clears it on resubmit, navigation and
   * reload — so the confirmation needs no timer. The previous version removed
   * it after 3000ms, which raced the e2e assertion's own budget and could
   * retire the live region before a screen-reader user reached it.
   */
  const saved = $derived(
    updateContactForm.result?.success === true && !submitting
  );

  const apiError = $derived(
    updateContactForm.result?.success === false
      ? updateContactForm.result.error
      : undefined
  );

  // Common timezone options
  const timezoneOptions = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'Europe/London' },
    { value: 'Europe/Paris', label: 'Europe/Paris' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin' },
    { value: 'America/New_York', label: 'America/New_York' },
    { value: 'America/Chicago', label: 'America/Chicago' },
    { value: 'America/Denver', label: 'America/Denver' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
  ];

  let timezoneValue = $derived(contact?.timezone ?? 'UTC');

  /**
   * The shape `fields.<name>.as('text' | 'email' | 'url')` returns. Declared
   * locally because SvelteKit does not export the per-input-type variant by
   * name. It MUST reach the snippet by reference: `value` is a live accessor,
   * and copying it would freeze the field at its render-time value.
   */
  type TextFieldAttrs = {
    name: string;
    type?: 'text' | 'email' | 'url';
    'aria-invalid': boolean | 'false' | 'true' | undefined;
    value: string | number;
  };
</script>

<svelte:head>
  <title>{m.settings_general()} | {m.settings_title()}</title>
</svelte:head>

<!--
  One labelled text control plus its server-side issue. `id` does triple duty:
  label association, the issue node's id, and the `aria-describedby` target.
-->
{#snippet textField(f: {
  id: string;
  label: string;
  attrs: TextFieldAttrs;
  issues: readonly { message: string }[] | undefined;
  placeholder?: string;
  maxlength?: number;
})}
  <div class="form-field">
    <Label for={f.id}>{f.label}</Label>
    <input
      id={f.id}
      class="field-input"
      placeholder={f.placeholder}
      maxlength={f.maxlength}
      aria-describedby={f.issues && f.issues.length > 0
        ? `${f.id}-error`
        : undefined}
      {...f.attrs}
    />
    {#if f.issues && f.issues.length > 0}
      <p class="field-error" id={`${f.id}-error`}>{f.issues[0].message}</p>
    {/if}
  </div>
{/snippet}

{#if !isAuthorized}
  <!-- Redirecting... -->
{:else if showSkeleton}
  <div class="settings-form settings-skeleton">
    <div class="settings-skeleton-card">
      <div class="settings-skeleton-title">
        <Skeleton width="var(--space-32)" height="var(--text-lg)" />
      </div>
      {#each Array(4) as _, i (i)}
        <div class="settings-skeleton-field">
          <Skeleton width="var(--space-24)" height="var(--text-sm)" />
          <Skeleton width="100%" height="var(--space-10)" />
        </div>
      {/each}
    </div>
    <div class="settings-skeleton-card">
      <div class="settings-skeleton-title">
        <Skeleton width="var(--space-24)" height="var(--text-lg)" />
      </div>
      {#each Array(4) as _, i (i)}
        <div class="settings-skeleton-field">
          <Skeleton width="var(--space-20)" height="var(--text-sm)" />
          <Skeleton width="100%" height="var(--space-10)" />
        </div>
      {/each}
    </div>
    <Skeleton width="var(--space-20)" height="var(--space-10)" />
  </div>
{:else}
  <form {...enhanced} class="settings-form" novalidate>
    <input type="hidden" name="orgId" value={orgId} />

    <!-- Success. Alert derives role="status" for non-error variants, which is
         what `settings.spec.ts` waits on after Save. -->
    {#if saved}
      <Alert variant="success">
        {m.settings_saved()}
      </Alert>
    {/if}

    <!-- API failure (the handler's own try/catch). -->
    {#if apiError}
      <Alert variant="error">
        {apiError}
      </Alert>
    {/if}

    <!-- Schema failure. Alert derives role="alert" for the error variant, so
         this announces assertively — a rejected save is not a status update.
         No `{#each}` key: two URL fields rejected together produce two
         identical "Invalid URL" messages, and a duplicate key is a runtime
         error in Svelte 5.
         TODO(i18n): `settings_validation_summary` = "Some changes could not be
         saved". Listed for the orchestrator; en.json is owned by another
         worktree this round. -->
    {#if allIssues.length > 0}
      <Alert variant="error">
        <p class="issue-summary__title">Some changes could not be saved</p>
        <ul class="issue-summary__list">
          {#each allIssues as issue (`${issue.path.join('.')}|${issue.message}`)}
            <li>{issue.message}</li>
          {/each}
        </ul>
      </Alert>
    {/if}

    <!-- General Section. The card heading is "General", not "General
         Settings": the layout's <h1> already says "Settings", and with the
         one-item tab strip gone the page would otherwise read
         Settings → General → General Settings before the first field. -->
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>{m.settings_general()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div class="form-fields">
          {@render textField({
            id: 'platformName',
            label: m.settings_platform_name(),
            attrs: fields.platformName.as('text'),
            issues: fields.platformName.issues(),
            maxlength: 100,
          })}

          {@render textField({
            id: 'supportEmail',
            label: m.settings_support_email(),
            attrs: fields.supportEmail.as('email'),
            issues: fields.supportEmail.issues(),
          })}

          {@render textField({
            id: 'contactUrl',
            label: m.settings_contact_url(),
            attrs: fields.contactUrl.as('url'),
            issues: fields.contactUrl.issues(),
            placeholder: 'https://',
          })}

          <div class="form-field">
            <input type="hidden" name="timezone" value={timezoneValue} />
            <Select
              options={timezoneOptions}
              bind:value={timezoneValue}
              label={m.settings_timezone()}
              placeholder="Select timezone..."
            />
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Social Section -->
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>{m.settings_social_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div class="form-fields">
          {@render textField({
            id: 'twitterUrl',
            label: m.settings_twitter(),
            attrs: fields.twitterUrl.as('url'),
            issues: fields.twitterUrl.issues(),
            placeholder: 'https://twitter.com/...',
          })}

          {@render textField({
            id: 'youtubeUrl',
            label: m.settings_youtube(),
            attrs: fields.youtubeUrl.as('url'),
            issues: fields.youtubeUrl.issues(),
            placeholder: 'https://youtube.com/...',
          })}

          {@render textField({
            id: 'instagramUrl',
            label: m.settings_instagram(),
            attrs: fields.instagramUrl.as('url'),
            issues: fields.instagramUrl.issues(),
            placeholder: 'https://instagram.com/...',
          })}

          {@render textField({
            id: 'tiktokUrl',
            label: m.settings_tiktok(),
            attrs: fields.tiktokUrl.as('url'),
            issues: fields.tiktokUrl.issues(),
            placeholder: 'https://tiktok.com/...',
          })}
        </div>
      </Card.Content>
    </Card.Root>

    <div class="form-actions">
      <!-- ui/Button, not a hand-rolled `.btn`: it supplies aria-busy + the
           spinner from `loading`, which the previous submit button had no
           equivalent of. -->
      <Button type="submit" loading={submitting}>
        {m.settings_save()}
      </Button>
    </div>
  </form>
{/if}

<style>
  /* The FORM measure — the one that used to sit on `.settings-layout` and cap
     the masthead with it. Every control here holds a single short value (a
     name, an email, one URL), so the whole column reads at a form width while
     the header above it spans the studio column like Team's and Customers' do.
     Shared with the skeleton so the first paint does not reflow. */
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--container-md);
  }

  .settings-skeleton-card {
    padding: var(--space-6);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .settings-skeleton-title {
    margin-bottom: var(--space-4);
  }

  .settings-skeleton-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .settings-skeleton-field:last-child {
    margin-bottom: 0;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
  }

  .field-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
    border-color: var(--color-border-focus);
  }

  /* `aria-invalid` arrives from `fields.<name>.as(...)`, so the invalid ring is
     driven by the same source of truth as the message below the field. */
  .field-input[aria-invalid='true'] {
    border-color: var(--color-status-error-border);
  }

  /* Status family, not the raw --color-error-* palette: those steps are fixed
     light-mode sRGB declared at :root only, so they misfire on a dark theme or
     a branded org background. The --color-status-error-* triple derives from
     the surface it sits on, and is declared on `:root, [data-org-brand]` in
     styles/themes/status.css. */
  .field-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .issue-summary__title {
    margin: 0;
    font-weight: var(--font-medium);
  }

  .issue-summary__list {
    margin: var(--space-1) 0 0;
    padding-inline-start: var(--space-5);
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }
</style>
