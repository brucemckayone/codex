import { getServiceUrl } from '@codex/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
  try {
    const notificationsUrl = getServiceUrl('notifications', platform?.env);
    const response = await fetch(
      `${notificationsUrl}/unsubscribe/${params.token}`
    );
    const data = await response.json();
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
