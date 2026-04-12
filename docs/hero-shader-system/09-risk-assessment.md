# 09 — Risk Assessment & Mitigation

**Purpose**: Identify every risk, rate it, and document the mitigation strategy.

---

## Risk Matrix

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | **WebGL crashes on obscure GPU** | Low | Medium | `failIfMajorPerformanceCaveat: true`, try/catch on context creation, automatic CSS fallback |
| 2 | **Battery drain on mobile** | Medium | High | DPR cap at 1, IntersectionObserver pause, 15s idle → 15fps, reduced-motion respect |
| 3 | **Shader looks bad with certain brand colors** | Medium | Medium | Test all 12 brand presets × 8 shader presets. Ship with tested defaults. Add "recommended" badges. |
| 4 | **GLSL compilation failure on some drivers** | Low | Medium | Try/catch on compile, fall to CSS. Log shader info log for debugging. |
| 5 | **Bundle size increase** | Low | Low | GLSL is plain text (~2-5KB per shader). Total ~30KB uncompressed, ~8KB gzipped. Lazy-load only active preset. |
| 6 | **SSR hydration mismatch** | None | Critical | Canvas wrapped in `{#if mounted}` (onMount only). SSR renders zero canvas elements. |
| 7 | **Scroll performance (main thread)** | Low | Medium | Passive scroll listener, read `getBoundingClientRect` only in rAF, IntersectionObserver for coarse visibility |
| 8 | **Memory leak from GL resources** | Medium | Medium | Explicit `destroy()` with shader/buffer/program deletion. `WEBGL_lose_context` extension. Cleanup in `onMount` return. |
| 9 | **Brand editor complexity** | Medium | Low | Hero Effects is one Level 1 screen with 6 controls. No sublevel. Simpler than Colors or Typography levels. |
| 10 | **Accessibility regression** | Low | High | Canvas is `aria-hidden`, `prefers-reduced-motion` shows static frame, all text in content overlay (not canvas) |
| 11 | **Dark mode interaction** | Medium | Medium | Shader reads brand colors which are already dark-mode-adjusted via `org-brand.css`. No shader-specific dark mode logic needed. |
| 12 | **iOS Safari context loss** | Medium | Medium | Handle `webglcontextlost`/`webglcontextrestored` events. Auto-rebuild shader program on restore. |
| 13 | **Stacking context conflict with SidebarRail** | Low | Medium | Canvas is `position: absolute` inside hero (not `position: fixed`). Doesn't affect sidebar's `z-index: var(--z-fixed)`. |
| 14 | **Brand preset doesn't clear shader** | None | Low | By design: brand presets (colors) and shader presets (animation) are independent axes. Documented in 06-brand-editor-integration.md. |
| 15 | **tokenOverrides pollution** | Low | Low | Shader keys are namespaced (`shader-*`). `parseShaderConfig()` only reads `shader-*` keys. Other tokenOverride consumers (fine-tune colors, etc.) ignore unknown keys. |
| 16 | **iOS Safari Metal backend hitches** | Medium | Medium | Safari WebGL runs on Metal, not OpenGL. Uniform buffer emulation can cause 150ms hitches. `gl.getParameter()`/`gl.getError()` are expensive. Mitigation: cache uniform locations, never call getParameter/getError in render loop, avoid canvas resize during animation. |
| 17 | **Firefox CSS @property gap** | Known | Medium | Firefox (as of April 2026) doesn't support CSS `@property`. Our @property gradient fallback won't animate on Firefox. Mitigation: Added `mix-blend-mode` animated blobs as Tier 2 fallback (95% support including Firefox). |
| 18 | **GPU thermal throttling on sustained animation** | High | Medium | Mobile GPUs throttle within 30-90 seconds of sustained 60fps. Mitigation: target 30fps on mobile by default, idle pause after 15s, IntersectionObserver pause when off-screen. |

---

## Detailed Risk Analysis

### Risk 1: GPU Crashes

**Scenario**: User has an ancient GPU driver that claims WebGL support but crashes on shader compilation.

**Mitigation stack** (defense in depth):
1. `failIfMajorPerformanceCaveat: true` → rejects software rendering upfront
2. `WEBGL_debug_renderer_info` → detects SwiftShader/llvmpipe
3. `try/catch` around `compileShader()` → catches compilation failures
4. `try/catch` around `linkProgram()` → catches linking failures
5. `try/catch` around `drawArrays()` → catches runtime GPU errors
6. Each failure level falls back to CSS animation

**Recovery**: If WebGL fails, the page shows the CSS `@property` animated gradient. If that fails, the static gradient (current behavior). Zero regression path.

### Risk 2: Battery Drain

**Scenario**: User on mobile phone, hero section visible for extended time. GPU runs continuously.

**Mitigation stack**:
1. **DPR cap**: 1 on mobile → 9× fewer fragments than DPR 3
2. **Complexity reduction**: Mobile gets `complexity × 0.5` → fewer noise octaves
3. **IntersectionObserver**: Render loop stops when hero is off-screen
4. **Tab visibility**: `document.visibilityState === 'hidden'` → render loop pauses
5. **Idle timeout**: After 15s of no interaction → drop to 15fps (75% GPU reduction)
6. **`powerPreference: 'low-power'`**: Hints to use integrated GPU on dual-GPU devices
7. **Adaptive quality**: Frame time monitoring auto-reduces quality if GPU is struggling

**Worst case**: If ALL mitigations are insufficient, the adaptive quality system drops to CSS fallback automatically.

### Risk 3: Bad Color Combinations

**Scenario**: Org uses a brand palette where all 3 colors are very similar (e.g., 3 shades of blue). Shader looks muddy.

**Mitigation**:
1. **Default fallback colors**: When secondary or accent is null, derive from primary (darker shade, complementary hue)
2. **Testing matrix**: Test all 12 brand presets × 8 shader presets (96 combos) before shipping
3. **Intensity control**: User can reduce `u_intensity` to make effect more subtle
4. **"None" option**: Users can always disable the shader entirely
5. **Future**: Add a "recommended presets" system that suggests which shaders work best with the chosen palette

### Risk 10: Accessibility

**Scenario**: User with vestibular disorder triggers nausea from animation.

**Mitigation**:
1. `prefers-reduced-motion: reduce` → single static frame, no animation
2. All meaningful content (logo, text, buttons) is in the HTML overlay, not the canvas
3. Canvas has `aria-hidden="true"` → completely invisible to screen readers
4. No flashing/strobing effects in any preset (all animations < 0.5Hz)
5. Focus management unaffected (canvas is not focusable)

### Risk 12: iOS Context Loss

**Scenario**: User on iPhone, multiple tabs open. iOS reclaims WebGL contexts under memory pressure.

**Mitigation**:
```typescript
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();  // REQUIRED — allows context restoration
  cancelAnimationFrame(rafId);
  // All GL resources are now invalid — don't try to use them
  program = null;
  buffer = null;
});

canvas.addEventListener('webglcontextrestored', () => {
  // Full reinitialization
  program = compileProgram(gl, vertexSource, fragmentSource);
  buffer = createQuadBuffer(gl);
  resolveUniforms(gl, program);
  startRenderLoop();
});
```

**Key**: `e.preventDefault()` on `webglcontextlost` is REQUIRED. Without it, the context is permanently lost and `webglcontextrestored` never fires.

---

## Regression Risk Assessment

| Existing Feature | Could Shader System Break It? | Safeguard |
|-----------------|------------------------------|-----------|
| Hero content (logo, title, CTAs) | No | Content is in HTML overlay above canvas (z-index: 1) |
| Hero SEO (og:title, meta) | No | Meta tags are in `<svelte:head>`, unrelated to canvas |
| Hero responsive design | No | Canvas uses `position: absolute; inset: 0` — matches hero size automatically |
| Org branding tokens | No | Shader reads tokens as uniforms but doesn't write to them |
| Brand editor live preview | No | Shader config uses the same `tokenOverrides` pipeline as fine-tune |
| SidebarRail | No | Canvas is inside hero (not fixed), doesn't affect sidebar z-index |
| MobileBottomNav | No | Canvas is contained within hero section |
| CommandPaletteSearch | No | Search opens in modal above everything |
| Content section below hero | No | Canvas doesn't extend beyond hero section |
| Continue Watching section | No | Separate section, no overlap |
| Skeleton loading states | No | Existing skeletons in streamed sections unaffected |
| Cache invalidation (versions) | No | Shader config persists via existing branding cache/invalidation |
| Progress sync | No | PlaybackSync is unrelated to hero rendering |

**Verdict**: The shader system is purely additive. Removing it (set `shader-preset: 'none'`) returns to exactly the current behavior. There is no shared mutable state between the shader and other systems.

---

## Rollback Plan

If the shader system causes issues in production:

1. **Per-org rollback**: Admin opens Brand Editor → Hero Effects → selects "None" → Save. Shader disabled for that org.
2. **Global disable**: Set `DEFAULT_SHADER_CONFIG.preset = 'none'` in `shader-config.ts`. All orgs without explicit config see static gradient.
3. **Feature flag**: Add `shader-enabled` to `feature_settings` table (requires schema change — only if needed).
4. **Code removal**: Delete `ShaderHero/` directory, revert `+page.svelte` to use `<section class="hero">`. Zero dependencies on other components.
