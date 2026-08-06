import type { NumberFormatMode } from './format'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  numberFormat: NumberFormatMode
  volume: number // 0-100; inert for now, no audio system yet - persisted for when one exists
  theme: ThemeMode // 'system' follows the OS/browser preference, same as the default look before this setting existed
  // Whether the Build tab's per-type descriptions show inline (see
  // ui/panel.ts) - the user found them "super long" once they became
  // always-visible list rows instead of hover-only tooltips. Defaults to
  // true (unchanged look for anyone who hasn't touched this) - unchecking
  // it doesn't remove the text, just moves it back to the hover tooltip.
  showBuildDescriptions: boolean
}

export const DEFAULT_SETTINGS: Settings = { numberFormat: 'scientific', volume: 50, theme: 'system', showBuildDescriptions: true }

// A separate localStorage key from the game save: this is a device
// preference, not game progress, so it doesn't belong in the save blob and
// shouldn't be wiped by Import or travel with an exported save.
const SETTINGS_STORAGE_KEY = 'grid-incremental-settings'

const VALID_THEMES: ThemeMode[] = ['system', 'light', 'dark']

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return DEFAULT_SETTINGS.volume
  return Math.min(100, Math.max(0, v))
}

/** Merges with DEFAULT_SETTINGS so a partial/older stored shape still loads sensibly. */
export function loadSettings(): Settings {
  try {
    const json = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!json) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(json) as Partial<Settings>
    return {
      numberFormat: parsed.numberFormat ?? DEFAULT_SETTINGS.numberFormat,
      volume: typeof parsed.volume === 'number' ? clampVolume(parsed.volume) : DEFAULT_SETTINGS.volume,
      theme: parsed.theme && VALID_THEMES.includes(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
      showBuildDescriptions: typeof parsed.showBuildDescriptions === 'boolean' ? parsed.showBuildDescriptions : DEFAULT_SETTINGS.showBuildDescriptions,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Nothing we can do here; the setting just won't survive a reload.
  }
}

/**
 * Applies the theme to the document. Because the stylesheet is already built
 * entirely on the `canvas`/`canvastext` system-color keywords (so it already
 * follows `prefers-color-scheme` for free), forcing a specific scheme here is
 * all that's needed - every existing color-mix()/system-color rule in
 * style.css picks it up automatically, no separate light/dark rule sets.
 */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme
}
