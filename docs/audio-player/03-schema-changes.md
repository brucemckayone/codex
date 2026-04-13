# Schema, Validation & API Changes

## Database Migration

### New Columns on `content` Table

**File**: `packages/database/src/schema/content.ts`

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `shader_preset` | `varchar(50)` | Yes | `null` | ShaderPresetId for immersive audio mode |
| `shader_config` | `jsonb` | Yes | `null` | Per-preset parameter overrides |

```typescript
// In content table definition
shaderPreset: varchar('shader_preset', { length: 50 }),
shaderConfig: jsonb('shader_config').$type<Record<string, number | boolean>>(),
```

### Migration

Generated via `pnpm db:generate` after schema change. Simple `ALTER TABLE ADD COLUMN` — no data backfill needed, both columns default to `null`.

### No DB CHECK Constraint

The shader preset list (40+ presets) evolves as new shaders are added. A DB-level `CHECK(shader_preset IN (...))` constraint would require a migration for every new preset. Validation is enforced at the Zod layer only.

---

## Validation Schema

**File**: `packages/validation/src/content/content-schemas.ts`

### Shader Preset Enum

```typescript
// Either import from ShaderHero or duplicate for decoupling:
export const shaderPresetEnum = z.enum([
  'suture', 'ether', 'warp', 'ripple', 'pulse', 'ink', 'topo', 'nebula',
  'turing', 'silk', 'glass', 'film', 'flux', 'lava', 'caustic', 'physarum',
  'rain', 'frost', 'glow', 'life', 'mycelium', 'aurora', 'tendrils',
  'pollen', 'growth', 'geode', 'lenia', 'ocean', 'bismuth', 'pearl',
  'vortex', 'gyroid', 'waves', 'clouds', 'fracture', 'julia', 'vapor',
  'tunnel', 'plasma', 'flow', 'spore', 'none',
]);
```

### Added to `baseContentSchema`

```typescript
shaderPreset: shaderPresetEnum.optional().nullable(),
shaderConfig: z.record(z.string(), z.union([z.number(), z.boolean()])).optional().nullable(),
```

### Type Inference

`CreateContentInput` and `UpdateContentInput` are inferred from Zod schemas — they automatically include the new fields. No manual type updates needed.

### Cross-Field Validation

None required. `shaderPreset` is harmless on non-audio content — the studio form simply hides the picker for video/written types. This avoids coupling validation to content type transitions (e.g., changing content type after setting a shader).

---

## API Changes

### ContentAccessService — `getStreamingUrl()`

**File**: `packages/access/src/services/ContentAccessService.ts`

**Current return type**:
```typescript
{ streamingUrl: string; expiresAt: Date; contentType: 'video' | 'audio' }
```

**New return type**:
```typescript
{ streamingUrl: string; waveformUrl: string | null; expiresAt: Date; contentType: 'video' | 'audio' }
```

**Change details**:

1. In the transaction (line ~197), also return `waveformKey` from the content record's media item:
   ```typescript
   return {
     r2Key,
     mediaType: mediaType as 'video' | 'audio',
     waveformKey: contentRecord.mediaItem.waveformKey,  // NEW
   };
   ```

2. After the transaction, sign the waveform URL for audio content:
   ```typescript
   const waveformUrl = (mediaType === 'audio' && waveformKey)
     ? await this.r2.generateSignedUrl(waveformKey, input.expirySeconds)
     : null;

   return { streamingUrl, waveformUrl, expiresAt, contentType: mediaType };
   ```

### Content-API Worker Route

The worker route that calls `getStreamingUrl()` and returns the response — ensure the new `waveformUrl` field passes through the response envelope. Since `procedure()` wraps the return value in `{ data: T }`, this should work automatically.

### Frontend: `content-detail.ts`

**File**: `apps/web/src/lib/server/content-detail.ts`

Update `AccessAndProgress` interface:
```typescript
interface AccessAndProgress {
  hasAccess: boolean;
  streamingUrl: string | null;
  waveformUrl: string | null;  // NEW
  progress: { positionSeconds: number; durationSeconds: number; completed: boolean } | null;
}
```

In `loadAccessAndProgress()`, extract `waveformUrl` from `streamResult`:
```typescript
const waveformUrl = streamResult?.waveformUrl ?? null;
return { hasAccess, streamingUrl, waveformUrl, progress };
```

### Frontend: Server Load → Page

The `waveformUrl` flows through:
1. `+page.server.ts` — already streams `accessAndProgress` promise
2. `+page.svelte` — destructures from resolved `accessAndProgress`
3. `ContentDetailView.svelte` — receives as prop, passes to `AudioPlayer`

---

## Content Create/Update (shader fields)

### Service Layer

**File**: `packages/content/src/services/content-service.ts`

No changes needed. The `create()` and `update()` methods insert/update all fields from the validated input. Since `shaderPreset` and `shaderConfig` are now in the schema and validation, they flow through automatically.

### API Routes

**File**: `workers/content-api/src/routes/content.ts`

No changes needed. The `procedure()` validates input via the Zod schema and passes it to the service.

### Studio Form

**File**: `apps/web/src/lib/components/studio/ContentForm.svelte`

Add `shaderPreset` and `shaderConfig` to the form state. Conditionally render the `ShaderPicker` sub-component when `contentType === 'audio'`.

### Remote Functions

**Files**: `apps/web/src/lib/remote/content.remote.ts`

The `createContentForm` and `updateContentForm` remote functions use the Zod schemas for validation. Since the schemas now include shader fields, the remote functions handle them automatically.

---

## Migration Checklist

1. [ ] Add columns to `packages/database/src/schema/content.ts`
2. [ ] Run `pnpm db:generate` to create migration SQL
3. [ ] Run `pnpm db:migrate` to apply
4. [ ] Add `shaderPresetEnum` to `packages/validation/src/content/content-schemas.ts`
5. [ ] Add `shaderPreset` + `shaderConfig` to `baseContentSchema`
6. [ ] Update `ContentAccessService.getStreamingUrl()` return type + waveform signing
7. [ ] Update `AccessAndProgress` interface in `content-detail.ts`
8. [ ] Verify `pnpm typecheck` passes
9. [ ] Verify `pnpm test` passes
