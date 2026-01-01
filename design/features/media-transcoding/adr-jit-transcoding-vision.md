# ADR: Just-In-Time Transcoding Vision

**Status**: Accepted
**Date**: 2026-01-01
**Deciders**: Platform Architecture Team
**Tags**: transcoding, cost-optimization, architecture

---

## Context

Traditional video platforms transcode all quality variants eagerly on upload. This approach:

- Wastes GPU time on content that's never watched
- Stores variants that are never requested (e.g., 360p on desktop-heavy platform)
- Front-loads costs regardless of content popularity
- Scales costs linearly with uploads, not views

Industry leaders like **Mux** use just-in-time (JIT) transcoding to solve this. Content is transcoded only when requested, and only the specific segments/variants needed. This aligns costs with actual usage.

**Goal**: Evolve Codex transcoding from eager to JIT, minimizing waste while maintaining playback quality.

---

## Decision

We will architect our transcoding pipeline to evolve toward **Mux-style JIT transcoding** over four phases. Phase 1 (current implementation) uses eager transcoding but establishes foundations that enable future JIT migration without rewrites.

**Key Principle**: Every architectural decision in Phase 1 must not block the JIT end-state.

---

## Architecture Evolution

### Current State (Eager)

```
Upload → Mezzanine → ALL Variants → Store ALL in R2
         (B2)        (GPU time)     (permanent)

Cost model: O(uploads)
Storage: O(uploads × variants)
Waste: 70-90% (estimated, most content rarely watched)
```

### Target State (JIT)

```
Upload → Mezzanine → DONE
         (B2)

Request for segment → Check cache → Miss → JIT transcode → Cache → Serve
                                            (just that segment)

Cost model: O(views)
Storage: O(popular_content × requested_variants)
Waste: Near-zero
```

---

## Phase Breakdown

### Phase 1: Eager with Foundations (Current)

**What we build**:
- Full eager transcoding pipeline (all variants on upload)
- Mezzanine preservation in B2 (critical for JIT)
- `readyVariants` tracking in database
- `transcodingPriority` field (immediate/standard/on_demand)
- Two-pass loudness analysis (stored for future use)

**Why eager for now**:
- Simpler to implement and debug
- Zero first-play latency (good UX baseline)
- Proves the pipeline works end-to-end
- Low initial content volume, cost impact minimal

**JIT-enabling decisions**:
| Decision | Why It Matters for JIT |
|----------|----------------------|
| Mezzanine in B2 | Source for on-demand transcoding |
| `readyVariants` array | Know what exists, what to generate |
| Segment naming convention | Predictable keys for cache lookup |
| Separate assets bucket | Thumbnails/waveforms independent of HLS |

**Estimated timeline**: 5-7 days
**Cost per upload**: ~$0.03 (all variants)

---

### Phase 2: On-Demand Variants

**Trigger**: Content volume makes eager cost prohibitive, OR significant % unwatched

**What changes**:
- New upload mode: mezzanine-only (`transcodingPriority = 'on_demand'`)
- Access service checks `readyVariants` before serving
- Missing variant triggers single-variant transcoding job
- Client handles "transcoding in progress" response
- Cloudflare Queues for job deduplication

**Architecture**:
```
Upload → Mezzanine (B2) → DONE (~$0.005)

First play request:
  → Access service checks readyVariants
  → 720p missing? Queue transcoding job
  → Return { status: 'transcoding', eta: 120 }
  → Client shows loading, polls for ready
  → Webhook updates readyVariants
  → Subsequent requests served from R2
```

**Database additions**:
```typescript
pendingVariants: jsonb           // Currently being transcoded
variantRequestedAt: jsonb        // When each variant first requested
lastPlayedAt: timestamp          // For cache eviction decisions
```

**Trade-offs**:
- First viewer waits 1-3 minutes (acceptable for long-tail content)
- More complex client handling
- Need job deduplication (multiple viewers request same variant)

**Estimated savings**: 50-70% vs eager (depends on watch rate)

---

### Phase 3: JIT Segment Generation

**Trigger**: Want sub-minute first-play latency with on-demand benefits

**What changes**:
- Transcode individual HLS segments on request, not full variant
- Segment-level caching with TTL in R2
- Hot mezzanine tier (R2 cache of popular mezzanines from B2)
- Background "warming" of likely-needed segments

**Architecture**:
```
Request: GET /stream/{mediaId}/720p/segment_005.ts

Edge Worker:
  1. Check R2 cache for segment → HIT: serve
  2. MISS: Check if mezzanine hot (R2) or cold (B2)
  3. Trigger segment-only transcode (6 seconds of video)
  4. Stream response while caching
  5. Set TTL based on popularity

Segment transcode time: 2-5 seconds (GPU)
Total latency: 3-8 seconds for cold segment
```

**Infrastructure requirements**:
- Persistent GPU workers (cold start too slow for JIT)
- Mezzanine caching tier (B2 latency ~200ms, need <50ms)
- Segment-level cache invalidation
- Predictive warming (transcode segment N+1 while serving N)

**Database additions**:
```typescript
segmentAccessLog: table          // Track hot segments
mezzanineCachedAt: timestamp     // When copied to hot tier
mezzanineCacheTTL: interval      // Based on popularity
```

**Trade-offs**:
- Higher infrastructure complexity
- Need always-on GPU capacity (or very fast cold start)
- Segment cache management overhead

**Estimated savings**: 80-90% vs eager

---

### Phase 4: Real-Time Packaging (Mux End-State)

**Trigger**: Volume justifies infrastructure investment, need instant playback

**What changes**:
- Store mezzanine as **fragmented MP4 (fMP4)** instead of regular MP4
- No transcoding at request time - just **repackaging**
- CMAF (Common Media Application Format) allows byte-range serving
- Edge workers do packaging, no GPU needed for playback

**Architecture**:
```
Upload → Fragmented Mezzanine (B2) → DONE

Request: GET /stream/{mediaId}/720p/segment_005.ts

Edge Worker (CPU only, no GPU):
  1. Calculate byte range for segment in fMP4
  2. Fetch byte range from mezzanine
  3. Repackage as HLS/CMAF segment on-the-fly
  4. Stream to client (no storage needed)

Latency: <100ms (no transcoding, just repackaging)
Storage: Mezzanine only
GPU cost: Zero at playback time
```

**Prerequisites**:
- Mezzanine must be multi-bitrate fMP4 (or single high-quality that can be transmuxed)
- For true adaptive bitrate: need quality ladder in mezzanine OR accept single quality
- Alternative: Store 2-3 quality mezzanines, package on demand

**Key insight**: Mux pre-encodes to a "delivery-ready" mezzanine format. The "just-in-time" part is packaging, not transcoding. True JIT transcoding at scale is expensive; JIT packaging is cheap.

**Realistic Codex approach**:
```
Upload → Mezzanine (high-quality, CRF 18) in B2
      → Optional: 720p "fast-start" mezzanine for instant play

Play request:
  1. Serve from 720p fast-start immediately
  2. Background: generate requested quality
  3. Switch to full quality when ready
```

---

## Phase 1 Constraints (Do Not Block JIT)

These decisions are locked to ensure JIT migration path:

| Constraint | Rationale |
|------------|-----------|
| Always create mezzanine | Source for all future transcoding |
| Store mezzanine in B2 | Cheap archival, Bandwidth Alliance egress |
| Use `readyVariants` array | Know what exists vs needs generation |
| Deterministic segment naming | `segment_%03d.ts` enables cache key prediction |
| Separate HLS prefix per variant | Can generate/delete variants independently |
| Store loudness measurements | Don't re-analyze for future transcodes |
| `transcodingPriority` field | Switch modes without schema change |

**Anti-patterns to avoid**:
- Deleting mezzanine after transcoding (need it for re-encoding)
- Hardcoding "all variants" assumption
- Coupling thumbnail/waveform generation to HLS generation
- Assuming R2 keys exist (must check `readyVariants`)

---

## Cost Projections

Assumptions:
- 1000 uploads/month
- 20% of content watched at least once
- Average 10 views per watched content
- GPU cost: $0.03 per full transcode, $0.01 per single variant

| Phase | Monthly GPU Cost | Monthly Storage | Total |
|-------|-----------------|-----------------|-------|
| 1: Eager | $30 (1000 × $0.03) | 1000 × 4 variants | $30 + storage |
| 2: On-Demand | $6 (200 × $0.03) | 200 × avg 2 variants | $6 + storage |
| 3: JIT Segments | ~$4 (segments only) | Popular segments only | $4 + minimal |
| 4: Real-Time | ~$0 (CPU packaging) | Mezzanines only | Lowest |

**Break-even point for Phase 2**: ~500 uploads/month with <30% watch rate

---

## Open Questions

### For Phase 2

1. **First-play latency tolerance**: Is 1-3 min acceptable for free content? Paid content?
2. **Fallback behavior**: Show lower quality immediately, or wait for requested quality?
3. **Preview strategy**: Always generate preview eagerly (good for discovery)?

### For Phase 3-4

1. **GPU infrastructure**: RunPod cold start too slow. Dedicated instance? Reserved capacity?
2. **Mezzanine format**: Regular MP4 vs fMP4 vs ProRes? Trade-offs for each.
3. **Edge compute**: Cloudflare Workers for packaging? Latency to B2?
4. **Cloudflare Stream**: Evaluate vs DIY. They do JIT internally. Cost comparison?

### Business Questions

1. **Content monetization model**: Does paid content justify eager transcoding?
2. **Creator expectations**: Will they accept "processing" delay on first view?
3. **Analytics needs**: Do we need to track variant popularity for optimization?

---

## Related Documents

- [P1-TRANSCODE-001 Implementation Plan](../../roadmap/implementation-plans/P1-TRANSCODE-001-implementation-plan.md)
- [P1-TRANSCODE-001 Work Packet](../../roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md)
- [RunPod Worker Plan](../../roadmap/implementation-plans/P1-TRANSCODE-001-runpod-worker-implementation-plan.md)

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-01 | Target JIT as end-state | Cost optimization at scale |
| 2026-01-01 | Phase 1 uses eager transcoding | Simpler MVP, proves pipeline |
| 2026-01-01 | Mezzanine preservation mandatory | Enables all future phases |
| 2026-01-01 | B2 for archival storage | Cost + Bandwidth Alliance |

---

**Next Review**: After Phase 1 completion, evaluate content volume and watch rates to determine Phase 2 timeline.
