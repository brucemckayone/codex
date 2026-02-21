import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import * as m from '$paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  cookies,
  platform,
  url,
}) => {
  const { contentId } = params;
  const api = createServerApi(platform, cookies);

  try {
    const contentResult = await api.content.get(contentId);

    if (!contentResult.data) {
      return {
        content: null,
        error: m.commerce_content_unavailable(),
      };
    }

    const content = contentResult.data;

    // Check if user already owns this content
    let isPurchased = false;
    try {
      const libraryResult = await api.access.getUserLibrary();
      isPurchased = libraryResult.items.some(
        (item) => item.content.id === contentId
      );
    } catch {
      isPurchased = false;
    }

    const origin = url.origin;
    const successUrl = `${origin}/purchase/success?contentId=${contentId}`;
    const cancelUrl = `${origin}/org/${params.slug}/content/${contentId}`;

    return {
      content,
      isPurchased,
      checkoutUrls: {
        successUrl,
        cancelUrl,
      },
    };
  } catch (_error) {
    logger.error('Error loading content', { error: _error });
    return {
      content: null,
      error: m.commerce_retry_later(),
    };
  }
};
