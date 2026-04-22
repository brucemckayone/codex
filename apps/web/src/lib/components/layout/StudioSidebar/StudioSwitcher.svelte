<script lang="ts">
  import { page } from '$app/state';
  import { buildOrgUrl, buildCreatorsUrl } from '$lib/utils/subdomain';
  import {
    UserIcon,
    ChevronDownIcon,
    CheckIcon,
    GlobeIcon,
    PlusIcon,
  } from '$lib/components/ui/Icon';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
  import CreateOrganizationDialog from '$lib/components/studio/CreateOrganizationDialog.svelte';
  import * as m from '$paraglide/messages';

  interface OrgWithRole {
    name: string;
    slug: string;
    logoUrl?: string;
    role?: string;
  }

  interface Props {
    /** Studio context — determines label fallback and public site target. */
    currentContext: 'personal' | 'org';
    currentSlug?: string;
    creatorUsername?: string | null;
    orgs: OrgWithRole[];
    /**
     * Visual expansion state, mirrored from parent sidebar. When false the
     * trigger renders as an icon-only rail button; when true it expands to
     * icon + name + chevron matching the other rail rows.
     */
    expanded?: boolean;
    /** Dropdown placement — `'right'` for sidebar rail, `'bottom'` for mobile bar. */
    placement?: 'right' | 'bottom';
  }

  const {
    currentContext,
    currentSlug,
    creatorUsername,
    orgs,
    expanded = false,
    placement = 'right',
  }: Props = $props();

  let createDialogOpen = $state(false);

  const currentOrg = $derived(orgs.find((o) => o.slug === currentSlug));
  const label = $derived(
    currentContext === 'personal'
      ? m.studio_switcher_personal()
      : (currentOrg?.name ?? m.studio_switcher_organization()),
  );

  const publicSiteHref = $derived(
    currentContext === 'personal' && creatorUsername
      ? buildCreatorsUrl(page.url, `/${creatorUsername}`)
      : currentSlug
        ? buildOrgUrl(page.url, currentSlug, '/')
        : '/',
  );

  const triggerInitial = $derived((currentOrg?.name ?? label)[0] ?? '?');

  const dropdownPositioning = $derived(
    placement === 'right'
      ? { placement: 'right-start' as const, gutter: 12 }
      : { placement: 'bottom-end' as const, gutter: 8 },
  );
</script>

<DropdownMenu positioning={dropdownPositioning}>
  <DropdownMenuTrigger class="studio-switcher-trigger" data-expanded={expanded}>
    {#if currentOrg?.logoUrl}
      <img src={currentOrg.logoUrl} alt="" class="studio-switcher-trigger__logo" />
    {:else}
      <span class="studio-switcher-trigger__initial">{triggerInitial}</span>
    {/if}
    <span class="studio-switcher-trigger__label">
      <span class="studio-switcher-trigger__kicker">{m.studio_switcher_switch_studio()}</span>
      <span class="studio-switcher-trigger__name">{label}</span>
    </span>
    <ChevronDownIcon size={14} class="studio-switcher-trigger__chevron" />
  </DropdownMenuTrigger>
  <DropdownMenuContent class="studio-switcher-menu">
    <a href={buildOrgUrl(page.url, 'creators', '/studio')} class="studio-switcher-menu__link">
      <DropdownMenuItem>
        <span class="studio-switcher-menu__item">
          <UserIcon size={16} />
          {m.studio_switcher_personal_studio()}
        </span>
        {#if currentContext === 'personal'}
          <CheckIcon size={16} class="studio-switcher-menu__check" />
        {/if}
      </DropdownMenuItem>
    </a>

    {#if orgs.length > 0}
      <DropdownMenuSeparator />
      {#each orgs as orgItem (orgItem.slug)}
        <a
          href={buildOrgUrl(page.url, orgItem.slug, '/studio')}
          class="studio-switcher-menu__link"
        >
          <DropdownMenuItem>
            <span class="studio-switcher-menu__item">
              {#if orgItem.logoUrl}
                <img src={orgItem.logoUrl} alt="" class="studio-switcher-menu__icon" />
              {:else}
                <span class="studio-switcher-menu__icon-fallback">{orgItem.name[0]}</span>
              {/if}
              <span class="studio-switcher-menu__text">
                <span class="studio-switcher-menu__name">{orgItem.name}</span>
                {#if orgItem.role}
                  <span class="studio-switcher-menu__role">{orgItem.role}</span>
                {/if}
              </span>
            </span>
            {#if currentSlug === orgItem.slug}
              <CheckIcon size={16} class="studio-switcher-menu__check" />
            {/if}
          </DropdownMenuItem>
        </a>
      {/each}
    {/if}

    <DropdownMenuSeparator />
    <button
      type="button"
      class="studio-switcher-menu__add"
      onclick={() => (createDialogOpen = true)}
    >
      <DropdownMenuItem>
        <span class="studio-switcher-menu__item studio-switcher-menu__item--accent">
          <PlusIcon size={16} />
          {m.studio_switcher_add_organisation()}
        </span>
      </DropdownMenuItem>
    </button>

    <DropdownMenuSeparator />
    <a href={publicSiteHref} class="studio-switcher-menu__link">
      <DropdownMenuItem>
        <span class="studio-switcher-menu__item">
          <GlobeIcon size={16} />
          {m.studio_view_public_site()}
        </span>
      </DropdownMenuItem>
    </a>
  </DropdownMenuContent>
</DropdownMenu>

<CreateOrganizationDialog bind:open={createDialogOpen} />

<style>
  /* ── Trigger — mirrors SidebarRail rail-item geometry ─────────────── */
  :global(.studio-switcher-trigger) {
    display: flex !important;
    align-items: center !important;
    gap: var(--space-3) !important;
    padding: var(--space-2) var(--space-3) !important;
    margin: 0 var(--space-2) !important;
    min-height: var(--space-10) !important;
    border-radius: var(--radius-md) !important;
    color: var(--color-text-secondary) !important;
    background: transparent !important;
    border: var(--border-width) var(--border-style) transparent !important;
    cursor: pointer !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-align: left !important;
    transition: var(--transition-colors) !important;
  }

  :global(.studio-switcher-trigger:hover) {
    background-color: color-mix(in oklch, var(--color-interactive) 12%, transparent) !important;
    color: var(--color-text) !important;
  }

  :global(.studio-switcher-trigger:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus) !important;
    outline-offset: 2px !important;
  }

  :global(.studio-switcher-trigger[data-state='open']) {
    background-color: color-mix(in oklch, var(--color-interactive) 15%, transparent) !important;
    color: var(--color-text) !important;
  }

  .studio-switcher-trigger__logo,
  .studio-switcher-trigger__initial {
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    object-fit: contain;
  }

  .studio-switcher-trigger__initial {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }

  .studio-switcher-trigger__label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    overflow: hidden;
    opacity: 0;
    transform: translateX(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-out);
  }

  :global(.studio-switcher-trigger[data-expanded='true']) .studio-switcher-trigger__label {
    opacity: 1;
    transform: translateX(0);
  }

  .studio-switcher-trigger__kicker {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    line-height: var(--leading-none);
  }

  .studio-switcher-trigger__name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: var(--leading-tight);
  }

  :global(.studio-switcher-trigger__chevron) {
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-default);
  }

  :global(.studio-switcher-trigger[data-expanded='true']) :global(.studio-switcher-trigger__chevron) {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-switcher-trigger__label,
    :global(.studio-switcher-trigger__chevron) {
      transition: none;
    }
  }

  /* ── Dropdown menu ─────────────────────────────────────────────────── */
  :global(.studio-switcher-menu) {
    min-width: 260px !important;
    padding: var(--space-1) !important;
  }

  .studio-switcher-menu__link {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .studio-switcher-menu__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
  }

  .studio-switcher-menu__item--accent {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  .studio-switcher-menu__icon {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    object-fit: contain;
    flex-shrink: 0;
  }

  .studio-switcher-menu__icon-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    flex-shrink: 0;
  }

  .studio-switcher-menu__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .studio-switcher-menu__name {
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .studio-switcher-menu__role {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: capitalize;
  }

  .studio-switcher-menu__add {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
</style>
