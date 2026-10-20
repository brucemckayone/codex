/**
 * Test double for `$lib/remote/settings.remote`, plus reactive page `data`,
 * for mounting the real Settings page (Codex-2hxff.2).
 *
 * The form double gets its surface from `createFakeRemoteForm()` — the repo's
 * one transcription of kit's client form runtime. Its field proxy has no
 * `allIssues()`, which this page calls on every render, so the proxy is wrapped
 * with one that reports none. `fields` / `pending` / `result` / `enhance` are
 * installed non-enumerably, as on a real instance, so `<form {...enhanced}>`
 * spreads only `method`, `action` and the attachment (see the categories
 * fixture for what happens otherwise).
 *
 * `pageData` is `$state` so a test can change the viewer's role under a mounted
 * page — what the studio layout's reload does after an accept.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import { vi } from 'vitest';
import type { PendingOwnershipOffer } from '$lib/types';
import { createFakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

export interface SettingsPageData {
  org: { id: string; name: string };
  orgId: string;
  userRole: string | undefined;
  pendingOwnershipOffer: PendingOwnershipOffer | null;
}

export const pageData = $state<{ value: SettingsPageData }>({
  value: {
    org: { id: '', name: '' },
    orgId: '',
    userRole: undefined,
    pendingOwnershipOffer: null,
  },
});

export function setPageData(value: SettingsPageData) {
  pageData.value = value;
}

// ── query() ─────────────────────────────────────────────────────────────
export const getContactSettings = vi.fn((_orgId: string) => ({
  current: {
    platformName: 'Studio Alpha',
    supportEmail: 'help@studio-alpha.test',
    contactUrl: '',
    timezone: 'UTC',
    twitterUrl: '',
    youtubeUrl: '',
    instagramUrl: '',
    tiktokUrl: '',
  },
  error: undefined,
  refresh: async () => {},
}));

// ── form() ──────────────────────────────────────────────────────────────
const kit = createFakeRemoteForm();

const fields = new Proxy(kit.fields, {
  get(target, prop, receiver) {
    if (prop === 'allIssues') return () => undefined;
    return Reflect.get(target, prop, receiver);
  },
});

const form: Record<string | symbol, unknown> = { ...kit };
Object.defineProperties(form, {
  fields: { get: () => fields },
  validate: { value: kit.validate },
  enhance: { value: kit.enhance },
  pending: { get: () => kit.pending },
  result: { get: () => kit.result },
});

export const updateContactForm = form;

export function reset() {
  kit.__reset();
  getContactSettings.mockClear();
}
