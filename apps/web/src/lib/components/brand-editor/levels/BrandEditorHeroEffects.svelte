<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { SHADER_DEFAULT_PULSE_COLOR } from '$lib/brand-editor/defaults';
  import BrandSliderField from '../BrandSliderField.svelte';

  // ── Preset definitions ─────────────────────────────────────────────────
  interface PresetOption {
    id: string;
    label: string;
    description: string;
  }

  const PRESETS: PresetOption[] = [
    { id: 'none', label: 'None', description: 'Default gradient' },
    { id: 'suture', label: 'Suture Fluid', description: 'Organic flowing fluid' },
    { id: 'ether', label: 'Ether', description: 'Ethereal glowing forms' },
    { id: 'warp', label: 'Domain Warp', description: 'Marble textures' },
    { id: 'ripple', label: 'Water Ripple', description: 'Rippling water surface' },
    { id: 'pulse', label: 'Pulse', description: '3D liquid wave surface' },
    { id: 'ink', label: 'Ink Dispersion', description: 'Colored ink in liquid' },
    { id: 'topo', label: 'Topo', description: 'Topographic contour lines' },
    { id: 'nebula', label: 'Nebula', description: 'Cosmic dust clouds' },
    { id: 'turing', label: 'Turing Patterns', description: 'Reaction-diffusion organisms' },
    { id: 'silk', label: 'Silk Fabric', description: 'Flowing luxury fabric' },
    { id: 'glass', label: 'Stained Glass', description: 'Voronoi stained glass cells' },
    { id: 'film', label: 'Oil Film', description: 'Iridescent thin-film shimmer' },
    { id: 'flux', label: 'Flux', description: 'Magnetic field lines' },
    { id: 'lava', label: 'Lava', description: 'Molten crust with glowing cracks' },
    { id: 'caustic', label: 'Caustics', description: 'Underwater light patterns' },
    { id: 'physarum', label: 'Physarum', description: 'Slime mould network' },
    { id: 'rain', label: 'Rain', description: 'Raindrops on glass' },
    { id: 'frost', label: 'Frost', description: 'Ice crystal growth' },
    { id: 'glow', label: 'Glow', description: 'Bioluminescent deep sea' },
    { id: 'life', label: 'SmoothLife', description: 'Continuous cellular automata' },
    { id: 'mycelium', label: 'Mycelium', description: 'Fungal network growth' },
    { id: 'aurora', label: 'Aurora', description: 'Northern lights curtains' },
    { id: 'tendrils', label: 'Tendrils', description: 'Flowing curl noise' },
    { id: 'growth', label: 'Growth', description: 'Organic edge expansion' },
    { id: 'lenia', label: 'Lenia', description: 'Artificial lifeforms' },
    { id: 'ocean', label: 'Ocean', description: 'Caustics over sand' },
    { id: 'bismuth', label: 'Bismuth', description: 'Crystal terraces' },
    { id: 'pearl', label: 'Pearl', description: 'Iridescent raymarched sphere' },
    { id: 'vortex', label: 'Vortex', description: 'Polar volumetric spirals' },
    { id: 'gyroid', label: 'Gyroid', description: 'Organic gyroid structure' },
    { id: 'waves', label: 'Waves', description: 'Gerstner ocean surface' },
    { id: 'clouds', label: 'Clouds', description: 'Procedural sky clouds' },
    { id: 'fracture', label: 'Fracture', description: 'Geometric polygon cuts' },
    { id: 'julia', label: 'Julia', description: 'Animated fractal set' },
    { id: 'vapor', label: 'Vapor', description: 'Volumetric aurora clouds' },
    { id: 'tunnel', label: 'Tunnel', description: 'Apollonian fractal tunnel' },
    { id: 'plasma', label: 'Plasma', description: 'Iridescent fluid streams' },
    { id: 'flow', label: 'Flow', description: 'Curl-noise paint streaks' },
    { id: 'spore', label: 'Spore', description: 'Agent-based slime network' },
  ];

  // ── Default values ─────────────────────────────────────────────────────
  const DEFAULTS: Record<string, string> = {
    'shader-intensity': '0.65',
    'shader-grain': '0.025',
    'shader-vignette': '0.20',
    // Suture
    'shader-curl': '30',
    'shader-dissipation': '0.985',
    'shader-advection': '6.0',
    'shader-force': '1.00',
    // Ether
    'shader-rotation-speed': '0.40',
    'shader-complexity': '6',
    'shader-zoom': '5.0',
    'shader-glow': '0.50',
    'shader-scale': '2.00',
    'shader-aberration': '0.003',
    // Warp
    'shader-warp-strength': '1.50',
    'shader-light-angle': '135',
    'shader-speed': '0.30',
    'shader-detail': '4',
    'shader-contrast': '1.10',
    'shader-invert': '1',
    // Ripple
    'shader-wave-speed': '0.80',
    'shader-damping': '0.995',
    'shader-ripple-size': '0.030',
    'shader-refraction': '0.50',
    // Pulse
    'shader-pulse-damping': '0.97',
    'shader-wave-scale': '4.0',
    'shader-cam-height': '30',
    'shader-cam-target': '-30',
    'shader-specular': '0.60',
    'shader-impulse-size': '0.040',
    'shader-pulse-color': SHADER_DEFAULT_PULSE_COLOR,
    // Ink
    'shader-ink-diffusion': '1.50',
    'shader-ink-advection': '0.80',
    'shader-ink-drop-size': '0.050',
    'shader-ink-evaporation': '0.997',
    'shader-ink-curl': '15',
    // Topo
    'shader-topo-line-count': '12',
    'shader-topo-line-width': '1.2',
    'shader-topo-speed': '0.15',
    'shader-topo-scale': '2.5',
    'shader-topo-elevation': '1.0',
    'shader-topo-octaves': '3',
    // Nebula
    'shader-nebula-density': '0.80',
    'shader-nebula-speed': '0.12',
    'shader-nebula-scale': '2.0',
    'shader-nebula-depth': '8',
    'shader-nebula-wind': '0.50',
    'shader-nebula-stars': '0.30',
    // Turing
    'shader-turing-feed': '0.055',
    'shader-turing-kill': '0.062',
    'shader-turing-da': '1.00',
    'shader-turing-db': '0.50',
    'shader-turing-speed': '4',
    // Silk
    'shader-silk-fold-scale': '2.5',
    'shader-silk-fold-depth': '1.5',
    'shader-silk-speed': '0.10',
    'shader-silk-softness': '0.70',
    'shader-silk-sheen': '0.15',
    'shader-silk-lining': '0.10',
    // Glass
    'shader-glass-cell-size': '5.0',
    'shader-glass-border': '0.04',
    'shader-glass-drift': '0.10',
    'shader-glass-glow': '0.20',
    'shader-glass-light': '0.15',
    // Film
    'shader-film-scale': '2.5',
    'shader-film-speed': '0.10',
    'shader-film-bands': '4.0',
    'shader-film-shift': '0.30',
    'shader-film-ripple': '1.50',
    // Flux
    'shader-flux-poles': '3',
    'shader-flux-line-density': '10.0',
    'shader-flux-line-width': '1.00',
    'shader-flux-strength': '1.50',
    'shader-flux-speed': '0.10',
    // Lava
    'shader-lava-crack-scale': '4.0',
    'shader-lava-crack-width': '0.04',
    'shader-lava-glow': '1.50',
    'shader-lava-speed': '0.08',
    'shader-lava-crust': '0.60',
    'shader-lava-heat': '1.00',
    // Caustic
    'shader-caustic-scale': '2.5',
    'shader-caustic-speed': '0.10',
    'shader-caustic-iterations': '3',
    'shader-caustic-brightness': '1.20',
    'shader-caustic-ripple': '1.50',
    // Physarum
    'shader-physarum-diffusion': '1.00',
    'shader-physarum-decay': '0.980',
    'shader-physarum-deposit': '1.00',
    'shader-physarum-sensor': '0.030',
    'shader-physarum-turn': '0.25',
    // Rain
    'shader-rain-density': '0.60',
    'shader-rain-speed': '1.00',
    'shader-rain-size': '1.00',
    'shader-rain-refraction': '0.30',
    'shader-rain-blur': '1.00',
    // Frost
    'shader-frost-growth': '0.60',
    'shader-frost-branch': '0.30',
    'shader-frost-symmetry': '6',
    'shader-frost-melt': '1.00',
    'shader-frost-glow': '0.80',
    // Glow
    'shader-glow-count': '10',
    'shader-glow-pulse': '0.70',
    'shader-glow-size': '1.00',
    'shader-glow-drift': '0.10',
    'shader-glow-trail': '0.40',
    'shader-glow-depth': '3',
    // SmoothLife
    'shader-life-inner': '5.0',
    'shader-life-outer': '12.0',
    'shader-life-birth': '0.28',
    'shader-life-death': '0.45',
    'shader-life-speed': '2',
    // Mycelium
    'shader-mycelium-growth': '0.50',
    'shader-mycelium-branch': '0.25',
    'shader-mycelium-spread': '1.00',
    'shader-mycelium-pulse': '0.70',
    'shader-mycelium-thickness': '1.00',
    // Aurora
    'shader-aurora-layers': '5',
    'shader-aurora-speed': '0.10',
    'shader-aurora-height': '0.40',
    'shader-aurora-spread': '0.25',
    'shader-aurora-shimmer': '0.80',
    // Tendrils
    'shader-tendrils-scale': '2.5',
    'shader-tendrils-speed': '0.12',
    'shader-tendrils-steps': '5',
    'shader-tendrils-curl': '1.0',
    'shader-tendrils-fade': '0.6',
    // Pollen
    'shader-pollen-density': '0.60',
    'shader-pollen-size': '1.00',
    'shader-pollen-fibres': '5',
    'shader-pollen-drift': '0.10',
    'shader-pollen-depth': '3',
    'shader-pollen-bokeh': '0.50',
    // Growth
    'shader-growth-speed': '0.20',
    'shader-growth-noise': '0.80',
    'shader-growth-scale': '2.00',
    'shader-growth-width': '1.00',
    'shader-growth-glow': '0.80',
    // Geode
    'shader-geode-bands': '8',
    'shader-geode-warp': '0.80',
    'shader-geode-cavity': '0.20',
    'shader-geode-speed': '0.06',
    'shader-geode-sparkle': '0.80',
    // Lenia
    'shader-lenia-radius': '13.0',
    'shader-lenia-growth': '0.14',
    'shader-lenia-width': '0.015',
    'shader-lenia-speed': '2',
    'shader-lenia-dt': '0.2',
    // Ocean
    'shader-ocean-caustic-scale': '2.0',
    'shader-ocean-sand-scale': '3.0',
    'shader-ocean-speed': '0.10',
    'shader-ocean-shadow': '0.25',
    'shader-ocean-ripple': '1.00',
    // Bismuth
    'shader-bismuth-terraces': '8',
    'shader-bismuth-warp': '0.80',
    'shader-bismuth-iridescence': '0.80',
    'shader-bismuth-speed': '0.06',
    'shader-bismuth-edge': '0.80',
    // Pearl
    'shader-pearl-displacement': '0.15',
    'shader-pearl-speed': '0.70',
    'shader-pearl-fresnel': '3.00',
    'shader-pearl-specular': '1.25',
    // Vortex
    'shader-vortex-speed': '0.20',
    'shader-vortex-density': '40',
    'shader-vortex-twist': '1.00',
    'shader-vortex-rings': '1.00',
    'shader-vortex-spiral': '0.60',
    // Gyroid
    'shader-gyroid-scale1': '5.23',
    'shader-gyroid-scale2': '10.76',
    'shader-gyroid-speed': '0.20',
    'shader-gyroid-density': '3.50',
    'shader-gyroid-thickness': '0.030',
    // Waves
    'shader-waves-height': '1.0',
    'shader-waves-speed': '1.0',
    'shader-waves-chop': '0.70',
    'shader-waves-foam': '0.30',
    'shader-waves-depth': '0.60',
    // Clouds
    'shader-clouds-cover': '0.20',
    'shader-clouds-speed': '0.03',
    'shader-clouds-scale': '1.10',
    'shader-clouds-dark': '0.50',
    'shader-clouds-light': '0.30',
    // Fracture
    'shader-fracture-cuts': '8',
    'shader-fracture-speed': '0.17',
    'shader-fracture-border': '0.010',
    'shader-fracture-shadow': '0.05',
    'shader-fracture-fill': '0.85',
    // Julia
    'shader-julia-zoom': '1.3',
    'shader-julia-speed': '0.33',
    'shader-julia-iterations': '75',
    'shader-julia-radius': '0.79',
    'shader-julia-saturation': '0.50',
    // Vapor
    'shader-vapor-density': '1.00',
    'shader-vapor-speed': '1.50',
    'shader-vapor-scale': '5.0',
    'shader-vapor-warmth': '0.50',
    'shader-vapor-glow': '0.80',
    // Tunnel
    'shader-tunnel-speed': '2.0',
    'shader-tunnel-fractal': '6',
    'shader-tunnel-radius': '2.0',
    'shader-tunnel-brightness': '1.00',
    'shader-tunnel-twist': '0.07',
    // Plasma
    'shader-plasma-speed': '0.80',
    'shader-plasma-bands': '25.0',
    'shader-plasma-pressure': '0.90',
    'shader-plasma-turn': '0.11',
    'shader-plasma-diffusion': '1.20',
    // Flow
    'shader-flow-curl': '0.60',
    'shader-flow-advection': '6.0',
    'shader-flow-smoothing': '0.80',
    'shader-flow-contrast': '12.0',
    'shader-flow-field-speed': '1.00',
    // Spore
    'shader-spore-sensor-angle': '12.5',
    'shader-spore-sensor-offset': '3.0',
    'shader-spore-step-size': '6.0',
    'shader-spore-rotation': '22.5',
    'shader-spore-decay': '0.998',
  };

  /** All shader-* token override keys. */
  const ALL_SHADER_KEYS = Object.keys(DEFAULTS).concat('shader-preset');

  // ── Read current overrides ─────────────────────────────────────────────
  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const activePreset = $derived(overrides['shader-preset'] ?? 'none');

  /** Read a numeric override, falling back to its default. Handles 0 correctly. */
  function readNum(key: string): number {
    const raw = overrides[key];
    if (raw == null) return Number(DEFAULTS[key]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
  }

  // Shared
  const intensity = $derived(readNum('shader-intensity'));
  const grain = $derived(readNum('shader-grain'));
  const vignette = $derived(readNum('shader-vignette'));

  // Suture
  const curl = $derived(readNum('shader-curl'));
  const dissipation = $derived(readNum('shader-dissipation'));
  const advection = $derived(readNum('shader-advection'));
  const force = $derived(readNum('shader-force'));

  // Ether
  const rotationSpeed = $derived(readNum('shader-rotation-speed'));
  const complexity = $derived(readNum('shader-complexity'));
  const zoom = $derived(readNum('shader-zoom'));
  const glow = $derived(readNum('shader-glow'));
  const scale = $derived(readNum('shader-scale'));
  const aberration = $derived(readNum('shader-aberration'));

  // Warp
  const warpStrength = $derived(readNum('shader-warp-strength'));
  const lightAngle = $derived(readNum('shader-light-angle'));
  const speed = $derived(readNum('shader-speed'));
  const detail = $derived(readNum('shader-detail'));
  const contrast = $derived(readNum('shader-contrast'));
  const invert = $derived(overrides['shader-invert'] !== '0' && overrides['shader-invert'] !== 'false');

  // Ripple
  const waveSpeed = $derived(readNum('shader-wave-speed'));
  const damping = $derived(readNum('shader-damping'));
  const rippleSize = $derived(readNum('shader-ripple-size'));
  const refraction = $derived(readNum('shader-refraction'));

  // Pulse
  const pulseDamping = $derived(readNum('shader-pulse-damping'));
  const waveScale = $derived(readNum('shader-wave-scale'));
  const camHeight = $derived(readNum('shader-cam-height'));
  const camTarget = $derived(readNum('shader-cam-target'));
  const specular = $derived(readNum('shader-specular'));
  const impulseSize = $derived(readNum('shader-impulse-size'));
  const pulseColor = $derived(overrides['shader-pulse-color'] ?? DEFAULTS['shader-pulse-color']);

  // Ink
  const inkDiffusion = $derived(readNum('shader-ink-diffusion'));
  const inkAdvection = $derived(readNum('shader-ink-advection'));
  const inkDropSize = $derived(readNum('shader-ink-drop-size'));
  const inkEvaporation = $derived(readNum('shader-ink-evaporation'));
  const inkCurl = $derived(readNum('shader-ink-curl'));

  // Topo
  const topoLineCount = $derived(readNum('shader-topo-line-count'));
  const topoLineWidth = $derived(readNum('shader-topo-line-width'));
  const topoSpeed = $derived(readNum('shader-topo-speed'));
  const topoScale = $derived(readNum('shader-topo-scale'));
  const topoElevation = $derived(readNum('shader-topo-elevation'));
  const topoOctaves = $derived(readNum('shader-topo-octaves'));

  // Nebula
  const nebulaDensity = $derived(readNum('shader-nebula-density'));
  const nebulaSpeed = $derived(readNum('shader-nebula-speed'));
  const nebulaScale = $derived(readNum('shader-nebula-scale'));
  const nebulaDepth = $derived(readNum('shader-nebula-depth'));
  const nebulaWind = $derived(readNum('shader-nebula-wind'));
  const nebulaStars = $derived(readNum('shader-nebula-stars'));

  // Turing
  const turingFeed = $derived(readNum('shader-turing-feed'));
  const turingKill = $derived(readNum('shader-turing-kill'));
  const turingDa = $derived(readNum('shader-turing-da'));
  const turingDb = $derived(readNum('shader-turing-db'));
  const turingSpeed = $derived(readNum('shader-turing-speed'));

  // Silk
  const silkFoldScale = $derived(readNum('shader-silk-fold-scale'));
  const silkFoldDepth = $derived(readNum('shader-silk-fold-depth'));
  const silkSpeed = $derived(readNum('shader-silk-speed'));
  const silkSoftness = $derived(readNum('shader-silk-softness'));
  const silkSheen = $derived(readNum('shader-silk-sheen'));
  const silkLining = $derived(readNum('shader-silk-lining'));

  // Glass
  const glassCellSize = $derived(readNum('shader-glass-cell-size'));
  const glassBorder = $derived(readNum('shader-glass-border'));
  const glassDrift = $derived(readNum('shader-glass-drift'));
  const glassGlow = $derived(readNum('shader-glass-glow'));
  const glassLight = $derived(readNum('shader-glass-light'));

  // Film
  const filmScale = $derived(readNum('shader-film-scale'));
  const filmSpeed = $derived(readNum('shader-film-speed'));
  const filmBands = $derived(readNum('shader-film-bands'));
  const filmShift = $derived(readNum('shader-film-shift'));
  const filmRipple = $derived(readNum('shader-film-ripple'));

  // Flux
  const fluxPoles = $derived(readNum('shader-flux-poles'));
  const fluxLineDensity = $derived(readNum('shader-flux-line-density'));
  const fluxLineWidth = $derived(readNum('shader-flux-line-width'));
  const fluxStrength = $derived(readNum('shader-flux-strength'));
  const fluxSpeed = $derived(readNum('shader-flux-speed'));

  // Lava
  const lavaCrackScale = $derived(readNum('shader-lava-crack-scale'));
  const lavaCrackWidth = $derived(readNum('shader-lava-crack-width'));
  const lavaGlow = $derived(readNum('shader-lava-glow'));
  const lavaSpeed = $derived(readNum('shader-lava-speed'));
  const lavaCrust = $derived(readNum('shader-lava-crust'));
  const lavaHeat = $derived(readNum('shader-lava-heat'));

  // Caustic
  const causticScale = $derived(readNum('shader-caustic-scale'));
  const causticSpeed = $derived(readNum('shader-caustic-speed'));
  const causticIterations = $derived(readNum('shader-caustic-iterations'));
  const causticBrightness = $derived(readNum('shader-caustic-brightness'));
  const causticRipple = $derived(readNum('shader-caustic-ripple'));

  // Physarum
  const physarumDiffusion = $derived(readNum('shader-physarum-diffusion'));
  const physarumDecay = $derived(readNum('shader-physarum-decay'));
  const physarumDeposit = $derived(readNum('shader-physarum-deposit'));
  const physarumSensor = $derived(readNum('shader-physarum-sensor'));
  const physarumTurn = $derived(readNum('shader-physarum-turn'));

  // Rain
  const rainDensity = $derived(readNum('shader-rain-density'));
  const rainSpeed = $derived(readNum('shader-rain-speed'));
  const rainSize = $derived(readNum('shader-rain-size'));
  const rainRefraction = $derived(readNum('shader-rain-refraction'));
  const rainBlur = $derived(readNum('shader-rain-blur'));

  // Frost
  const frostGrowth = $derived(readNum('shader-frost-growth'));
  const frostBranch = $derived(readNum('shader-frost-branch'));
  const frostSymmetry = $derived(readNum('shader-frost-symmetry'));
  const frostMelt = $derived(readNum('shader-frost-melt'));
  const frostGlow = $derived(readNum('shader-frost-glow'));

  // Glow
  const glowCount = $derived(readNum('shader-glow-count'));
  const glowPulse = $derived(readNum('shader-glow-pulse'));
  const glowSize = $derived(readNum('shader-glow-size'));
  const glowDrift = $derived(readNum('shader-glow-drift'));
  const glowTrail = $derived(readNum('shader-glow-trail'));
  const glowDepth = $derived(readNum('shader-glow-depth'));

  // SmoothLife
  const lifeInner = $derived(readNum('shader-life-inner'));
  const lifeOuter = $derived(readNum('shader-life-outer'));
  const lifeBirth = $derived(readNum('shader-life-birth'));
  const lifeDeath = $derived(readNum('shader-life-death'));
  const lifeSpeed = $derived(readNum('shader-life-speed'));

  // Mycelium
  const myceliumGrowth = $derived(readNum('shader-mycelium-growth'));
  const myceliumBranch = $derived(readNum('shader-mycelium-branch'));
  const myceliumSpread = $derived(readNum('shader-mycelium-spread'));
  const myceliumPulse = $derived(readNum('shader-mycelium-pulse'));
  const myceliumThickness = $derived(readNum('shader-mycelium-thickness'));

  // Aurora
  const auroraLayers = $derived(readNum('shader-aurora-layers'));
  const auroraSpeed = $derived(readNum('shader-aurora-speed'));
  const auroraHeight = $derived(readNum('shader-aurora-height'));
  const auroraSpread = $derived(readNum('shader-aurora-spread'));
  const auroraShimmer = $derived(readNum('shader-aurora-shimmer'));

  // Tendrils
  const tendrilsScale = $derived(readNum('shader-tendrils-scale'));
  const tendrilsSpeed = $derived(readNum('shader-tendrils-speed'));
  const tendrilsSteps = $derived(readNum('shader-tendrils-steps'));
  const tendrilsCurl = $derived(readNum('shader-tendrils-curl'));
  const tendrilsFade = $derived(readNum('shader-tendrils-fade'));

  // Pollen
  const pollenDensity = $derived(readNum('shader-pollen-density'));
  const pollenSize = $derived(readNum('shader-pollen-size'));
  const pollenFibres = $derived(readNum('shader-pollen-fibres'));
  const pollenDrift = $derived(readNum('shader-pollen-drift'));
  const pollenDepth = $derived(readNum('shader-pollen-depth'));
  const pollenBokeh = $derived(readNum('shader-pollen-bokeh'));

  // Growth
  const growthSpeed = $derived(readNum('shader-growth-speed'));
  const growthNoise = $derived(readNum('shader-growth-noise'));
  const growthScale = $derived(readNum('shader-growth-scale'));
  const growthWidth = $derived(readNum('shader-growth-width'));
  const growthGlow = $derived(readNum('shader-growth-glow'));

  // Geode
  const geodeBands = $derived(readNum('shader-geode-bands'));
  const geodeWarp = $derived(readNum('shader-geode-warp'));
  const geodeCavity = $derived(readNum('shader-geode-cavity'));
  const geodeSpeed = $derived(readNum('shader-geode-speed'));
  const geodeSparkle = $derived(readNum('shader-geode-sparkle'));

  // Lenia
  const leniaRadius = $derived(readNum('shader-lenia-radius'));
  const leniaGrowth = $derived(readNum('shader-lenia-growth'));
  const leniaWidth = $derived(readNum('shader-lenia-width'));
  const leniaSpeed = $derived(readNum('shader-lenia-speed'));
  const leniaDt = $derived(readNum('shader-lenia-dt'));

  // Ocean
  const oceanCausticScale = $derived(readNum('shader-ocean-caustic-scale'));
  const oceanSandScale = $derived(readNum('shader-ocean-sand-scale'));
  const oceanSpeed = $derived(readNum('shader-ocean-speed'));
  const oceanShadow = $derived(readNum('shader-ocean-shadow'));
  const oceanRipple = $derived(readNum('shader-ocean-ripple'));

  // Bismuth
  const bismuthTerraces = $derived(readNum('shader-bismuth-terraces'));
  const bismuthWarp = $derived(readNum('shader-bismuth-warp'));
  const bismuthIridescence = $derived(readNum('shader-bismuth-iridescence'));
  const bismuthSpeed = $derived(readNum('shader-bismuth-speed'));
  const bismuthEdge = $derived(readNum('shader-bismuth-edge'));

  // Pearl
  const pearlDisplacement = $derived(readNum('shader-pearl-displacement'));
  const pearlSpeed = $derived(readNum('shader-pearl-speed'));
  const pearlFresnel = $derived(readNum('shader-pearl-fresnel'));
  const pearlSpecular = $derived(readNum('shader-pearl-specular'));

  // Vortex
  const vortexSpeed = $derived(readNum('shader-vortex-speed'));
  const vortexDensity = $derived(readNum('shader-vortex-density'));
  const vortexTwist = $derived(readNum('shader-vortex-twist'));
  const vortexRings = $derived(readNum('shader-vortex-rings'));
  const vortexSpiral = $derived(readNum('shader-vortex-spiral'));

  // Gyroid
  const gyroidScale1 = $derived(readNum('shader-gyroid-scale1'));
  const gyroidScale2 = $derived(readNum('shader-gyroid-scale2'));
  const gyroidSpeed = $derived(readNum('shader-gyroid-speed'));
  const gyroidDensity = $derived(readNum('shader-gyroid-density'));
  const gyroidThickness = $derived(readNum('shader-gyroid-thickness'));

  // Waves
  const wavesHeight = $derived(readNum('shader-waves-height'));
  const wavesSpeed = $derived(readNum('shader-waves-speed'));
  const wavesChop = $derived(readNum('shader-waves-chop'));
  const wavesFoam = $derived(readNum('shader-waves-foam'));
  const wavesDepth = $derived(readNum('shader-waves-depth'));

  // Clouds
  const cloudsCover = $derived(readNum('shader-clouds-cover'));
  const cloudsSpeed = $derived(readNum('shader-clouds-speed'));
  const cloudsScale = $derived(readNum('shader-clouds-scale'));
  const cloudsDark = $derived(readNum('shader-clouds-dark'));
  const cloudsLight = $derived(readNum('shader-clouds-light'));

  // Fracture
  const fractureCuts = $derived(readNum('shader-fracture-cuts'));
  const fractureSpeed = $derived(readNum('shader-fracture-speed'));
  const fractureBorder = $derived(readNum('shader-fracture-border'));
  const fractureShadow = $derived(readNum('shader-fracture-shadow'));
  const fractureFill = $derived(readNum('shader-fracture-fill'));

  // Julia
  const juliaZoom = $derived(readNum('shader-julia-zoom'));
  const juliaSpeed = $derived(readNum('shader-julia-speed'));
  const juliaIterations = $derived(readNum('shader-julia-iterations'));
  const juliaRadius = $derived(readNum('shader-julia-radius'));
  const juliaSaturation = $derived(readNum('shader-julia-saturation'));

  // Vapor
  const vaporDensity = $derived(readNum('shader-vapor-density'));
  const vaporSpeed = $derived(readNum('shader-vapor-speed'));
  const vaporScale = $derived(readNum('shader-vapor-scale'));
  const vaporWarmth = $derived(readNum('shader-vapor-warmth'));
  const vaporGlow = $derived(readNum('shader-vapor-glow'));

  // Tunnel
  const tunnelSpeed = $derived(readNum('shader-tunnel-speed'));
  const tunnelFractal = $derived(readNum('shader-tunnel-fractal'));
  const tunnelRadius = $derived(readNum('shader-tunnel-radius'));
  const tunnelBrightness = $derived(readNum('shader-tunnel-brightness'));
  const tunnelTwist = $derived(readNum('shader-tunnel-twist'));

  // Plasma
  const plasmaSpeed = $derived(readNum('shader-plasma-speed'));
  const plasmaBands = $derived(readNum('shader-plasma-bands'));
  const plasmaPressure = $derived(readNum('shader-plasma-pressure'));
  const plasmaTurn = $derived(readNum('shader-plasma-turn'));
  const plasmaDiffusion = $derived(readNum('shader-plasma-diffusion'));

  // Flow
  const flowCurl = $derived(readNum('shader-flow-curl'));
  const flowAdvection = $derived(readNum('shader-flow-advection'));
  const flowSmoothing = $derived(readNum('shader-flow-smoothing'));
  const flowContrast = $derived(readNum('shader-flow-contrast'));
  const flowFieldSpeed = $derived(readNum('shader-flow-field-speed'));

  // Spore
  const sporeSensorAngle = $derived(readNum('shader-spore-sensor-angle'));
  const sporeSensorOffset = $derived(readNum('shader-spore-sensor-offset'));
  const sporeStepSize = $derived(readNum('shader-spore-step-size'));
  const sporeRotation = $derived(readNum('shader-spore-rotation'));
  const sporeDecay = $derived(readNum('shader-spore-decay'));

  // ── Update helpers ─────────────────────────────────────────────────────
  function updateOverride(key: string, value: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    // Remove if the value matches the default (so it falls back to ShaderHero defaults)
    if (!value || value === DEFAULTS[key]) {
      delete current[key];
    } else {
      current[key] = value;
    }
    brandEditor.updateField('tokenOverrides', current);
  }

  function selectPreset(presetId: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };

    if (presetId === 'none') {
      // Clear ALL shader-* overrides so no stale config lingers
      for (const key of ALL_SHADER_KEYS) {
        delete current[key];
      }
    } else {
      // Set the preset, keep existing slider values
      current['shader-preset'] = presetId;
    }

    brandEditor.updateField('tokenOverrides', current);
  }

  // ── Slider input handlers ──────────────────────────────────────────────
  function handleSliderInput(key: string) {
    return (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      updateOverride(key, v);
    };
  }
</script>

<div class="hero-fx">
  <!-- Preset selector -->
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Shader Preset</span>
    <div class="hero-fx__preset-grid">
      {#each PRESETS as preset (preset.id)}
        <button
          type="button"
          class="hero-fx__preset-card"
          class:hero-fx__preset-card--active={activePreset === preset.id}
          onclick={() => selectPreset(preset.id)}
        >
          <span class="hero-fx__preset-label">{preset.label}</span>
          <span class="hero-fx__preset-desc">{preset.description}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Shared sliders (only when a preset is active) -->
  {#if activePreset !== 'none'}
    <section class="hero-fx__section">
      <span class="hero-fx__section-label">Global</span>

      <BrandSliderField
        id="shader-intensity"
        label="Intensity"
        value={intensity.toFixed(2)}
        min={0.10}
        max={6.00}
        step={0.05}
        current={intensity}
        minLabel="Subtle"
        maxLabel="Blazing"
        oninput={handleSliderInput('shader-intensity')}
      />

      <BrandSliderField
        id="shader-grain"
        label="Grain"
        value={grain.toFixed(3)}
        min={0.000}
        max={0.080}
        step={0.005}
        current={grain}
        minLabel="Clean"
        maxLabel="Gritty"
        oninput={handleSliderInput('shader-grain')}
      />

      <BrandSliderField
        id="shader-vignette"
        label="Vignette"
        value={vignette.toFixed(2)}
        min={0.00}
        max={0.50}
        step={0.05}
        current={vignette}
        minLabel="None"
        maxLabel="Heavy"
        oninput={handleSliderInput('shader-vignette')}
      />
    </section>

    <!-- Per-preset sliders -->
    {#if activePreset === 'suture'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Suture Fluid</span>

        <BrandSliderField
          id="shader-curl"
          label="Curl Strength"
          value={String(Math.round(curl))}
          min={1}
          max={80}
          step={1}
          current={curl}
          minLabel="Calm"
          maxLabel="Chaotic"
          oninput={handleSliderInput('shader-curl')}
        />

        <BrandSliderField
          id="shader-dissipation"
          label="Dissipation"
          value={dissipation.toFixed(3)}
          min={0.900}
          max={0.999}
          step={0.001}
          current={dissipation}
          minLabel="Fast"
          maxLabel="Slow"
          oninput={handleSliderInput('shader-dissipation')}
        />

        <BrandSliderField
          id="shader-advection"
          label="Advection"
          value={advection.toFixed(1)}
          min={1.0}
          max={15.0}
          step={0.5}
          current={advection}
          minLabel="Short"
          maxLabel="Long"
          oninput={handleSliderInput('shader-advection')}
        />

        <BrandSliderField
          id="shader-force"
          label="Mouse Force"
          value={force.toFixed(2)}
          min={0.10}
          max={3.00}
          step={0.10}
          current={force}
          minLabel="Gentle"
          maxLabel="Strong"
          oninput={handleSliderInput('shader-force')}
        />
      </section>
    {:else if activePreset === 'ether'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Ether</span>

        <BrandSliderField
          id="shader-rotation-speed"
          label="Rotation Speed"
          value={rotationSpeed.toFixed(2)}
          min={0.10}
          max={1.00}
          step={0.05}
          current={rotationSpeed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-rotation-speed')}
        />

        <BrandSliderField
          id="shader-complexity"
          label="Complexity"
          value={String(Math.round(complexity))}
          min={3}
          max={8}
          step={1}
          current={complexity}
          minLabel="Simple"
          maxLabel="Complex"
          oninput={handleSliderInput('shader-complexity')}
        />

        <BrandSliderField
          id="shader-zoom"
          label="Zoom"
          value={zoom.toFixed(1)}
          min={1.0}
          max={8.0}
          step={0.5}
          current={zoom}
          minLabel="Close"
          maxLabel="Far"
          oninput={handleSliderInput('shader-zoom')}
        />

        <BrandSliderField
          id="shader-glow"
          label="Glow"
          value={glow.toFixed(2)}
          min={0.10}
          max={1.50}
          step={0.05}
          current={glow}
          minLabel="Dim"
          maxLabel="Bright"
          oninput={handleSliderInput('shader-glow')}
        />

        <BrandSliderField
          id="shader-scale"
          label="Scale"
          value={scale.toFixed(2)}
          min={0.50}
          max={4.00}
          step={0.25}
          current={scale}
          minLabel="Small"
          maxLabel="Large"
          oninput={handleSliderInput('shader-scale')}
        />

        <BrandSliderField
          id="shader-aberration"
          label="Chromatic Aberration"
          value={aberration.toFixed(3)}
          min={0.000}
          max={0.020}
          step={0.001}
          current={aberration}
          minLabel="None"
          maxLabel="Heavy"
          oninput={handleSliderInput('shader-aberration')}
        />
      </section>
    {:else if activePreset === 'warp'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Domain Warp</span>

        <BrandSliderField
          id="shader-warp-strength"
          label="Warp Strength"
          value={warpStrength.toFixed(2)}
          min={0.50}
          max={3.00}
          step={0.10}
          current={warpStrength}
          minLabel="Gentle"
          maxLabel="Extreme"
          oninput={handleSliderInput('shader-warp-strength')}
        />

        <BrandSliderField
          id="shader-light-angle"
          label="Light Angle"
          value="{Math.round(lightAngle)}°"
          min={0}
          max={360}
          step={5}
          current={lightAngle}
          minLabel="0°"
          maxLabel="360°"
          oninput={handleSliderInput('shader-light-angle')}
        />

        <BrandSliderField
          id="shader-speed"
          label="Animation Speed"
          value={speed.toFixed(2)}
          min={0.05}
          max={1.00}
          step={0.05}
          current={speed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-speed')}
        />

        <BrandSliderField
          id="shader-detail"
          label="Detail (octaves)"
          value={String(Math.round(detail))}
          min={2}
          max={6}
          step={1}
          current={detail}
          minLabel="Smooth"
          maxLabel="Detailed"
          oninput={handleSliderInput('shader-detail')}
        />

        <BrandSliderField
          id="shader-contrast"
          label="Contrast"
          value={contrast.toFixed(2)}
          min={0.50}
          max={2.00}
          step={0.10}
          current={contrast}
          minLabel="Flat"
          maxLabel="Punchy"
          oninput={handleSliderInput('shader-contrast')}
        />

        <div class="hero-fx__toggle-row">
          <span class="hero-fx__toggle-label">Invert Colors</span>
          <button
            type="button"
            class="hero-fx__toggle"
            class:hero-fx__toggle--on={invert}
            onclick={() => updateOverride('shader-invert', invert ? '0' : '1')}
            role="switch"
            aria-label="Toggle invert colors"
            aria-checked={invert}
          >
            <span class="hero-fx__toggle-thumb"></span>
          </button>
        </div>
      </section>
    {:else if activePreset === 'ripple'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Water Ripple</span>

        <BrandSliderField
          id="shader-wave-speed"
          label="Wave Speed"
          value={waveSpeed.toFixed(2)}
          min={0.10}
          max={2.00}
          step={0.10}
          current={waveSpeed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-wave-speed')}
        />

        <BrandSliderField
          id="shader-damping"
          label="Damping"
          value={damping.toFixed(3)}
          min={0.980}
          max={0.999}
          step={0.001}
          current={damping}
          minLabel="Quick"
          maxLabel="Lasting"
          oninput={handleSliderInput('shader-damping')}
        />

        <BrandSliderField
          id="shader-ripple-size"
          label="Ripple Size"
          value={rippleSize.toFixed(3)}
          min={0.010}
          max={0.100}
          step={0.005}
          current={rippleSize}
          minLabel="Tiny"
          maxLabel="Wide"
          oninput={handleSliderInput('shader-ripple-size')}
        />

        <BrandSliderField
          id="shader-refraction"
          label="Refraction"
          value={refraction.toFixed(2)}
          min={0.10}
          max={1.00}
          step={0.05}
          current={refraction}
          minLabel="Flat"
          maxLabel="Deep"
          oninput={handleSliderInput('shader-refraction')}
        />
      </section>
    {:else if activePreset === 'pulse'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Pulse</span>

        <div class="hero-fx__color-row">
          <span class="hero-fx__color-label">Surface Color</span>
          <input
            type="color"
            value={pulseColor}
            oninput={(e) => updateOverride('shader-pulse-color', (e.target as HTMLInputElement).value)}
            class="hero-fx__color-input"
          />
        </div>

        <BrandSliderField
          id="shader-pulse-damping"
          label="Persistence"
          value={pulseDamping.toFixed(2)}
          min={0.93}
          max={0.99}
          step={0.01}
          current={pulseDamping}
          minLabel="Fleeting"
          maxLabel="Lasting"
          oninput={handleSliderInput('shader-pulse-damping')}
        />

        <BrandSliderField
          id="shader-wave-scale"
          label="Wave Height"
          value={waveScale.toFixed(1)}
          min={1.0}
          max={10.0}
          step={0.5}
          current={waveScale}
          minLabel="Subtle"
          maxLabel="Dramatic"
          oninput={handleSliderInput('shader-wave-scale')}
        />

        <BrandSliderField
          id="shader-cam-height"
          label="View Height"
          value={String(Math.round(camHeight))}
          min={10}
          max={50}
          step={1}
          current={camHeight}
          minLabel="Low"
          maxLabel="High"
          oninput={handleSliderInput('shader-cam-height')}
        />

        <BrandSliderField
          id="shader-cam-target"
          label="View Depth"
          value={String(Math.round(camTarget))}
          min={-50}
          max={0}
          step={1}
          current={camTarget}
          minLabel="Near"
          maxLabel="Far"
          oninput={handleSliderInput('shader-cam-target')}
        />

        <BrandSliderField
          id="shader-specular"
          label="Shine"
          value={specular.toFixed(2)}
          min={0.00}
          max={1.00}
          step={0.05}
          current={specular}
          minLabel="Matte"
          maxLabel="Glossy"
          oninput={handleSliderInput('shader-specular')}
        />

        <BrandSliderField
          id="shader-impulse-size"
          label="Touch Size"
          value={impulseSize.toFixed(3)}
          min={0.010}
          max={0.100}
          step={0.005}
          current={impulseSize}
          minLabel="Focused"
          maxLabel="Broad"
          oninput={handleSliderInput('shader-impulse-size')}
        />
      </section>
    {:else if activePreset === 'ink'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Ink Dispersion</span>

        <BrandSliderField
          id="shader-ink-diffusion"
          label="Diffusion Rate"
          value={inkDiffusion.toFixed(2)}
          min={0.50}
          max={3.00}
          step={0.10}
          current={inkDiffusion}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-ink-diffusion')}
        />

        <BrandSliderField
          id="shader-ink-advection"
          label="Flow Strength"
          value={inkAdvection.toFixed(2)}
          min={0.00}
          max={2.00}
          step={0.10}
          current={inkAdvection}
          minLabel="Still"
          maxLabel="Swirling"
          oninput={handleSliderInput('shader-ink-advection')}
        />

        <BrandSliderField
          id="shader-ink-drop-size"
          label="Drop Size"
          value={inkDropSize.toFixed(3)}
          min={0.020}
          max={0.100}
          step={0.005}
          current={inkDropSize}
          minLabel="Tiny"
          maxLabel="Wide"
          oninput={handleSliderInput('shader-ink-drop-size')}
        />

        <BrandSliderField
          id="shader-ink-evaporation"
          label="Persistence"
          value={inkEvaporation.toFixed(3)}
          min={0.990}
          max={0.999}
          step={0.001}
          current={inkEvaporation}
          minLabel="Fleeting"
          maxLabel="Lasting"
          oninput={handleSliderInput('shader-ink-evaporation')}
        />

        <BrandSliderField
          id="shader-ink-curl"
          label="Swirl Detail"
          value={String(Math.round(inkCurl))}
          min={5}
          max={40}
          step={1}
          current={inkCurl}
          minLabel="Broad"
          maxLabel="Fine"
          oninput={handleSliderInput('shader-ink-curl')}
        />
      </section>
    {:else if activePreset === 'topo'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Topo</span>

        <BrandSliderField
          id="shader-topo-line-count"
          label="Contour Lines"
          value={String(Math.round(topoLineCount))}
          min={5}
          max={30}
          step={1}
          current={topoLineCount}
          minLabel="Few"
          maxLabel="Dense"
          oninput={handleSliderInput('shader-topo-line-count')}
        />

        <BrandSliderField
          id="shader-topo-line-width"
          label="Line Width"
          value={topoLineWidth.toFixed(1)}
          min={0.5}
          max={3.0}
          step={0.1}
          current={topoLineWidth}
          minLabel="Thin"
          maxLabel="Thick"
          oninput={handleSliderInput('shader-topo-line-width')}
        />

        <BrandSliderField
          id="shader-topo-speed"
          label="Animation Speed"
          value={topoSpeed.toFixed(2)}
          min={0.05}
          max={0.50}
          step={0.05}
          current={topoSpeed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-topo-speed')}
        />

        <BrandSliderField
          id="shader-topo-scale"
          label="Noise Scale"
          value={topoScale.toFixed(1)}
          min={1.0}
          max={5.0}
          step={0.5}
          current={topoScale}
          minLabel="Zoomed"
          maxLabel="Wide"
          oninput={handleSliderInput('shader-topo-scale')}
        />

        <BrandSliderField
          id="shader-topo-elevation"
          label="Mouse Elevation"
          value={topoElevation.toFixed(1)}
          min={0.5}
          max={3.0}
          step={0.1}
          current={topoElevation}
          minLabel="Flat"
          maxLabel="Tall"
          oninput={handleSliderInput('shader-topo-elevation')}
        />

        <BrandSliderField
          id="shader-topo-octaves"
          label="Detail (octaves)"
          value={String(Math.round(topoOctaves))}
          min={2}
          max={5}
          step={1}
          current={topoOctaves}
          minLabel="Smooth"
          maxLabel="Detailed"
          oninput={handleSliderInput('shader-topo-octaves')}
        />
      </section>
    {:else if activePreset === 'nebula'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Nebula</span>

        <BrandSliderField
          id="shader-nebula-density"
          label="Gas Density"
          value={nebulaDensity.toFixed(2)}
          min={0.30}
          max={2.00}
          step={0.05}
          current={nebulaDensity}
          minLabel="Thin"
          maxLabel="Thick"
          oninput={handleSliderInput('shader-nebula-density')}
        />

        <BrandSliderField
          id="shader-nebula-speed"
          label="Evolution Speed"
          value={nebulaSpeed.toFixed(2)}
          min={0.05}
          max={0.50}
          step={0.01}
          current={nebulaSpeed}
          minLabel="Frozen"
          maxLabel="Flowing"
          oninput={handleSliderInput('shader-nebula-speed')}
        />

        <BrandSliderField
          id="shader-nebula-scale"
          label="Cloud Scale"
          value={nebulaScale.toFixed(1)}
          min={1.0}
          max={5.0}
          step={0.5}
          current={nebulaScale}
          minLabel="Fine"
          maxLabel="Vast"
          oninput={handleSliderInput('shader-nebula-scale')}
        />

        <BrandSliderField
          id="shader-nebula-depth"
          label="Depth Quality"
          value={String(Math.round(nebulaDepth))}
          min={4}
          max={16}
          step={1}
          current={nebulaDepth}
          minLabel="Fast"
          maxLabel="Rich"
          oninput={handleSliderInput('shader-nebula-depth')}
        />

        <BrandSliderField
          id="shader-nebula-wind"
          label="Stellar Wind"
          value={nebulaWind.toFixed(2)}
          min={0.00}
          max={2.00}
          step={0.05}
          current={nebulaWind}
          minLabel="Still"
          maxLabel="Gale"
          oninput={handleSliderInput('shader-nebula-wind')}
        />

        <BrandSliderField
          id="shader-nebula-stars"
          label="Star Density"
          value={nebulaStars.toFixed(2)}
          min={0.00}
          max={1.00}
          step={0.05}
          current={nebulaStars}
          minLabel="Dark"
          maxLabel="Milky"
          oninput={handleSliderInput('shader-nebula-stars')}
        />
      </section>
    {:else if activePreset === 'turing'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Turing Patterns</span>
        <BrandSliderField id="shader-turing-feed" label="Feed Rate" value={turingFeed.toFixed(3)} min={0.020} max={0.080} step={0.001} current={turingFeed} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-turing-feed')} />
        <BrandSliderField id="shader-turing-kill" label="Kill Rate" value={turingKill.toFixed(3)} min={0.050} max={0.070} step={0.001} current={turingKill} minLabel="Spots" maxLabel="Maze" oninput={handleSliderInput('shader-turing-kill')} />
        <BrandSliderField id="shader-turing-da" label="Diffusion A" value={turingDa.toFixed(2)} min={0.80} max={1.20} step={0.05} current={turingDa} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-turing-da')} />
        <BrandSliderField id="shader-turing-db" label="Diffusion B" value={turingDb.toFixed(2)} min={0.30} max={0.60} step={0.05} current={turingDb} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-turing-db')} />
        <BrandSliderField id="shader-turing-speed" label="Sim Speed" value={String(Math.round(turingSpeed))} min={1} max={8} step={1} current={turingSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-turing-speed')} />
      </section>
    {:else if activePreset === 'silk'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Silk Fabric</span>
        <BrandSliderField id="shader-silk-fold-scale" label="Fold Scale" value={silkFoldScale.toFixed(1)} min={1.0} max={5.0} step={0.5} current={silkFoldScale} minLabel="Fine" maxLabel="Broad" oninput={handleSliderInput('shader-silk-fold-scale')} />
        <BrandSliderField id="shader-silk-fold-depth" label="Fold Depth" value={silkFoldDepth.toFixed(1)} min={0.5} max={3.0} step={0.1} current={silkFoldDepth} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-silk-fold-depth')} />
        <BrandSliderField id="shader-silk-speed" label="Flow Speed" value={silkSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={silkSpeed} minLabel="Still" maxLabel="Flowing" oninput={handleSliderInput('shader-silk-speed')} />
        <BrandSliderField id="shader-silk-softness" label="Light Wrap" value={silkSoftness.toFixed(2)} min={0.30} max={1.00} step={0.05} current={silkSoftness} minLabel="Harder" maxLabel="Softer" oninput={handleSliderInput('shader-silk-softness')} />
        <BrandSliderField id="shader-silk-sheen" label="Sheen" value={silkSheen.toFixed(2)} min={0.00} max={0.50} step={0.05} current={silkSheen} minLabel="Matte" maxLabel="Satin" oninput={handleSliderInput('shader-silk-sheen')} />
        <BrandSliderField id="shader-silk-lining" label="Lining Peek" value={silkLining.toFixed(2)} min={0.00} max={0.50} step={0.05} current={silkLining} minLabel="None" maxLabel="Visible" oninput={handleSliderInput('shader-silk-lining')} />
      </section>
    {:else if activePreset === 'glass'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Stained Glass</span>
        <BrandSliderField id="shader-glass-cell-size" label="Cell Size" value={glassCellSize.toFixed(1)} min={3.0} max={10.0} step={0.5} current={glassCellSize} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-glass-cell-size')} />
        <BrandSliderField id="shader-glass-border" label="Border Width" value={glassBorder.toFixed(2)} min={0.02} max={0.10} step={0.01} current={glassBorder} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-glass-border')} />
        <BrandSliderField id="shader-glass-drift" label="Drift Speed" value={glassDrift.toFixed(2)} min={0.05} max={0.30} step={0.01} current={glassDrift} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-glass-drift')} />
        <BrandSliderField id="shader-glass-glow" label="Edge Glow" value={glassGlow.toFixed(2)} min={0.00} max={0.50} step={0.05} current={glassGlow} minLabel="None" maxLabel="Bright" oninput={handleSliderInput('shader-glass-glow')} />
        <BrandSliderField id="shader-glass-light" label="Light Shift" value={glassLight.toFixed(2)} min={0.00} max={0.50} step={0.05} current={glassLight} minLabel="Static" maxLabel="Vivid" oninput={handleSliderInput('shader-glass-light')} />
      </section>
    {:else if activePreset === 'film'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Oil Film</span>
        <BrandSliderField id="shader-film-scale" label="Noise Scale" value={filmScale.toFixed(1)} min={1.0} max={5.0} step={0.5} current={filmScale} minLabel="Fine" maxLabel="Broad" oninput={handleSliderInput('shader-film-scale')} />
        <BrandSliderField id="shader-film-speed" label="Animation Speed" value={filmSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={filmSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-film-speed')} />
        <BrandSliderField id="shader-film-bands" label="Colour Bands" value={filmBands.toFixed(1)} min={2.0} max={8.0} step={0.5} current={filmBands} minLabel="Smooth" maxLabel="Tight" oninput={handleSliderInput('shader-film-bands')} />
        <BrandSliderField id="shader-film-shift" label="Angle Shift" value={filmShift.toFixed(2)} min={0.00} max={1.00} step={0.05} current={filmShift} minLabel="None" maxLabel="Strong" oninput={handleSliderInput('shader-film-shift')} />
        <BrandSliderField id="shader-film-ripple" label="Ripple Strength" value={filmRipple.toFixed(1)} min={0.5} max={3.0} step={0.1} current={filmRipple} minLabel="Gentle" maxLabel="Intense" oninput={handleSliderInput('shader-film-ripple')} />
      </section>
    {:else if activePreset === 'flux'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Magnetic Flux</span>
        <BrandSliderField id="shader-flux-poles" label="Magnetic Poles" value={String(Math.round(fluxPoles))} min={2} max={5} step={1} current={fluxPoles} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-flux-poles')} />
        <BrandSliderField id="shader-flux-line-density" label="Line Density" value={fluxLineDensity.toFixed(1)} min={5.0} max={20.0} step={0.5} current={fluxLineDensity} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-flux-line-density')} />
        <BrandSliderField id="shader-flux-line-width" label="Line Width" value={fluxLineWidth.toFixed(1)} min={0.5} max={2.0} step={0.1} current={fluxLineWidth} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-flux-line-width')} />
        <BrandSliderField id="shader-flux-strength" label="Mouse Strength" value={fluxStrength.toFixed(1)} min={0.5} max={3.0} step={0.1} current={fluxStrength} minLabel="Gentle" maxLabel="Strong" oninput={handleSliderInput('shader-flux-strength')} />
        <BrandSliderField id="shader-flux-speed" label="Rotation Speed" value={fluxSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={fluxSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-flux-speed')} />
      </section>
    {:else if activePreset === 'lava'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Lava</span>
        <BrandSliderField id="shader-lava-crack-scale" label="Crack Density" value={lavaCrackScale.toFixed(1)} min={2.0} max={8.0} step={0.5} current={lavaCrackScale} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-lava-crack-scale')} />
        <BrandSliderField id="shader-lava-crack-width" label="Crack Width" value={lavaCrackWidth.toFixed(2)} min={0.02} max={0.10} step={0.01} current={lavaCrackWidth} minLabel="Thin" maxLabel="Wide" oninput={handleSliderInput('shader-lava-crack-width')} />
        <BrandSliderField id="shader-lava-glow" label="Crack Glow" value={lavaGlow.toFixed(1)} min={0.5} max={3.0} step={0.1} current={lavaGlow} minLabel="Dim" maxLabel="Blazing" oninput={handleSliderInput('shader-lava-glow')} />
        <BrandSliderField id="shader-lava-speed" label="Flow Speed" value={lavaSpeed.toFixed(2)} min={0.05} max={0.25} step={0.01} current={lavaSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-lava-speed')} />
        <BrandSliderField id="shader-lava-crust" label="Crust Darkness" value={lavaCrust.toFixed(2)} min={0.30} max={1.00} step={0.05} current={lavaCrust} minLabel="Light" maxLabel="Dark" oninput={handleSliderInput('shader-lava-crust')} />
        <BrandSliderField id="shader-lava-heat" label="Mouse Heat" value={lavaHeat.toFixed(1)} min={0.5} max={2.0} step={0.1} current={lavaHeat} minLabel="Cool" maxLabel="Hot" oninput={handleSliderInput('shader-lava-heat')} />
      </section>
    {:else if activePreset === 'caustic'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Caustics</span>
        <BrandSliderField id="shader-caustic-scale" label="Pattern Scale" value={causticScale.toFixed(1)} min={1.0} max={5.0} step={0.5} current={causticScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-caustic-scale')} />
        <BrandSliderField id="shader-caustic-speed" label="Animation Speed" value={causticSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={causticSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-caustic-speed')} />
        <BrandSliderField id="shader-caustic-iterations" label="Detail Layers" value={String(Math.round(causticIterations))} min={2} max={5} step={1} current={causticIterations} minLabel="Simple" maxLabel="Complex" oninput={handleSliderInput('shader-caustic-iterations')} />
        <BrandSliderField id="shader-caustic-brightness" label="Highlight Power" value={causticBrightness.toFixed(1)} min={0.5} max={2.0} step={0.1} current={causticBrightness} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-caustic-brightness')} />
        <BrandSliderField id="shader-caustic-ripple" label="Mouse Ripple" value={causticRipple.toFixed(1)} min={0.5} max={3.0} step={0.1} current={causticRipple} minLabel="Gentle" maxLabel="Strong" oninput={handleSliderInput('shader-caustic-ripple')} />
      </section>
    {:else if activePreset === 'physarum'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Physarum Network</span>
        <BrandSliderField id="shader-physarum-diffusion" label="Trail Spread" value={physarumDiffusion.toFixed(2)} min={0.50} max={2.00} step={0.05} current={physarumDiffusion} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-physarum-diffusion')} />
        <BrandSliderField id="shader-physarum-decay" label="Trail Persistence" value={physarumDecay.toFixed(3)} min={0.950} max={0.999} step={0.001} current={physarumDecay} minLabel="Fleeting" maxLabel="Lasting" oninput={handleSliderInput('shader-physarum-decay')} />
        <BrandSliderField id="shader-physarum-deposit" label="Deposit Strength" value={physarumDeposit.toFixed(2)} min={0.50} max={2.00} step={0.05} current={physarumDeposit} minLabel="Faint" maxLabel="Strong" oninput={handleSliderInput('shader-physarum-deposit')} />
        <BrandSliderField id="shader-physarum-sensor" label="Sensor Distance" value={physarumSensor.toFixed(3)} min={0.010} max={0.050} step={0.005} current={physarumSensor} minLabel="Near" maxLabel="Far" oninput={handleSliderInput('shader-physarum-sensor')} />
        <BrandSliderField id="shader-physarum-turn" label="Turn Speed" value={physarumTurn.toFixed(2)} min={0.10} max={0.50} step={0.05} current={physarumTurn} minLabel="Gradual" maxLabel="Sharp" oninput={handleSliderInput('shader-physarum-turn')} />
      </section>
    {:else if activePreset === 'rain'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Rain on Glass</span>
        <BrandSliderField id="shader-rain-density" label="Drop Density" value={rainDensity.toFixed(2)} min={0.30} max={1.00} step={0.05} current={rainDensity} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-rain-density')} />
        <BrandSliderField id="shader-rain-speed" label="Fall Speed" value={rainSpeed.toFixed(2)} min={0.50} max={2.00} step={0.05} current={rainSpeed} minLabel="Drizzle" maxLabel="Downpour" oninput={handleSliderInput('shader-rain-speed')} />
        <BrandSliderField id="shader-rain-size" label="Drop Size" value={rainSize.toFixed(2)} min={0.50} max={2.00} step={0.05} current={rainSize} minLabel="Fine" maxLabel="Heavy" oninput={handleSliderInput('shader-rain-size')} />
        <BrandSliderField id="shader-rain-refraction" label="Refraction" value={rainRefraction.toFixed(2)} min={0.10} max={0.50} step={0.01} current={rainRefraction} minLabel="Subtle" maxLabel="Warped" oninput={handleSliderInput('shader-rain-refraction')} />
        <BrandSliderField id="shader-rain-blur" label="Background Blur" value={rainBlur.toFixed(2)} min={0.50} max={2.00} step={0.05} current={rainBlur} minLabel="Sharp" maxLabel="Dreamy" oninput={handleSliderInput('shader-rain-blur')} />
      </section>
    {:else if activePreset === 'frost'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Frost Crystal</span>
        <BrandSliderField id="shader-frost-growth" label="Growth Speed" value={frostGrowth.toFixed(2)} min={0.30} max={1.00} step={0.05} current={frostGrowth} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-frost-growth')} />
        <BrandSliderField id="shader-frost-branch" label="Branching" value={frostBranch.toFixed(2)} min={0.10} max={0.50} step={0.05} current={frostBranch} minLabel="Linear" maxLabel="Dendritic" oninput={handleSliderInput('shader-frost-branch')} />
        <BrandSliderField id="shader-frost-symmetry" label="Symmetry" value={String(Math.round(frostSymmetry))} min={4} max={8} step={1} current={frostSymmetry} minLabel="4-fold" maxLabel="8-fold" oninput={handleSliderInput('shader-frost-symmetry')} />
        <BrandSliderField id="shader-frost-melt" label="Melt Radius" value={frostMelt.toFixed(2)} min={0.50} max={2.00} step={0.10} current={frostMelt} minLabel="Small" maxLabel="Wide" oninput={handleSliderInput('shader-frost-melt')} />
        <BrandSliderField id="shader-frost-glow" label="Growth Glow" value={frostGlow.toFixed(2)} min={0.30} max={1.50} step={0.10} current={frostGlow} minLabel="Subtle" maxLabel="Bright" oninput={handleSliderInput('shader-frost-glow')} />
      </section>
    {:else if activePreset === 'glow'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Bioluminescent Glow</span>
        <BrandSliderField id="shader-glow-count" label="Organisms" value={String(Math.round(glowCount))} min={5} max={20} step={1} current={glowCount} minLabel="Sparse" maxLabel="Teeming" oninput={handleSliderInput('shader-glow-count')} />
        <BrandSliderField id="shader-glow-pulse" label="Pulse Speed" value={glowPulse.toFixed(2)} min={0.30} max={1.50} step={0.05} current={glowPulse} minLabel="Slow" maxLabel="Rapid" oninput={handleSliderInput('shader-glow-pulse')} />
        <BrandSliderField id="shader-glow-size" label="Organism Size" value={glowSize.toFixed(2)} min={0.50} max={2.00} step={0.10} current={glowSize} minLabel="Tiny" maxLabel="Large" oninput={handleSliderInput('shader-glow-size')} />
        <BrandSliderField id="shader-glow-drift" label="Drift Speed" value={glowDrift.toFixed(2)} min={0.05} max={0.30} step={0.01} current={glowDrift} minLabel="Still" maxLabel="Flowing" oninput={handleSliderInput('shader-glow-drift')} />
        <BrandSliderField id="shader-glow-trail" label="Trail Length" value={glowTrail.toFixed(2)} min={0.00} max={1.00} step={0.05} current={glowTrail} minLabel="None" maxLabel="Long" oninput={handleSliderInput('shader-glow-trail')} />
        <BrandSliderField id="shader-glow-depth" label="Depth Layers" value={String(Math.round(glowDepth))} min={2} max={4} step={1} current={glowDepth} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-glow-depth')} />
      </section>
    {:else if activePreset === 'life'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">SmoothLife</span>
        <BrandSliderField id="shader-life-inner" label="Organism Size" value={lifeInner.toFixed(1)} min={3.0} max={8.0} step={0.5} current={lifeInner} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-life-inner')} />
        <BrandSliderField id="shader-life-outer" label="Neighbourhood" value={lifeOuter.toFixed(1)} min={8.0} max={15.0} step={0.5} current={lifeOuter} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-life-outer')} />
        <BrandSliderField id="shader-life-birth" label="Birth Threshold" value={lifeBirth.toFixed(2)} min={0.25} max={0.40} step={0.01} current={lifeBirth} minLabel="Easy" maxLabel="Hard" oninput={handleSliderInput('shader-life-birth')} />
        <BrandSliderField id="shader-life-death" label="Death Threshold" value={lifeDeath.toFixed(2)} min={0.35} max={0.55} step={0.01} current={lifeDeath} minLabel="Fragile" maxLabel="Tough" oninput={handleSliderInput('shader-life-death')} />
        <BrandSliderField id="shader-life-speed" label="Sim Speed" value={String(Math.round(lifeSpeed))} min={1} max={4} step={1} current={lifeSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-life-speed')} />
      </section>
    {:else if activePreset === 'mycelium'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Mycelium</span>
        <BrandSliderField id="shader-mycelium-growth" label="Growth Speed" value={myceliumGrowth.toFixed(2)} min={0.30} max={1.00} step={0.05} current={myceliumGrowth} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-mycelium-growth')} />
        <BrandSliderField id="shader-mycelium-branch" label="Branching" value={myceliumBranch.toFixed(2)} min={0.10} max={0.50} step={0.05} current={myceliumBranch} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-mycelium-branch')} />
        <BrandSliderField id="shader-mycelium-spread" label="Spread" value={myceliumSpread.toFixed(2)} min={0.50} max={2.00} step={0.10} current={myceliumSpread} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-mycelium-spread')} />
        <BrandSliderField id="shader-mycelium-pulse" label="Pulse Speed" value={myceliumPulse.toFixed(2)} min={0.30} max={1.50} step={0.10} current={myceliumPulse} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-mycelium-pulse')} />
        <BrandSliderField id="shader-mycelium-thickness" label="Thickness" value={myceliumThickness.toFixed(2)} min={0.50} max={2.00} step={0.10} current={myceliumThickness} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-mycelium-thickness')} />
      </section>
    {:else if activePreset === 'aurora'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Aurora</span>
        <BrandSliderField id="shader-aurora-layers" label="Curtain Layers" value={String(Math.round(auroraLayers))} min={3} max={7} step={1} current={auroraLayers} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-aurora-layers')} />
        <BrandSliderField id="shader-aurora-speed" label="Sway Speed" value={auroraSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={auroraSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-aurora-speed')} />
        <BrandSliderField id="shader-aurora-height" label="Band Position" value={auroraHeight.toFixed(2)} min={0.20} max={0.60} step={0.05} current={auroraHeight} minLabel="Low" maxLabel="High" oninput={handleSliderInput('shader-aurora-height')} />
        <BrandSliderField id="shader-aurora-spread" label="Vertical Spread" value={auroraSpread.toFixed(2)} min={0.10} max={0.50} step={0.05} current={auroraSpread} minLabel="Narrow" maxLabel="Wide" oninput={handleSliderInput('shader-aurora-spread')} />
        <BrandSliderField id="shader-aurora-shimmer" label="Edge Shimmer" value={auroraShimmer.toFixed(2)} min={0.30} max={1.50} step={0.10} current={auroraShimmer} minLabel="Subtle" maxLabel="Intense" oninput={handleSliderInput('shader-aurora-shimmer')} />
      </section>
    {:else if activePreset === 'tendrils'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Tendrils</span>
        <BrandSliderField id="shader-tendrils-scale" label="Noise Scale" value={tendrilsScale.toFixed(2)} min={1.0} max={5.0} step={0.25} current={tendrilsScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-tendrils-scale')} />
        <BrandSliderField id="shader-tendrils-speed" label="Flow Speed" value={tendrilsSpeed.toFixed(2)} min={0.05} max={0.30} step={0.01} current={tendrilsSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-tendrils-speed')} />
        <BrandSliderField id="shader-tendrils-steps" label="Advection Steps" value={String(Math.round(tendrilsSteps))} min={3} max={7} step={1} current={tendrilsSteps} minLabel="Fast" maxLabel="Smooth" oninput={handleSliderInput('shader-tendrils-steps')} />
        <BrandSliderField id="shader-tendrils-curl" label="Curl Strength" value={tendrilsCurl.toFixed(2)} min={0.5} max={2.0} step={0.10} current={tendrilsCurl} minLabel="Gentle" maxLabel="Tight" oninput={handleSliderInput('shader-tendrils-curl')} />
        <BrandSliderField id="shader-tendrils-fade" label="Tendril Density" value={tendrilsFade.toFixed(2)} min={0.3} max={1.0} step={0.05} current={tendrilsFade} minLabel="Wispy" maxLabel="Dense" oninput={handleSliderInput('shader-tendrils-fade')} />
      </section>
    {:else if activePreset === 'pollen'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Pollen Drift</span>
        <BrandSliderField id="shader-pollen-density" label="Density" value={pollenDensity.toFixed(2)} min={0.30} max={1.00} step={0.05} current={pollenDensity} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-pollen-density')} />
        <BrandSliderField id="shader-pollen-size" label="Particle Size" value={pollenSize.toFixed(2)} min={0.50} max={2.00} step={0.10} current={pollenSize} minLabel="Tiny" maxLabel="Large" oninput={handleSliderInput('shader-pollen-size')} />
        <BrandSliderField id="shader-pollen-fibres" label="Fibre Count" value={String(Math.round(pollenFibres))} min={3} max={8} step={1} current={pollenFibres} minLabel="Simple" maxLabel="Complex" oninput={handleSliderInput('shader-pollen-fibres')} />
        <BrandSliderField id="shader-pollen-drift" label="Drift Speed" value={pollenDrift.toFixed(2)} min={0.05} max={0.25} step={0.01} current={pollenDrift} minLabel="Still" maxLabel="Breezy" oninput={handleSliderInput('shader-pollen-drift')} />
        <BrandSliderField id="shader-pollen-depth" label="Depth Layers" value={String(Math.round(pollenDepth))} min={2} max={4} step={1} current={pollenDepth} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-pollen-depth')} />
        <BrandSliderField id="shader-pollen-bokeh" label="Bokeh Blur" value={pollenBokeh.toFixed(2)} min={0.30} max={1.00} step={0.05} current={pollenBokeh} minLabel="Sharp" maxLabel="Soft" oninput={handleSliderInput('shader-pollen-bokeh')} />
      </section>
    {:else if activePreset === 'growth'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Differential Growth</span>
        <BrandSliderField id="shader-growth-speed" label="Growth Speed" value={growthSpeed.toFixed(2)} min={0.10} max={0.50} step={0.05} current={growthSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-growth-speed')} />
        <BrandSliderField id="shader-growth-noise" label="Buckling" value={growthNoise.toFixed(2)} min={0.30} max={1.50} step={0.10} current={growthNoise} minLabel="Smooth" maxLabel="Wrinkled" oninput={handleSliderInput('shader-growth-noise')} />
        <BrandSliderField id="shader-growth-scale" label="Wrinkle Scale" value={growthScale.toFixed(2)} min={1.00} max={4.00} step={0.25} current={growthScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-growth-scale')} />
        <BrandSliderField id="shader-growth-width" label="Edge Width" value={growthWidth.toFixed(2)} min={0.50} max={2.00} step={0.10} current={growthWidth} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-growth-width')} />
        <BrandSliderField id="shader-growth-glow" label="Edge Glow" value={growthGlow.toFixed(2)} min={0.30} max={1.50} step={0.10} current={growthGlow} minLabel="Subtle" maxLabel="Bright" oninput={handleSliderInput('shader-growth-glow')} />
      </section>
    {:else if activePreset === 'geode'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Geode</span>
        <BrandSliderField id="shader-geode-bands" label="Mineral Bands" value={String(Math.round(geodeBands))} min={4} max={12} step={1} current={geodeBands} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-geode-bands')} />
        <BrandSliderField id="shader-geode-warp" label="Band Irregularity" value={geodeWarp.toFixed(2)} min={0.30} max={1.50} step={0.05} current={geodeWarp} minLabel="Smooth" maxLabel="Jagged" oninput={handleSliderInput('shader-geode-warp')} />
        <BrandSliderField id="shader-geode-cavity" label="Crystal Cavity" value={geodeCavity.toFixed(2)} min={0.10} max={0.40} step={0.01} current={geodeCavity} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-geode-cavity')} />
        <BrandSliderField id="shader-geode-speed" label="Rotation Speed" value={geodeSpeed.toFixed(2)} min={0.03} max={0.15} step={0.01} current={geodeSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-geode-speed')} />
        <BrandSliderField id="shader-geode-sparkle" label="Crystal Sparkle" value={geodeSparkle.toFixed(2)} min={0.30} max={1.50} step={0.05} current={geodeSparkle} minLabel="Matte" maxLabel="Brilliant" oninput={handleSliderInput('shader-geode-sparkle')} />
      </section>
    {:else if activePreset === 'lenia'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Lenia</span>
        <BrandSliderField id="shader-lenia-radius" label="Creature Size" value={leniaRadius.toFixed(1)} min={8.0} max={20.0} step={0.5} current={leniaRadius} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-lenia-radius')} />
        <BrandSliderField id="shader-lenia-growth" label="Growth Target" value={leniaGrowth.toFixed(3)} min={0.10} max={0.20} step={0.005} current={leniaGrowth} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-lenia-growth')} />
        <BrandSliderField id="shader-lenia-width" label="Selectivity" value={leniaWidth.toFixed(3)} min={0.01} max={0.05} step={0.005} current={leniaWidth} minLabel="Sharp" maxLabel="Soft" oninput={handleSliderInput('shader-lenia-width')} />
        <BrandSliderField id="shader-lenia-speed" label="Sim Speed" value={String(Math.round(leniaSpeed))} min={1} max={4} step={1} current={leniaSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-lenia-speed')} />
        <BrandSliderField id="shader-lenia-dt" label="Timestep" value={leniaDt.toFixed(2)} min={0.1} max={0.5} step={0.05} current={leniaDt} minLabel="Smooth" maxLabel="Rapid" oninput={handleSliderInput('shader-lenia-dt')} />
      </section>
    {:else if activePreset === 'ocean'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Ocean</span>
        <BrandSliderField id="shader-ocean-caustic-scale" label="Caustic Scale" value={oceanCausticScale.toFixed(1)} min={1.0} max={4.0} step={0.5} current={oceanCausticScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-ocean-caustic-scale')} />
        <BrandSliderField id="shader-ocean-sand-scale" label="Sand Scale" value={oceanSandScale.toFixed(1)} min={1.0} max={5.0} step={0.5} current={oceanSandScale} minLabel="Smooth" maxLabel="Rough" oninput={handleSliderInput('shader-ocean-sand-scale')} />
        <BrandSliderField id="shader-ocean-speed" label="Animation Speed" value={oceanSpeed.toFixed(2)} min={0.05} max={0.25} step={0.01} current={oceanSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-ocean-speed')} />
        <BrandSliderField id="shader-ocean-shadow" label="Shadow Depth" value={oceanShadow.toFixed(2)} min={0.1} max={0.5} step={0.05} current={oceanShadow} minLabel="Subtle" maxLabel="Deep" oninput={handleSliderInput('shader-ocean-shadow')} />
        <BrandSliderField id="shader-ocean-ripple" label="Mouse Ripple" value={oceanRipple.toFixed(1)} min={0.5} max={2.0} step={0.1} current={oceanRipple} minLabel="Gentle" maxLabel="Strong" oninput={handleSliderInput('shader-ocean-ripple')} />
      </section>
    {:else if activePreset === 'bismuth'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Bismuth</span>
        <BrandSliderField id="shader-bismuth-terraces" label="Terrace Levels" value={String(Math.round(bismuthTerraces))} min={4} max={12} step={1} current={bismuthTerraces} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-bismuth-terraces')} />
        <BrandSliderField id="shader-bismuth-warp" label="Domain Warp" value={bismuthWarp.toFixed(2)} min={0.30} max={1.50} step={0.05} current={bismuthWarp} minLabel="Smooth" maxLabel="Warped" oninput={handleSliderInput('shader-bismuth-warp')} />
        <BrandSliderField id="shader-bismuth-iridescence" label="Iridescence" value={bismuthIridescence.toFixed(2)} min={0.30} max={1.50} step={0.05} current={bismuthIridescence} minLabel="Subtle" maxLabel="Vivid" oninput={handleSliderInput('shader-bismuth-iridescence')} />
        <BrandSliderField id="shader-bismuth-speed" label="Morph Speed" value={bismuthSpeed.toFixed(2)} min={0.03} max={0.15} step={0.01} current={bismuthSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-bismuth-speed')} />
        <BrandSliderField id="shader-bismuth-edge" label="Edge Glow" value={bismuthEdge.toFixed(2)} min={0.30} max={1.50} step={0.05} current={bismuthEdge} minLabel="Faint" maxLabel="Bright" oninput={handleSliderInput('shader-bismuth-edge')} />
      </section>
    {:else if activePreset === 'pearl'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Pearl</span>
        <BrandSliderField id="shader-pearl-displacement" label="Surface Displacement" value={pearlDisplacement.toFixed(2)} min={0.05} max={0.30} step={0.01} current={pearlDisplacement} minLabel="Smooth" maxLabel="Rough" oninput={handleSliderInput('shader-pearl-displacement')} />
        <BrandSliderField id="shader-pearl-speed" label="Animation Speed" value={pearlSpeed.toFixed(1)} min={0.3} max={1.5} step={0.1} current={pearlSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-pearl-speed')} />
        <BrandSliderField id="shader-pearl-fresnel" label="Iridescence Power" value={pearlFresnel.toFixed(1)} min={1.0} max={5.0} step={0.1} current={pearlFresnel} minLabel="Subtle" maxLabel="Strong" oninput={handleSliderInput('shader-pearl-fresnel')} />
        <BrandSliderField id="shader-pearl-specular" label="Specular Highlight" value={pearlSpecular.toFixed(2)} min={0.5} max={2.0} step={0.05} current={pearlSpecular} minLabel="Matte" maxLabel="Glossy" oninput={handleSliderInput('shader-pearl-specular')} />
      </section>
    {:else if activePreset === 'vortex'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Vortex</span>
        <BrandSliderField id="shader-vortex-speed" label="Rotation Speed" value={vortexSpeed.toFixed(2)} min={0.1} max={0.5} step={0.01} current={vortexSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-vortex-speed')} />
        <BrandSliderField id="shader-vortex-density" label="Ray Steps" value={String(Math.round(vortexDensity))} min={20} max={60} step={1} current={vortexDensity} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-vortex-density')} />
        <BrandSliderField id="shader-vortex-twist" label="Spiral Twist" value={vortexTwist.toFixed(1)} min={0.5} max={2.0} step={0.1} current={vortexTwist} minLabel="Loose" maxLabel="Tight" oninput={handleSliderInput('shader-vortex-twist')} />
        <BrandSliderField id="shader-vortex-rings" label="Ring Scale" value={vortexRings.toFixed(1)} min={0.5} max={2.0} step={0.1} current={vortexRings} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-vortex-rings')} />
        <BrandSliderField id="shader-vortex-spiral" label="Arm Brightness" value={vortexSpiral.toFixed(2)} min={0.3} max={1.0} step={0.05} current={vortexSpiral} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-vortex-spiral')} />
      </section>
    {:else if activePreset === 'gyroid'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Gyroid</span>
        <BrandSliderField id="shader-gyroid-scale1" label="Primary Frequency" value={gyroidScale1.toFixed(1)} min={3.0} max={8.0} step={0.1} current={gyroidScale1} minLabel="Coarse" maxLabel="Fine" oninput={handleSliderInput('shader-gyroid-scale1')} />
        <BrandSliderField id="shader-gyroid-scale2" label="Detail Frequency" value={gyroidScale2.toFixed(1)} min={8.0} max={15.0} step={0.1} current={gyroidScale2} minLabel="Sparse" maxLabel="Dense" oninput={handleSliderInput('shader-gyroid-scale2')} />
        <BrandSliderField id="shader-gyroid-speed" label="Animation Speed" value={gyroidSpeed.toFixed(2)} min={0.1} max={0.4} step={0.01} current={gyroidSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-gyroid-speed')} />
        <BrandSliderField id="shader-gyroid-density" label="Volume Density" value={gyroidDensity.toFixed(1)} min={1.0} max={5.0} step={0.1} current={gyroidDensity} minLabel="Faint" maxLabel="Thick" oninput={handleSliderInput('shader-gyroid-density')} />
        <BrandSliderField id="shader-gyroid-thickness" label="Surface Thickness" value={gyroidThickness.toFixed(3)} min={0.01} max={0.05} step={0.005} current={gyroidThickness} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-gyroid-thickness')} />
      </section>
    {:else if activePreset === 'waves'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Waves</span>
        <BrandSliderField id="shader-waves-height" label="Wave Height" value={wavesHeight.toFixed(1)} min={0.5} max={2.0} step={0.1} current={wavesHeight} minLabel="Flat" maxLabel="Tall" oninput={handleSliderInput('shader-waves-height')} />
        <BrandSliderField id="shader-waves-speed" label="Wave Speed" value={wavesSpeed.toFixed(1)} min={0.5} max={2.0} step={0.1} current={wavesSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-waves-speed')} />
        <BrandSliderField id="shader-waves-chop" label="Choppiness" value={wavesChop.toFixed(2)} min={0.3} max={1.0} step={0.05} current={wavesChop} minLabel="Smooth" maxLabel="Choppy" oninput={handleSliderInput('shader-waves-chop')} />
        <BrandSliderField id="shader-waves-foam" label="Foam Amount" value={wavesFoam.toFixed(2)} min={0.0} max={1.0} step={0.05} current={wavesFoam} minLabel="None" maxLabel="Heavy" oninput={handleSliderInput('shader-waves-foam')} />
        <BrandSliderField id="shader-waves-depth" label="Water Depth" value={wavesDepth.toFixed(2)} min={0.3} max={1.0} step={0.05} current={wavesDepth} minLabel="Murky" maxLabel="Clear" oninput={handleSliderInput('shader-waves-depth')} />
      </section>
    {:else if activePreset === 'clouds'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Clouds</span>
        <BrandSliderField id="shader-clouds-cover" label="Cloud Cover" value={cloudsCover.toFixed(2)} min={0.0} max={0.5} step={0.02} current={cloudsCover} minLabel="Clear" maxLabel="Overcast" oninput={handleSliderInput('shader-clouds-cover')} />
        <BrandSliderField id="shader-clouds-speed" label="Wind Speed" value={cloudsSpeed.toFixed(3)} min={0.01} max={0.06} step={0.005} current={cloudsSpeed} minLabel="Still" maxLabel="Breezy" oninput={handleSliderInput('shader-clouds-speed')} />
        <BrandSliderField id="shader-clouds-scale" label="Cloud Scale" value={cloudsScale.toFixed(1)} min={0.5} max={2.0} step={0.1} current={cloudsScale} minLabel="Small" maxLabel="Large" oninput={handleSliderInput('shader-clouds-scale')} />
        <BrandSliderField id="shader-clouds-dark" label="Shadow Depth" value={cloudsDark.toFixed(2)} min={0.2} max={0.8} step={0.05} current={cloudsDark} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-clouds-dark')} />
        <BrandSliderField id="shader-clouds-light" label="Highlight" value={cloudsLight.toFixed(2)} min={0.1} max={0.5} step={0.05} current={cloudsLight} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-clouds-light')} />
      </section>
    {:else if activePreset === 'fracture'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Fracture</span>
        <BrandSliderField id="shader-fracture-cuts" label="Subdivision Depth" value={String(Math.round(fractureCuts))} min={4} max={9} step={1} current={fractureCuts} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-fracture-cuts')} />
        <BrandSliderField id="shader-fracture-speed" label="Animation Speed" value={fractureSpeed.toFixed(2)} min={0.1} max={0.5} step={0.01} current={fractureSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-fracture-speed')} />
        <BrandSliderField id="shader-fracture-border" label="Edge Width" value={fractureBorder.toFixed(3)} min={0.005} max={0.020} step={0.001} current={fractureBorder} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-fracture-border')} />
        <BrandSliderField id="shader-fracture-shadow" label="Shadow Depth" value={fractureShadow.toFixed(2)} min={0.02} max={0.10} step={0.01} current={fractureShadow} minLabel="Flat" maxLabel="Deep" oninput={handleSliderInput('shader-fracture-shadow')} />
        <BrandSliderField id="shader-fracture-fill" label="Fill Opacity" value={fractureFill.toFixed(2)} min={0.5} max={1.0} step={0.05} current={fractureFill} minLabel="Faded" maxLabel="Solid" oninput={handleSliderInput('shader-fracture-fill')} />
      </section>
    {:else if activePreset === 'julia'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Julia</span>
        <BrandSliderField id="shader-julia-zoom" label="Zoom Level" value={juliaZoom.toFixed(1)} min={1.0} max={2.0} step={0.1} current={juliaZoom} minLabel="Close" maxLabel="Far" oninput={handleSliderInput('shader-julia-zoom')} />
        <BrandSliderField id="shader-julia-speed" label="Orbit Speed" value={juliaSpeed.toFixed(2)} min={0.2} max={0.6} step={0.01} current={juliaSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-julia-speed')} />
        <BrandSliderField id="shader-julia-iterations" label="Detail" value={String(Math.round(juliaIterations))} min={30} max={100} step={5} current={juliaIterations} minLabel="Smooth" maxLabel="Sharp" oninput={handleSliderInput('shader-julia-iterations')} />
        <BrandSliderField id="shader-julia-radius" label="Orbit Radius" value={juliaRadius.toFixed(2)} min={0.60} max={0.95} step={0.01} current={juliaRadius} minLabel="Tight" maxLabel="Wide" oninput={handleSliderInput('shader-julia-radius')} />
        <BrandSliderField id="shader-julia-saturation" label="Palette Intensity" value={juliaSaturation.toFixed(2)} min={0.30} max={0.70} step={0.05} current={juliaSaturation} minLabel="Muted" maxLabel="Vivid" oninput={handleSliderInput('shader-julia-saturation')} />
      </section>
    {:else if activePreset === 'vapor'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Vapor</span>
        <BrandSliderField id="shader-vapor-density" label="Cloud Density" value={vaporDensity.toFixed(2)} min={0.50} max={2.00} step={0.10} current={vaporDensity} minLabel="Thin" maxLabel="Thick" oninput={handleSliderInput('shader-vapor-density')} />
        <BrandSliderField id="shader-vapor-speed" label="Animation Speed" value={vaporSpeed.toFixed(1)} min={0.5} max={2.5} step={0.1} current={vaporSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-vapor-speed')} />
        <BrandSliderField id="shader-vapor-scale" label="Cloud Scale" value={vaporScale.toFixed(1)} min={3.0} max={8.0} step={0.5} current={vaporScale} minLabel="Fine" maxLabel="Coarse" oninput={handleSliderInput('shader-vapor-scale')} />
        <BrandSliderField id="shader-vapor-warmth" label="Warmth" value={vaporWarmth.toFixed(2)} min={0.00} max={1.00} step={0.05} current={vaporWarmth} minLabel="Cool" maxLabel="Warm" oninput={handleSliderInput('shader-vapor-warmth')} />
        <BrandSliderField id="shader-vapor-glow" label="Glow Intensity" value={vaporGlow.toFixed(2)} min={0.30} max={1.50} step={0.10} current={vaporGlow} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-vapor-glow')} />
      </section>
    {:else if activePreset === 'tunnel'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Tunnel</span>
        <BrandSliderField id="shader-tunnel-speed" label="Flight Speed" value={tunnelSpeed.toFixed(1)} min={1.0} max={4.0} step={0.5} current={tunnelSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-tunnel-speed')} />
        <BrandSliderField id="shader-tunnel-fractal" label="Fractal Detail" value={String(Math.round(tunnelFractal))} min={4} max={8} step={1} current={tunnelFractal} minLabel="Simple" maxLabel="Complex" oninput={handleSliderInput('shader-tunnel-fractal')} />
        <BrandSliderField id="shader-tunnel-radius" label="Tunnel Width" value={tunnelRadius.toFixed(1)} min={1.0} max={3.0} step={0.5} current={tunnelRadius} minLabel="Narrow" maxLabel="Wide" oninput={handleSliderInput('shader-tunnel-radius')} />
        <BrandSliderField id="shader-tunnel-brightness" label="Brightness" value={tunnelBrightness.toFixed(2)} min={0.50} max={2.00} step={0.10} current={tunnelBrightness} minLabel="Dim" maxLabel="Bright" oninput={handleSliderInput('shader-tunnel-brightness')} />
        <BrandSliderField id="shader-tunnel-twist" label="Path Curvature" value={tunnelTwist.toFixed(2)} min={0.03} max={0.10} step={0.01} current={tunnelTwist} minLabel="Gentle" maxLabel="Winding" oninput={handleSliderInput('shader-tunnel-twist')} />
      </section>
    {:else if activePreset === 'plasma'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Plasma</span>
        <BrandSliderField id="shader-plasma-speed" label="Flow Speed" value={plasmaSpeed.toFixed(2)} min={0.20} max={2.00} step={0.10} current={plasmaSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-plasma-speed')} />
        <BrandSliderField id="shader-plasma-bands" label="Color Bands" value={plasmaBands.toFixed(1)} min={5.0} max={40.0} step={1.0} current={plasmaBands} minLabel="Few" maxLabel="Many" oninput={handleSliderInput('shader-plasma-bands')} />
        <BrandSliderField id="shader-plasma-pressure" label="Pressure" value={plasmaPressure.toFixed(2)} min={0.20} max={2.00} step={0.10} current={plasmaPressure} minLabel="Soft" maxLabel="Strong" oninput={handleSliderInput('shader-plasma-pressure')} />
        <BrandSliderField id="shader-plasma-turn" label="Slime Turn" value={plasmaTurn.toFixed(2)} min={0.02} max={0.25} step={0.01} current={plasmaTurn} minLabel="Gentle" maxLabel="Sharp" oninput={handleSliderInput('shader-plasma-turn')} />
        <BrandSliderField id="shader-plasma-diffusion" label="Diffusion" value={plasmaDiffusion.toFixed(2)} min={0.50} max={2.00} step={0.10} current={plasmaDiffusion} minLabel="Tight" maxLabel="Spread" oninput={handleSliderInput('shader-plasma-diffusion')} />
      </section>
    {:else if activePreset === 'spore'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Spore</span>
        <BrandSliderField id="shader-spore-sensor-angle" label="Sensor Angle" value={sporeSensorAngle.toFixed(1)} min={5.0} max={45.0} step={0.5} current={sporeSensorAngle} minLabel="Narrow" maxLabel="Wide" oninput={handleSliderInput('shader-spore-sensor-angle')} />
        <BrandSliderField id="shader-spore-sensor-offset" label="Sensor Reach" value={sporeSensorOffset.toFixed(1)} min={1.0} max={8.0} step={0.5} current={sporeSensorOffset} minLabel="Close" maxLabel="Far" oninput={handleSliderInput('shader-spore-sensor-offset')} />
        <BrandSliderField id="shader-spore-step-size" label="Step Size" value={sporeStepSize.toFixed(1)} min={2.0} max={12.0} step={0.5} current={sporeStepSize} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-spore-step-size')} />
        <BrandSliderField id="shader-spore-rotation" label="Turn Amount" value={sporeRotation.toFixed(1)} min={5.0} max={45.0} step={0.5} current={sporeRotation} minLabel="Gentle" maxLabel="Sharp" oninput={handleSliderInput('shader-spore-rotation')} />
        <BrandSliderField id="shader-spore-decay" label="Trail Decay" value={sporeDecay.toFixed(3)} min={0.990} max={0.999} step={0.001} current={sporeDecay} minLabel="Fast" maxLabel="Slow" oninput={handleSliderInput('shader-spore-decay')} />
      </section>
    {:else if activePreset === 'flow'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Flow</span>
        <BrandSliderField id="shader-flow-curl" label="Curl Strength" value={flowCurl.toFixed(2)} min={0.10} max={1.50} step={0.05} current={flowCurl} minLabel="Gentle" maxLabel="Tight" oninput={handleSliderInput('shader-flow-curl')} />
        <BrandSliderField id="shader-flow-advection" label="Advection" value={flowAdvection.toFixed(1)} min={1.0} max={12.0} step={0.5} current={flowAdvection} minLabel="Short" maxLabel="Long" oninput={handleSliderInput('shader-flow-advection')} />
        <BrandSliderField id="shader-flow-smoothing" label="Smoothing" value={flowSmoothing.toFixed(2)} min={0.30} max={0.95} step={0.05} current={flowSmoothing} minLabel="Crisp" maxLabel="Smooth" oninput={handleSliderInput('shader-flow-smoothing')} />
        <BrandSliderField id="shader-flow-contrast" label="Contrast" value={flowContrast.toFixed(1)} min={4.0} max={20.0} step={1.0} current={flowContrast} minLabel="Soft" maxLabel="Punchy" oninput={handleSliderInput('shader-flow-contrast')} />
        <BrandSliderField id="shader-flow-field-speed" label="Field Speed" value={flowFieldSpeed.toFixed(2)} min={0.20} max={2.00} step={0.10} current={flowFieldSpeed} minLabel="Slow" maxLabel="Fast" oninput={handleSliderInput('shader-flow-field-speed')} />
      </section>
    {/if}
  {/if}
</div>

<style>
  .hero-fx {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .hero-fx__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-fx__section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Preset Grid ──────────────────────────────── */

  .hero-fx__preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .hero-fx__preset-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .hero-fx__preset-card:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .hero-fx__preset-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero-fx__preset-card--active {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .hero-fx__preset-card--active:hover {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .hero-fx__preset-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .hero-fx__preset-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-tight);
  }

  .hero-fx__preset-card--active .hero-fx__preset-label {
    color: var(--color-interactive);
  }

  /* ── Color Picker Row ──────────────────────────── */

  .hero-fx__color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
  }

  .hero-fx__color-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-fx__color-input {
    width: var(--space-10);
    height: var(--space-8);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-0-5);
    cursor: pointer;
    background: transparent;
  }

  .hero-fx__color-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero-fx__color-input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .hero-fx__color-input::-webkit-color-swatch {
    border: none;
    border-radius: var(--radius-sm);
  }

  .hero-fx__color-input::-moz-color-swatch {
    border: none;
    border-radius: var(--radius-sm);
  }

  /* ── Toggle Switch ───────────────────────────── */

  .hero-fx__toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
  }

  .hero-fx__toggle-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-fx__toggle {
    position: relative;
    width: var(--space-10);
    height: var(--space-5);
    background: var(--color-surface-tertiary);
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background var(--duration-normal) var(--ease-default);
    padding: 0;
  }

  .hero-fx__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero-fx__toggle--on {
    background: var(--color-interactive);
  }

  .hero-fx__toggle-thumb {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-0-5);
    width: var(--space-4);
    height: var(--space-4);
    background: var(--color-text-inverse);
    border-radius: var(--radius-full);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .hero-fx__toggle--on .hero-fx__toggle-thumb {
    transform: translateX(var(--space-5));
  }
</style>
