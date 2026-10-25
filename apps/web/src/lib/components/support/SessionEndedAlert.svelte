<!--
  @component SessionEndedAlert

  "Your session has ended" for a support read the session can no longer make
  (Codex-2hxff.28 review, R2-M1; see `session.ts`). No Try again: only signing
  in again helps. Other attributes (a `tabindex`, a marker) pass to the Alert.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { Alert } from '$lib/components/ui';

  const props: HTMLAttributes<HTMLDivElement> = $props();
</script>

<Alert variant="warning" data-testid="session-ended" {...props}>
  <p>
    <strong>{m.support_outcome_signed_out_lead()}</strong>
    {m.support_session_ended_body()}
  </p>
</Alert>
