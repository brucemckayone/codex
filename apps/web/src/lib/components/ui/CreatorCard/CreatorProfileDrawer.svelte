<!--
  @component CreatorProfileDrawer

  A fast preview of a creator that saves a page load. Opens as a right panel
  (desktop) or bottom sheet (mobile), with the canonical profile page as its one
  primary action.

  The hero photo sits at the top with the creator's name + role overlaid on a
  gradient fade; bio, social links, latest content and the profile link follow.

  ## Measured defects this fixes

  1. **The panel was 672px, not the 448px it declared.** Its own
     `max-width: 28rem` never applied — `.dialog-content[data-size='md']` wins on
     specificity and source order. Passing `size="sm"` gets the intended width
     from the primitive instead of fighting it with `:global()`.

     `[data-size]` outranks a two-class `:global()` in BOTH directions, which is
     the trap this fix first walked into: with `size="sm"` the primitive's
     `.dialog-content[data-size='sm']` — (0,3,0) once Svelte appends its scoping
     class — also beat the mobile override's `.dialog-content.creator-drawer`
     at (0,2,0), so the bottom sheet's `max-width: 100%` was dead CSS and the
     sheet clamped to 448px on any viewport between 448px and 640px. Fixed with
     `min-inline-size` rather than a bigger selector: min-width wins the
     used-width constraint resolution regardless of which `max-width` cascaded,
     so the sheet is full-bleed without a specificity arms race.
  2. **It opened scrolled 630px down.** The dialog moves initial focus to the
     first focusable descendant, which used to be a social link deep in the body,
     and the browser scrolled it into view — so you opened a person's profile and
     saw a cropped mid-body detail instead of their face. The dismiss control is
     now the FIRST focusable element, so focus lands at the top.
  3. **The close button could leave the viewport.** The primitive's
     `.dialog-close` is `position: absolute` inside this scroll container, so at
     scrollTop 630 it measured y=-618 — off-screen, with Esc and overlay-click the
     only ways out, and no visible dismiss at all on the mobile sheet. This drawer
     supplies its own sticky one and hides the primitive's.
  4. **The panel had no accessible name.** Melt's dialog builder emits
     `aria-labelledby={titleId}` on the content element unconditionally, and this
     was the only one of the app's `Dialog.Content` consumers that never rendered
     a `Dialog.Title` — so the reference dangled, there was no `aria-label`, and
     `role="dialog"` does not permit name-from-content. The hero name now renders
     THROUGH `Dialog.Title`, which wires it to that id.
  5. **Focus was not restored on close.** Fixing initial focus (defect 2) left
     the other half open: this drawer is opened programmatically from a card's
     hit area, never from a `Dialog.Trigger`, so Melt had no restore target and
     Escape dropped focus to `<body>`. The caller passes the triggering element
     through `closeFocus`.

  @prop {boolean} open - Whether the drawer is open (bindable)
  @prop {CreatorDrawerData | null} creator - Creator data to display
  @prop {string} orgSlug - Organization slug (for content links)
  @prop {(open: boolean) => void} [onOpenChange] - Callback when open state changes
  @prop {CreateDialogProps['closeFocus']} [closeFocus] - Element/getter to refocus on close
-->
<script lang="ts">
  import type { CreateDialogProps } from '@melt-ui/svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/Badge';
  import CreatorPortrait from './CreatorPortrait.svelte';
  import {
    GlobeIcon,
    TwitterIcon,
    YoutubeIcon,
    InstagramIcon,
    ChevronRightIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import { buildCreatorsUrl, buildContentUrl, buildOrgUrl } from '$lib/utils/subdomain';
  import { formatRelativeTime } from '$lib/utils/format';

  import type { CreatorDrawerData } from './types';
  export type { CreatorDrawerData };

  interface Props {
    open?: boolean;
    creator: CreatorDrawerData | null;
    orgSlug: string;
    onOpenChange?: (open: boolean) => void;
    /**
     * Where focus goes when the drawer closes. This drawer is always opened
     * programmatically, so Melt has no trigger to restore to — see the docblock's
     * defect 5. Pass a getter, not an element: the trigger changes per open.
     */
    closeFocus?: CreateDialogProps['closeFocus'];
  }

  let {
    open = $bindable(false),
    creator,
    orgSlug,
    onOpenChange,
    closeFocus,
  }: Props = $props();

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
  }

  const displayName = $derived(creator?.name ?? '');
  const hasSocialLinks = $derived(
    creator?.socialLinks != null &&
      (!!creator.socialLinks.website ||
        !!creator.socialLinks.twitter ||
        !!creator.socialLinks.youtube ||
        !!creator.socialLinks.instagram)
  );

  const profileUrl = $derived(
    creator?.username
      ? buildCreatorsUrl(page.url, `/@${creator.username}`)
      : null
  );

  const roleLabel = $derived.by(() => {
    switch (creator?.role) {
      case 'owner': return m.creator_drawer_role_owner();
      case 'admin': return m.creator_drawer_role_admin();
      default: return m.creator_drawer_role_creator();
    }
  });
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange} {closeFocus}>
  <Dialog.Content class="creator-drawer" size="sm">
    {#if creator}
      <!--
        First focusable element in the panel, on purpose: the dialog focuses its
        first focusable descendant on open, so putting the dismiss control here is
        what keeps the panel scrolled to the top. It is also sticky, so it stays
        reachable however far the body scrolls.
      -->
      <div class="drawer-bar">
        <!--
          `common_close` has now landed, so this reads from the message rather than
          the literal it previously mirrored. `DialogContent.svelte` still hardcodes
          its own `aria-label="Close"` — swapping a primitive with 14 consumers is
          its own change, tracked separately, so the two agree in output today but
          not yet in source.
        -->
        <button
          type="button"
          class="drawer-bar__close"
          aria-label={m.common_close()}
          onclick={() => handleOpenChange(false)}
        >
          <XIcon size={18} />
        </button>
      </div>

      <!-- Mobile drag handle -->
      <div class="drawer-handle" aria-hidden="true">
        <span class="drawer-handle__bar"></span>
      </div>

      <!-- ═══ HERO PHOTO ═══
           Square, so the body starts above the fold. It was 3:4, which at the
           panel's real 672px width rendered 671×895 and filled a 900px viewport
           on its own. -->
      <CreatorPortrait
        src={creator.avatarUrl}
        name={displayName}
        aspect="square"
        size="lg"
        eager
      >
        <!-- Gradient overlay with name.
             `Dialog.Title`, not a bare <h2>: it renders the same <h2> but wires
             it to `use:melt={$title}`, which is the id Melt already points the
             panel's `aria-labelledby` at. Without it that reference dangles and
             the dialog has no accessible name at all. -->
        <div class="drawer-hero__overlay">
          <Dialog.Title class="drawer-hero__name">{displayName}</Dialog.Title>
          <div class="drawer-hero__meta">
            {#if creator.username}
              <span class="drawer-hero__username">@{creator.username}</span>
            {/if}
            <Badge variant="neutral">{roleLabel}</Badge>
          </div>
        </div>
      </CreatorPortrait>

      <!-- ═══ BODY ═══ -->
      <div class="drawer-body">
        <!-- Bio -->
        {#if creator.bio}
          <p class="drawer-bio">{creator.bio}</p>
        {/if}

        <!-- Stats row -->
        <div class="drawer-stats">
          {#if creator.contentCount > 0}
            <span class="drawer-stats__item">
              {creator.contentCount === 1
                ? m.creator_drawer_content_items_one()
                : m.creator_drawer_content_items({ count: creator.contentCount })}
            </span>
          {/if}
          <span class="drawer-stats__item">
            {m.creator_drawer_joined({ date: formatRelativeTime(creator.joinedAt) })}
          </span>
        </div>

        <!-- Social Links -->
        {#if hasSocialLinks}
          <div class="drawer-social">
            {#if creator.socialLinks?.website}
              <a
                href={creator.socialLinks.website}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_website()}
              >
                <GlobeIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.twitter}
              <a
                href={creator.socialLinks.twitter}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_twitter()}
              >
                <TwitterIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.youtube}
              <a
                href={creator.socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_youtube()}
              >
                <YoutubeIcon size={20} />
              </a>
            {/if}

            {#if creator.socialLinks?.instagram}
              <a
                href={creator.socialLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                class="drawer-social__link"
                aria-label={m.creator_visit_instagram()}
              >
                <InstagramIcon size={20} />
              </a>
            {/if}
          </div>
        {/if}

        <!-- Other Organizations -->
        {#if creator.organizations.length > 0}
          <div class="drawer-orgs">
            <h3 class="drawer-orgs__heading">{m.creator_drawer_also_on()}</h3>
            <div class="drawer-orgs__row">
              {#each creator.organizations as org (org.slug)}
                <!--
                  `aria-label`, not `title`. These tiles are logo-or-initial, so
                  name-from-content gave a logo-less org a link whose entire
                  accessible name was one letter, and `title` is pointer-only
                  disclosure that accname never reaches once there is content to
                  read (WCAG 2.4.4). An explicit label outranks both, so the logo
                  is then decorative — `alt=""` keeps it from announcing twice.
                -->
                <a
                  href={buildOrgUrl(page.url, org.slug, '/')}
                  class="drawer-orgs__item"
                  aria-label={org.name}
                  title={org.name}
                >
                  {#if org.logoUrl}
                    <img src={org.logoUrl} alt="" class="drawer-orgs__logo" />
                  {:else}
                    <span class="drawer-orgs__initial" aria-hidden="true">
                      {org.name.charAt(0)}
                    </span>
                  {/if}
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Content Gallery -->
        {#if creator.recentContent.length > 0}
          <div class="drawer-content">
            <h3 class="drawer-content__heading">{m.creator_drawer_latest()}</h3>
            <div class="drawer-content__grid">
              {#each creator.recentContent as item (item.slug)}
                <a
                  href={buildContentUrl(page.url, { slug: item.slug, id: item.slug })}
                  class="drawer-content__item"
                >
                  {#if item.thumbnailUrl}
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      class="drawer-content__thumb"
                      loading="lazy"
                    />
                  {:else}
                    <div class="drawer-content__thumb drawer-content__thumb--empty">
                      <span class="drawer-content__thumb-type">{item.contentType}</span>
                    </div>
                  {/if}
                  <span class="drawer-content__title">{item.title}</span>
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- View Full Profile -->
        {#if profileUrl}
          <a href={profileUrl} class="drawer-profile-link">
            <span>{m.creator_drawer_view_profile()}</span>
            <ChevronRightIcon size={16} />
          </a>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /* ═══════════════════════════════════════════════════════════
     ANIMATIONS — Disney principles: ease-out entrance, overshoot settle
     ═══════════════════════════════════════════════════════════ */

  /* Desktop: slide in from right with deceleration */
  @keyframes drawer-slide-in-right {
    0% {
      transform: translateX(100%);
      opacity: 0;
    }
    60% {
      opacity: 1;
    }
    100% {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Mobile: slide up from bottom with slight overshoot (follow-through) */
  @keyframes drawer-slide-in-bottom {
    0% {
      transform: translateY(100%);
      opacity: 0;
    }
    70% {
      transform: translateY(-2%);
      opacity: 1;
    }
    100% {
      transform: translateY(0);
      opacity: 1;
    }
  }

  /* Overlay fade-in */
  @keyframes drawer-overlay-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Apply overlay fade to the dialog overlay when drawer is open */
  :global(.dialog-content.creator-drawer ~ .dialog-overlay),
  :global(.dialog-overlay:has(~ .dialog-content-wrapper .creator-drawer)) {
    animation: drawer-overlay-fade var(--duration-slow) var(--ease-out) both;
  }

  /* ═══════════════════════════════════════════════════════════
     DRAWER CONTAINER
     Desktop: right-aligned panel, no padding (hero is edge-to-edge)
     Mobile: bottom sheet
     ═══════════════════════════════════════════════════════════ */
  /* Width comes from `size="sm"` on Dialog.Content, not from here: a local
     `max-width` loses to `.dialog-content[data-size]` on specificity, which is
     why this panel silently rendered at 672px for so long. */
  :global(.dialog-content.creator-drawer) {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
    animation: drawer-slide-in-right var(--duration-slower) var(--ease-out) both;
  }

  @media (--below-sm) {
    :global(.dialog-content.creator-drawer) {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      /* `min-inline-size`, not `max-width`. `size="sm"` puts
         `.dialog-content[data-size='sm'] { max-width: 28rem }` on this element at
         (0,3,0) once Svelte appends its scoping class, which outranks this
         two-class `:global()` at (0,2,0) — media queries add no specificity — so
         a local `max-width: 100%` here was dead CSS and the sheet clamped to
         448px across the whole 448–640px band. min-width wins the used-width
         constraint resolution (`max(min-width, min(max-width, width))`) whatever
         max-width cascaded, so this is full-bleed without a specificity fight. */
      min-inline-size: 100%;
      width: 100%;
      height: auto;
      max-height: 90vh;
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      border-left: none;
      border-top: var(--border-width) var(--border-style) var(--color-border);
      animation-name: drawer-slide-in-bottom;
    }
  }

  /* ── Dismiss bar ──
     Sticky and zero-height so it floats the close control over the hero without
     costing layout, and cannot scroll out of reach. The primitive's own
     `.dialog-close` is hidden for this variant: it renders last in the DOM and is
     absolutely positioned inside this scroll container, so it was both the wrong
     initial focus target and off-screen once the body scrolled. */
  .drawer-bar {
    position: sticky;
    inset-block-start: 0;
    z-index: 4;
    block-size: 0;
    display: flex;
    justify-content: flex-end;
  }

  :global(.dialog-content.creator-drawer > .dialog-close) {
    display: none;
  }

  .drawer-bar__close {
    display: flex;
    align-items: center;
    justify-content: center;
    /* 44px touch target. */
    inline-size: var(--space-11);
    block-size: var(--space-11);
    margin: var(--space-3);
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    /* Player tokens: this control sits on a photograph, so it needs the fixed
       white-on-dark chrome palette rather than theme-following ink that would
       vanish against a light portrait. */
    color: var(--color-player-text);
    background: var(--color-player-overlay);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
    transition: var(--transition-colors);
  }

  .drawer-bar__close:hover {
    background: var(--color-player-overlay-heavy);
  }

  .drawer-bar__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  /* ── Drag handle (mobile only) ── */
  .drawer-handle {
    display: none;
    justify-content: center;
    padding: var(--space-3) 0 0;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
  }

  @media (--below-sm) {
    .drawer-handle {
      display: flex;
    }
  }

  .drawer-handle__bar {
    width: var(--space-10);
    height: var(--space-1);
    background: var(--color-border-strong);
    border-radius: var(--radius-full);
  }

  /* ═══════════════════════════════════════════════════════════
     HERO PHOTO — Full-bleed, name overlaid on gradient
     Staged entrance: hero fades in, then body content follows
     ═══════════════════════════════════════════════════════════ */

  @keyframes drawer-content-fade-up {
    from {
      opacity: 0;
      transform: translateY(var(--space-4));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* The hero frame, the photo and the monogram fallback all live in
     CreatorPortrait now, square at every viewport. */

  /* Gradient overlay — fades from transparent to dark at bottom */
  .drawer-hero__overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: var(--space-16) var(--space-6) var(--space-6);
    background: linear-gradient(
      to top,
      var(--color-player-overlay) 0%,
      var(--color-player-overlay) 50%,
      transparent 100%
    );
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    animation: drawer-content-fade-up var(--duration-slower) var(--ease-out) both;
    animation-delay: var(--duration-normal);
  }

  /* `:global()` + three classes, both deliberate. `Dialog.Title` owns this
     element, so Svelte does not stamp this component's scoping class onto it —
     hence `:global()`. And DialogTitle's own `.dialog-title` rule is (0,2,0)
     with its scoping class, so a one-class `:global(.drawer-hero__name)` at
     (0,1,0) would lose and the name would render at --text-xl in --color-text.
     `.dialog-content.creator-drawer` is (0,3,0) and mirrors the panel selectors
     above, so it wins without depending on stylesheet order. */
  :global(.dialog-content.creator-drawer .drawer-hero__name) {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    /* --color-player-text, NOT --color-text-inverse. The scrim behind this is
       --color-player-overlay, a FIXED dark wash that does not follow the theme,
       so its text partner has to be fixed light too. `--color-text-inverse` is
       the inverse of the CURRENT theme, which on a dark org resolves to
       near-black — this name was rendering black on black and was unreadable. */
    color: var(--color-player-text);
    line-height: var(--leading-tight);
    text-shadow: 0 var(--border-width) var(--space-1) var(--color-player-overlay);
    /* `.dialog-title` reserves a gutter for the primitive's absolute close
       button. This panel hides that button and floats its own sticky one in a
       zero-height bar, so the gutter would just shove the name off-centre. */
    padding-inline-end: 0;
  }

  .drawer-hero__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .drawer-hero__username {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
    text-shadow: 0 var(--border-width) var(--space-0-5) var(--color-player-overlay);
  }

  /* ═══════════════════════════════════════════════════════════
     BODY — Content below the hero
     ═══════════════════════════════════════════════════════════ */
  .drawer-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
    animation: drawer-content-fade-up var(--duration-slower) var(--ease-out) both;
    animation-delay: calc(var(--duration-slow) * 1.17);
  }

  @media (--below-sm) {
    .drawer-body {
      padding: var(--space-5);
      padding-bottom: var(--space-8);
    }
  }

  /* ── Bio ── */
  .drawer-bio {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  /* ── Stats ── */
  .drawer-stats {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .drawer-stats__item {
    font-size: var(--text-sm);
    /* Secondary, not muted: these are 13-15px labels, so 4.5:1 applies, and
       muted measures 3.62:1 here (2.42:1 on a plain-brand light org). The size,
       weight, tracking and uppercase treatment already make them read quiet. */
    color: var(--color-text-secondary);
  }

  /* ── Social links ── */
  .drawer-social {
    display: flex;
    gap: var(--space-3);
  }

  .drawer-social__link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-lg);
    transition: var(--transition-colors);
  }

  .drawer-social__link:hover {
    color: var(--color-text);
    background: var(--color-surface-variant, var(--color-surface-tertiary));
  }

  /* ── Other orgs row ── */
  .drawer-orgs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .drawer-orgs__heading {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    /* Secondary, not muted: these are 13-15px labels, so 4.5:1 applies, and
       muted measures 3.62:1 here (2.42:1 on a plain-brand light org). The size,
       weight, tracking and uppercase treatment already make them read quiet. */
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .drawer-orgs__row {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .drawer-orgs__row::-webkit-scrollbar {
    display: none;
  }

  .drawer-orgs__item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-11);
    height: var(--space-11);
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
    overflow: hidden;
    transition:
      border-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .drawer-orgs__item:hover {
    border-color: var(--color-brand-primary-subtle, var(--color-border-hover));
    transform: scale(var(--card-image-hover-scale, 1.08));
  }

  .drawer-orgs__logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: var(--space-1);
  }

  .drawer-orgs__initial {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  /* ── Content gallery ── */
  .drawer-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .drawer-content__heading {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    /* Secondary, not muted: these are 13-15px labels, so 4.5:1 applies, and
       muted measures 3.62:1 here (2.42:1 on a plain-brand light org). The size,
       weight, tracking and uppercase treatment already make them read quiet. */
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .drawer-content__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }

  .drawer-content__item {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    text-decoration: none;
    color: inherit;
  }

  .drawer-content__thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-lg);
    background: var(--color-surface-secondary);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .drawer-content__item:hover .drawer-content__thumb {
    transform: scale(1.02);
  }

  .drawer-content__thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drawer-content__thumb-type {
    font-size: var(--text-xs);
    /* Secondary, not muted: these are 13-15px labels, so 4.5:1 applies, and
       muted measures 3.62:1 here (2.42:1 on a plain-brand light org). The size,
       weight, tracking and uppercase treatment already make them read quiet. */
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }

  .drawer-content__title {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-snug);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── View Full Profile ── */
  .drawer-profile-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition:
      background-color var(--duration-fast) var(--ease-default);
  }

  .drawer-profile-link:hover {
    background: var(--color-interactive-hover);
  }
</style>
