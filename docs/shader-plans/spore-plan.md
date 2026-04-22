# Spore Shader Preset Plan

**Source**: Physarum transport network simulation (Jones 2010 paper)
**Type**: FBO-based (ping-pong 512x512 sim + display pass)
**Preset ID**: `spore`

## Algorithm

Explicit agent-based Physarum polycephalum simulation:

### Sim Pass
1. **Trail diffusion**: 3x3 box blur of trail density (R channel)
2. **Trail decay**: Multiply by decay factor (0.998 default)
3. **Agent sensing**: For agent texels (~30%), sample trail at 3 sensor positions:
   - Left: heading + sensorAngle, at sensorOffset distance
   - Center: heading, at sensorOffset distance
   - Right: heading - sensorAngle, at sensorOffset distance
4. **Agent turning**: Turn toward strongest trail signal (Jones algorithm)
5. **Motor stage**: Advance heading, deposit trail at position
6. **Mouse**: Hover deposits extra trail (attractant); click burst seeds new agents

### Buffer Format (RGBA16F)
- R: trail density (pheromone field)
- G: secondary trail (for color variation)
- B: agent heading (0-1 → 0-2π)
- A: agent presence (>0.5 = active agent)

### Display Pass
- Trail density → brand color gradient with edge glow
- Agent positions highlighted with accent color
- Distance-based visualization for depth
- Standard post-processing chain

## Config Interface

```typescript
export interface SporeConfig extends ShaderConfigBase {
  preset: 'spore';
  sensorAngle: number;  // 5.0-45.0, default 12.5 — degrees between sensors
  sensorOffset: number; // 1.0-8.0, default 3.0 — sensor reach distance
  stepSize: number;     // 2.0-12.0, default 6.0 — agent speed
  rotation: number;     // 5.0-45.0, default 22.5 — turn amount in degrees
  decay: number;        // 0.990-0.999, default 0.998 — trail evaporation rate
}
```

## CSS Keys
- `shader-spore-sensor-angle`
- `shader-spore-sensor-offset`
- `shader-spore-step-size`
- `shader-spore-rotation`
- `shader-spore-decay`

## Slider Definitions

| id | label | min | max | step | default | minLabel | maxLabel |
|----|-------|-----|-----|------|---------|----------|----------|
| shader-spore-sensor-angle | Sensor Angle | 5.0 | 45.0 | 0.5 | 12.5 | Narrow | Wide |
| shader-spore-sensor-offset | Sensor Reach | 1.0 | 8.0 | 0.5 | 3.0 | Close | Far |
| shader-spore-step-size | Step Size | 2.0 | 12.0 | 0.5 | 6.0 | Slow | Fast |
| shader-spore-rotation | Turn Amount | 5.0 | 45.0 | 0.5 | 22.5 | Gentle | Sharp |
| shader-spore-decay | Trail Decay | 0.990 | 0.999 | 0.001 | 0.998 | Fast | Slow |

## Brand Color Mapping
- **Primary**: Dense trail network (high pheromone regions)
- **Secondary**: Trail edges / gradient falloff
- **Accent**: Active agent positions (bright dots)
- **Background**: Empty space / low trail density
