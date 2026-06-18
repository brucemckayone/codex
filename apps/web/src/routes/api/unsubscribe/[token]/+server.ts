import { buildServiceUrl as getServiceUrl } from '@codex/urls';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, platform }) => {
  const notificationsUrl = getServiceUrl('notifications', platform?.env);
  const response = await fetch(
    `${notificationsUrl}/unsubscribe/${params.token}`,
    { method: 'POST' }
  );
  const data = await response.json();
  return json(data);
};
