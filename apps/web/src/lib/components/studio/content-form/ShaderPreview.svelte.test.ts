/**
 * The studio's shader preview shows what immersive mode will actually play
 * for the piece (`immersivePreset`): its own shader, else the org's brand
 * shader — what the None card promises — else flow. A saved id that names no
 * preset says so in words, instead of a black box (Codex-1yd58.14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShaderConfig } from '$lib/components/ui/ShaderHero/shader-config';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/observability', () => ({ logger }));

/** Every renderer the preview loaded, by preset; `refuse` ones fail init. */
const made = vi.hoisted(() => ({
  renderers: [] as {
    id: string;
    render: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[],
  refuse: new Set<string>(),
}));
vi.mock('$lib/components/ui/ShaderHero/load-renderer', () => ({
  loadRenderer: vi.fn(async (id: string) => {
    const renderer = {
      id,
      init: () => !made.refuse.has(id),
      render: vi.fn(),
      resize: () => {},
      reset: () => {},
      destroy: vi.fn(),
    };
    made.renderers.push(renderer);
    return renderer;
  }),
}));

import { loadRenderer } from '$lib/components/ui/ShaderHero/load-renderer';
import ShaderPreview from './ShaderPreview.svelte';

const NOTE = "This piece's saved shader is no longer available";
/** The page's words, whitespace collapsed as a reader sees them. */
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
let app: ReturnType<typeof mount> | null = null;
let frames: FrameRequestCallback[] = [];

/** Run the frames queued so far. */
function step(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  }
}

/** Let the effects, the dynamic load and its fallback run. */
async function settle() {
  flushSync();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

/** Mount inside an org layout whose brand sets `brandPreset`, if any. */
async function preview(props: { preset: string | null }, brandPreset?: string) {
  const layout = document.createElement('div');
  layout.className = 'org-layout';
  if (brandPreset) {
    layout.style.setProperty('--brand-shader-preset', brandPreset);
  }
  document.body.appendChild(layout);
  app = mount(ShaderPreview, { target: layout, props });
  await settle();
}

const firstConfig = (id: string): ShaderConfig | undefined =>
  made.renderers.find((r) => r.id === id)?.render.mock.calls[0]?.[3];

beforeEach(() => {
  // A stand-in WebGL context: the preview only hands it to the renderer.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({
      viewport: () => {},
      getExtension: () => null,
      isContextLost: () => false,
    })) as unknown as HTMLCanvasElement['getContext']
  );
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  made.renderers = [];
  made.refuse.clear();
  vi.mocked(loadRenderer).mockClear();
  logger.warn.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ShaderPreview', () => {
  it("previews the piece's own shader, a cut one as its survivor", async () => {
    await preview({ preset: 'nebula' }, 'ink');
    expect(loadRenderer).toHaveBeenLastCalledWith('aurora');
    expect(document.body.textContent).not.toContain(NOTE);
  });

  it("previews the brand's shader for a piece with none, as the None card says", async () => {
    await preview({ preset: null }, 'ink');
    expect(loadRenderer).toHaveBeenLastCalledWith('ink');
    expect(document.querySelector('canvas')).not.toBeNull();
  });

  it('previews flow where the brand has no shader either', async () => {
    await preview({ preset: 'none' });
    expect(loadRenderer).toHaveBeenLastCalledWith('flow');
  });

  it("says in words that a saved id names no preset, and that it plays the brand's", async () => {
    await preview({ preset: 'retired-shader' }, 'ink');
    expect(text()).toContain(`${NOTE}, so it plays your brand's shader.`);
    expect(loadRenderer).toHaveBeenLastCalledWith('ink');
    expect(logger.warn).toHaveBeenCalledWith('shader.unknown_preset', {
      id: 'retired-shader',
      where: 'studio',
    });
  });

  it('names Flow in that note where the brand has no shader', async () => {
    await preview({ preset: 'retired-shader' });
    expect(text()).toContain(`${NOTE}, so it plays Flow.`);
  });

  // Review N1: the poller was built once, for the preset of the moment, so a
  // switched-to renderer drew its first ~29 frames with the PREVIOUS preset's
  // config — NaN for ripple and suture, a preview black for good.
  it('hands a renderer switched to its own config from its first frame', async () => {
    const props = $state<{ preset: string | null }>({ preset: 'ink' });
    await preview(props, 'lava');
    step(1);
    expect(firstConfig('ink')?.preset).toBe('ink');

    props.preset = 'ripple';
    await settle();
    step(1);
    expect(firstConfig('ripple')?.preset).toBe('ripple');
  });

  it('plays film when the chosen shader will not start', async () => {
    made.refuse.add('flow');
    await preview({ preset: 'flow' });
    step(1);
    expect(vi.mocked(loadRenderer).mock.calls.map(([id]) => id)).toEqual([
      'flow',
      'film',
    ]);
    // The refused renderer was freed, and film draws its own config.
    expect(made.renderers[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(firstConfig('film')?.preset).toBe('film');
    // And it says so, in the names the picker shows.
    expect(text()).toContain(
      "Flow can't run in this browser, so it plays Oil Film here."
    );
  });

  it('says nothing of a fallback when the chosen shader starts', async () => {
    await preview({ preset: 'flow' });
    expect(text()).not.toContain("can't run in this browser");
  });

  it('says so, over a canvas kept for the next pick, when nothing will start', async () => {
    made.refuse.add('flow');
    made.refuse.add('film');
    const props = $state<{ preset: string | null }>({ preset: 'flow' });
    await preview(props);
    expect(document.body.textContent).toContain(
      'this shader could not start in this browser'
    );
    expect(document.querySelector('canvas')).not.toBeNull();

    // The next pick starts on that same canvas, and the words go.
    props.preset = 'ink';
    await settle();
    expect(loadRenderer).toHaveBeenLastCalledWith('ink');
    expect(document.body.textContent).not.toContain('could not start');
  });
});
