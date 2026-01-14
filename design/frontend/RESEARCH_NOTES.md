# Frontend Research Notes

Experimental ideas, research findings, and future considerations that don't belong in the main spec.

---

## Remote Functions (Experimental)

SvelteKit Remote Functions are still experimental. Track for Phase 2+.

**Potential benefits:**
- Type-safe RPC without manual endpoint definitions
- Automatic batching (`query.batch`)
- Granular data refetching

**Current blockers:**
- Experimental API may change
- Cloudflare adapter compatibility unclear
- Cookie forwarding semantics need verification

**Decision**: Use standard `load` + form actions for Phase 1.

---

## Alternative State Management

### Considered Options

| Option | Verdict | Reason |
|--------|---------|--------|
| Svelte stores | Rejected | Runes are simpler, better TS inference |
| TanStack Query | Rejected | Overkill when workers handle caching |
| Nanostores | Rejected | Extra dep, runes are equivalent |
| Runes (`$state`) | Chosen | Native, universal reactivity |

---

## Custom Domain Strategy

For orgs wanting `learn.yogastudio.com` instead of `yoga.codex.com`:

### Option A: Token-based redirect (recommended)
1. User visits custom domain (no session)
2. Redirect to auth subdomain with return URL
3. Auth creates one-time token
4. Return to custom domain with token
5. Exchange token for local session cookie

### Option B: Reverse proxy
- Custom domain proxies to `{slug}.codex.com`
- Cookie stays on `.codex.com`
- Requires per-domain proxy config

**Decision**: Defer to Phase 4. Document both options.

---

## Performance Experiments

### Partial Hydration
- SvelteKit doesn't support out of box
- Could explore custom solution with snippets
- Low priority - measure first

### Service Worker Caching
- Pre-cache shell for offline
- Cache API responses for instant navigation
- Consider workbox integration

---

## UI Library Evaluation

| Library | Pros | Cons | Verdict |
|---------|------|------|---------|
| Shadcn-Svelte | Copypaste, customizable | Manual updates | **Chosen** |
| Skeleton UI | Tailwind-first | Larger bundle | Alternative |
| Melt UI | Headless primitives | More work | For custom needs |
| DaisyUI | Quick theming | Less control | Not for prod |

---

## Ideas Parking Lot

- [ ] Keyboard shortcuts system (vim-style navigation)
- [ ] Optimistic UI patterns for mutations
- [ ] Real-time collab features (Yjs?)
- [ ] Mobile app via Capacitor
- [ ] PWA installation prompts
- [ ] A/B testing infrastructure
- [ ] Feature flags service

---

## Links & Resources

- [SvelteKit Docs](https://svelte.dev/docs/kit)
- [Svelte 5 Runes](https://svelte.dev/docs/svelte/what-are-runes)
- [Cloudflare Pages Adapter](https://kit.svelte.dev/docs/adapter-cloudflare)
- [Shadcn-Svelte](https://www.shadcn-svelte.com/)
- [BetterAuth](https://www.better-auth.com/)
