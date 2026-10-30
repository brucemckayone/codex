/**
 * A test-only Worker: svg-sanitize.workerd.test.ts runs the SVG sanitiser
 * inside workerd through it (Codex-kcr87). POST the SVG text; the answer is
 * the sanitised SVG, or the name and message of what it threw.
 */
import { sanitizeSvgContent } from '../../svg-sanitize';

export default {
  async fetch(request: Request): Promise<Response> {
    const svg = await request.text();
    try {
      return Response.json({ svg: await sanitizeSvgContent(svg) });
    } catch (error) {
      // Read structurally: in zod 4 a ZodError is not `instanceof Error`.
      const { name, message } = error as { name?: unknown; message?: unknown };
      return Response.json({
        errorName: typeof name === 'string' ? name : undefined,
        error: typeof message === 'string' ? message : String(error),
      });
    }
  },
};
