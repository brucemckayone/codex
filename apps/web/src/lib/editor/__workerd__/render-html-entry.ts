/**
 * A test-only Worker: render-html.workerd.test.ts runs render-html.ts inside
 * workerd through it (Codex-yzxu0). POST a stored body as JSON; the answer is
 * its HTML, or the message of what it threw.
 */
import { bodyToHtml } from '../render-html';

export default {
  async fetch(request: Request): Promise<Response> {
    const body = await request.json();
    try {
      return Response.json({ html: await bodyToHtml(body) });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
