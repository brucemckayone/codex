<script lang="ts">
  /**
   * Terms of Service - PLACEHOLDER (Codex-6wkr1).
   *
   * Deliberately carries no terms. See `LegalPlaceholder.svelte` for why
   * invented legal copy would be worse than an explicit "not yet published".
   */
  import LegalPlaceholder from '$lib/components/ui/Legal/LegalPlaceholder.svelte';
  import * as m from '$paraglide/messages';
</script>

<svelte:head>
  <title>{m.legal_terms_title()} - Codex</title>
  <meta name="description" content={m.legal_terms_lead()} />
  <meta property="og:title" content="{m.legal_terms_title()} - Codex" />
  <meta property="og:description" content={m.legal_terms_lead()} />
  <meta property="og:type" content="website" />
  <!-- Not indexable while it carries no terms: a placeholder ranking for
       "Codex terms of service" is worse than no result. Remove with the
       placeholder. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<LegalPlaceholder title={m.legal_terms_title()} lead={m.legal_terms_lead()} />
