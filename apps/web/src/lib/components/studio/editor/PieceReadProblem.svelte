<!--
  @component PieceReadProblem

  Why the studio cannot show a piece it read, for the editor (Codex-a6ofh.2.3)
  or its preview (Codex-a6ofh.2.11): the session ended (a sign-in that comes
  back here), the piece was refused (deleted, or not theirs: final), or the
  read could not be made (an outage: Try again). One alert, said at once.

  @prop {ReadProblem} problem - Which it was (`readProblem`)
  @prop {string} signInHref - A sign-in that comes back here
  @prop {() => void} ontryagain - An outage's Try again
  @prop {Attachment<HTMLElement>} [refocus] - On Try again as it mounts: a retry that failed again hands focus back to it
-->
<script module lang="ts">
  import { isReadOutage, remoteErrorStatus } from '$lib/remote/query-result';

  export type ReadProblem = 'signed-out' | 'gone' | 'outage';

  /**
   * Which problem a failed read is: 401 is a session that ended (the
   * studio's guard runs on loads, not on this read); another 4xx a refusal,
   * final (deleted, not theirs, a bad link); anything else an outage, the
   * only one Try again can help.
   */
  export function readProblem(error: unknown): ReadProblem | null {
    if (error == null) return null;
    if (remoteErrorStatus(error) === 401) return 'signed-out';
    return isReadOutage(error) ? 'outage' : 'gone';
  }
</script>

<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import { Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    problem: ReadProblem;
    signInHref: string;
    ontryagain: () => void;
    refocus?: Attachment<HTMLElement>;
  }

  const { problem, signInHref, ontryagain, refocus }: Props = $props();
</script>

{#if problem === 'signed-out'}
  <div class="read-problem" role="alert">
    <p>{m.studio_editor_signed_out()}</p>
    <a class="sign-in" href={signInHref}>{m.common_sign_in()}</a>
  </div>
{:else if problem === 'gone'}
  <p class="read-problem" role="alert">{m.studio_editor_not_found()}</p>
{:else}
  <div class="read-problem" role="alert">
    <p>{m.studio_editor_read_failed()}</p>
    <Button type="button" size="sm" variant="secondary" onclick={ontryagain} {@attach refocus}>
      {m.common_try_again()}
    </Button>
  </div>
{/if}

<style>
  .read-problem {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-8);
    font-size: var(--text-sm);
    text-align: center;
    color: var(--color-status-error-text);
  }

  .read-problem p {
    margin: 0;
  }

  .sign-in {
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  .sign-in:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
