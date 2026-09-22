<script lang="ts">
  import { page } from '$app/state';
  import PageContainer from './PageContainer.svelte';
  import * as m from '$paraglide/messages';
  import { buildPlatformUrl } from '$lib/utils/subdomain';

  // These three routes live ONLY in the (platform) group, and this footer
  // renders on every page — including org subdomains. A relative `/terms` there
  // is rerouted by `hooks.ts` to `/_org/<slug>/terms`, which does not exist, so
  // all three 404'd on every tenant host (Codex-6wkr1). `buildPlatformUrl`
  // pins them to the apex, preserving protocol and port, so there is exactly
  // one canonical URL per legal document rather than one per tenant.
  const aboutUrl = $derived(buildPlatformUrl(page.url, '/about'));
  const termsUrl = $derived(buildPlatformUrl(page.url, '/terms'));
  const privacyUrl = $derived(buildPlatformUrl(page.url, '/privacy'));
</script>

<footer class="footer">
  <PageContainer class="footer-inner">
    <p class="copyright">
      {m.footer_copyright()}
    </p>

    <nav class="links" aria-label="Footer">
      <a href={aboutUrl} class="footer-link">{m.footer_about()}</a>
      <a href={termsUrl} class="footer-link">{m.footer_terms()}</a>
      <a href={privacyUrl} class="footer-link">{m.footer_privacy()}</a>
    </nav>
  </PageContainer>
</footer>

<style>
  .footer {
    padding: var(--space-12) 0;
    background-color: var(--color-surface-secondary);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    margin-top: auto;
  }

  :global(.footer-inner) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
  }

  @media (--breakpoint-sm) {
    :global(.footer-inner) {
      flex-direction: row;
      justify-content: space-between;
    }
  }

  .copyright {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .links {
    display: flex;
    gap: var(--space-6);
  }

  .footer-link {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .footer-link:hover {
    color: var(--color-interactive);
  }
</style>
