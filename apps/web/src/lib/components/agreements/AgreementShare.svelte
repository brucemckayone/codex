<!--
  @component AgreementShare

  A creator's agreement share as inline text: "40%", or, for a missing share,
  the "—" the owner chose (Codex-fazy6). The dash is hidden from assistive
  technology and "No share recorded" is read in its place, because a bare em
  dash says nothing (NVDA at default punctuation) or only "em dash"
  (VoiceOver). See `agreement-share.ts`.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import {
    formatAgreementShare,
    isShareMissing,
    MISSING_SHARE,
  } from './agreement-share';

  interface Props {
    /** Basis points; `null` or `undefined` when the share is missing. */
    bps: number | null | undefined;
  }

  const { bps }: Props = $props();
</script>

{#if isShareMissing(bps)}<span aria-hidden="true">{MISSING_SHARE}</span><span
    class="sr-only">{m.agreement_share_missing()}</span
  >{:else}{formatAgreementShare(bps)}{/if}
