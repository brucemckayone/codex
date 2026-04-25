import { getServiceUrl } from '@codex/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
  try {
    const notificationsUrl = getServiceUrl('notifications', platform?.env);
    const response = await fetch(
      `${notificationsUrl}/unsubscribe/${params.token}`
    );
    // Notifications worker returns a plain JSON envelope here (not the
    // procedure() shape) — type the parsed shape explicitly so the
    // strict-mode `unknown` from response.json() narrows.
    const data = (await response.json()) as {
      valid?: boolean;
      category?: string | null;
      reason?: string | null;
    };
    return {
      token: params.token,
      valid: data.valid ?? false,
      category: data.category ?? null,
      reason: data.reason ?? null,
    };
  } catch {
    return {
      token: params.token,
      valid: false,
      category: null,
      reason: 'Unable to verify this link. Please try again later.',
    };
  }
};
