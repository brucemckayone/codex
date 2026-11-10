<!--
  @component LeaveDialog

  The editor's own question before a move drops what is unsaved
  (Codex-a6ofh.2.5), in place of the browser's confirm(): a piece that has
  been live, with changes not yet updated, asks Update, Discard or Stay
  (mockup W5b: "the leave warning appears only if something hasn't been
  updated yet"). A save that failed, needs a title or has not finished asks
  Leave anyway or Stay. Closing it (Escape, a press outside, ✕) is Stay.

  The session asks (`askToLeave`); its host shows the question here and
  hands the answer back. Focus goes back where it was when it asked.

  @prop {LeaveReason | null} reason - The question; null when none is asked
  @prop {number} changes - How many changes are not live yet
  @prop {(answer: LeaveAnswer) => void} onanswer - The creator answered, or closed it (Stay)
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as m from '$paraglide/messages';
  import { LEAVE_WORDS, type LeaveAnswer, type LeaveReason } from './draft-session.svelte';

  interface Props {
    reason: LeaveReason | null;
    changes: number;
    onanswer: (answer: LeaveAnswer) => void;
  }

  const { reason, changes, onanswer }: Props = $props();

  /** Where focus was when it asked: it goes back there on Stay. */
  let returnTo: HTMLElement | null = null;
  $effect(() => {
    if (reason === null) return;
    untrack(() => {
      const active = document.activeElement;
      returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
    });
  });
</script>

<Dialog.Root
  open={reason !== null}
  onOpenChange={(open) => {
    if (!open) onanswer('stay');
  }}
  closeFocus={() => returnTo}
>
  <Dialog.Content size="sm">
    {#if reason === 'live'}
      <Dialog.Header>
        <Dialog.Title>{m.studio_live_leave_title()}</Dialog.Title>
        <Dialog.Description>
          {changes === 1 ? m.studio_live_leave_body_one() : m.studio_live_leave_body({ count: changes })}
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="ghost" onclick={() => onanswer('stay')}>{m.studio_live_leave_stay()}</Button>
        <Button variant="secondary" onclick={() => onanswer('leave')}>{m.studio_live_leave_discard()}</Button>
        <Button onclick={() => onanswer('update')}>{m.studio_live_update()}</Button>
      </Dialog.Footer>
    {:else if reason !== null}
      <Dialog.Header>
        <Dialog.Title>{m.studio_editor_leave_title()}</Dialog.Title>
        <!-- A draft's question, in the words its confirm() used. -->
        <Dialog.Description>{LEAVE_WORDS[reason]()}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => onanswer('stay')}>{m.studio_live_leave_stay()}</Button>
        <Button variant="destructive" onclick={() => onanswer('leave')}>{m.studio_editor_leave_anyway()}</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
