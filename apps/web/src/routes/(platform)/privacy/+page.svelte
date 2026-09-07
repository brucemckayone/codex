<script lang="ts">
  /**
   * Privacy Policy - PLACEHOLDER (Codex-6wkr1).
   *
   * Deliberately makes no claims about data handling. Stating the wrong thing
   * about personal data is a materially worse failure than stating nothing:
   * the real policy has to enumerate actual processors (Stripe, Neon,
   * Cloudflare KV/R2, Resend, RunPod) from the code, not from memory.
   */
  import LegalPlaceholder from '$lib/components/ui/Legal/LegalPlaceholder.svelte';
  import * as m from '$paraglide/messages';
</script>

<svelte:head>
  <title>{m.legal_privacy_title()} - Codex</title>
  <meta name="description" content={m.legal_privacy_lead()} />
  <meta property="og:title" content="{m.legal_privacy_title()} - Codex" />
  <meta property="og:description" content={m.legal_privacy_lead()} />
  <meta property="og:type" content="website" />
  <!-- Not indexable while it carries no policy. Remove with the placeholder. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<LegalPlaceholder title={m.legal_privacy_title()} lead={m.legal_privacy_lead()} />
