import { browser } from '$app/environment';

const STORAGE_KEY = 'codex-player-prefs';

interface PlayerPreferences {
  volume: number;
  muted: boolean;
  playbackRate: number;
}

const DEFAULTS: PlayerPreferences = {
  volume: 1,
  muted: false,
  playbackRate: 1,
};

export function loadPlayerPreferences(): PlayerPreferences {
  if (!browser) return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      volume:
        typeof parsed.volume === 'number'
          ? Math.max(0, Math.min(1, parsed.volume))
          : DEFAULTS.volume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      playbackRate:
        typeof parsed.playbackRate === 'number'
          ? parsed.playbackRate
          : DEFAULTS.playbackRate,
    };
  } catch {
    return DEFAULTS;
  }
}

export function savePlayerPreferences(prefs: Partial<PlayerPreferences>): void {
  if (!browser) return;
  try {
    const current = loadPlayerPreferences();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...prefs }));
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}
