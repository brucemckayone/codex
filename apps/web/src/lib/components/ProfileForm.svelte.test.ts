/**
 * ProfileForm offers "Remove" only for an uploaded avatar (Codex-kk9nv.10).
 *
 * `profile.image` is the upload if there is one, else the sign-in provider's
 * picture. Offering Remove for a provider picture deleted nothing: the server
 * had no upload to drop, the form blanked the picture, and the refresh brought
 * it straight back.
 *
 * The three remote forms are fakes (`.remote.ts` modules load their server
 * source in a unit test); `$app/navigation` and the photo shrinker are mocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/utils/shrink-photo', () => ({ shrinkPhotoInput: vi.fn() }));
vi.mock('$lib/remote/account.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { updateProfileForm: createFakeRemoteForm() };
});
vi.mock('$lib/remote/avatar-upload.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { avatarUploadForm: createFakeRemoteForm() };
});
vi.mock('$lib/remote/avatar-delete.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { avatarDeleteForm: createFakeRemoteForm() };
});

const ProfileForm = (await import('./ProfileForm.svelte')).default;

const UPLOAD = 'https://cdn.codex.test/avatars/u1/300x300-ab12cd34/lg.webp';
const PROVIDER = 'https://lh3.googleusercontent.com/a/photo';

// biome-ignore lint/suspicious/noExplicitAny: mount()'s component handle
let component: any;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function removeButton(profile: Record<string, unknown>): Element | undefined {
  component = mount(ProfileForm, {
    target: document.body,
    props: {
      profile: { name: 'Ada Lovelace', email: 'a@test.com', ...profile },
    },
  });
  flushSync();
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === m.account_avatar_remove()
  );
}

describe('ProfileForm — the Remove avatar button', () => {
  it('is offered for an uploaded avatar', () => {
    expect(
      removeButton({ image: UPLOAD, hasCustomAvatar: true })
    ).toBeDefined();
  });

  it("is not offered for the sign-in provider's picture", () => {
    expect(
      removeButton({ image: PROVIDER, hasCustomAvatar: false })
    ).toBeUndefined();
  });

  it('is not offered with no picture at all', () => {
    expect(
      removeButton({ image: null, hasCustomAvatar: false })
    ).toBeUndefined();
  });
});
