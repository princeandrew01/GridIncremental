import Decimal from 'break_infinity.js'
import type { Cell, CellType, Facing, GameState, UpgradeLevels } from './types'
import { makeEmptyUpgradeLevels } from './types'
import { MAX_LEVEL } from './config'

export const SAVE_VERSION = 5

const TYPE_TO_INDEX: Record<CellType, number> = { empty: 0, basic: 1, leech: 2, buffV1: 3, buffV2: 4 }
const INDEX_TO_TYPE: CellType[] = ['empty', 'basic', 'leech', 'buffV1', 'buffV2']

interface SaveCell {
  t: number // type index
  l: number // level
  b: string // buffAccum, Decimal serialised as string
  f: Facing // facing; meaningless except on buffV1, but always present - cheap and keeps the shape uniform
  p: string // placementCost, Decimal serialised as string - added in version 3, see migrate() below
}

export interface SaveData {
  version: number
  width: number
  height: number
  cells: SaveCell[]
  currency: string // Decimal serialised as string, never as an object
  tickCount: number
  lastSaved: number

  // Added in version 2, alongside the lifetime-stats/achievements tracking -
  // see GameState. migrate() below backfills these for older saves.
  startedAt: number
  prestigeStartedAt: number
  activePlayMs: number
  lifetimeCurrencyEarned: string
  totalGeneratorsBuilt: number
  totalUpgrades: number
  highestValue: { basic: string; leech: string }
  highestBuffLevel: number
  unlockedAchievements: string[]

  // Added in version 4, alongside the Upgrades tab and the buff v1/v2 split -
  // see GameState. migrate() below backfills these for older saves.
  upgrades: UpgradeLevels
}

/** Pure: GameState -> SaveData. Never touches storage. */
export function serialize(state: GameState): SaveData {
  return {
    version: SAVE_VERSION,
    width: state.width,
    height: state.height,
    cells: state.cells.map((cell) => ({
      t: TYPE_TO_INDEX[cell.type],
      l: cell.level,
      b: cell.buffAccum.toString(),
      f: cell.facing,
      p: cell.placementCost.toString(),
    })),
    currency: state.currency.toString(),
    tickCount: state.tickCount,
    lastSaved: state.lastSaved,
    startedAt: state.startedAt,
    prestigeStartedAt: state.prestigeStartedAt,
    activePlayMs: state.activePlayMs,
    lifetimeCurrencyEarned: state.lifetimeCurrencyEarned.toString(),
    totalGeneratorsBuilt: state.totalGeneratorsBuilt,
    totalUpgrades: state.totalUpgrades,
    highestValue: { basic: state.highestValue.basic.toString(), leech: state.highestValue.leech.toString() },
    highestBuffLevel: state.highestBuffLevel,
    unlockedAchievements: state.unlockedAchievements,
    upgrades: { ...state.upgrades },
  }
}

/**
 * Applies version migrations in sequence, oldest first. Each bump adds one
 * more `if (save.version < N) { ... }` step; never touch old steps once
 * written (spec §8 - versioning from day one is what makes this safe).
 */
export function migrate(save: SaveData): SaveData {
  if (save.version < 2) {
    // v1 predates lifetime-stats tracking entirely. None of this history is
    // truly recoverable, so backfill with the best available guess for each
    // field - see the callers in main.ts, which immediately recompute
    // highestValue/highestBuffLevel and re-check achievements against a
    // freshly-recalculated board right after load, so the '0' placeholders
    // below self-heal on the very first render rather than sitting wrong.
    save = {
      ...save,
      version: 2,
      startedAt: save.lastSaved,
      prestigeStartedAt: save.lastSaved,
      activePlayMs: 0,
      lifetimeCurrencyEarned: save.currency,
      totalGeneratorsBuilt: save.cells.filter((c) => c.t !== 0).length,
      totalUpgrades: 0,
      highestValue: { basic: '0', leech: '0' },
      highestBuffLevel: 0,
      unlockedAchievements: [],
    }
  }
  if (save.version < 3) {
    // v2 predates per-cell placementCost tracking (needed for the Remove
    // refund). What was actually paid for a pre-existing generator isn't
    // recoverable, and unlike the v1->v2 stats backfill there's no later
    // self-heal pass for this one - so this defaults to '0' deliberately,
    // the conservative choice: removing a pre-migration generator gives no
    // refund, rather than guessing a value a player could exploit.
    save = {
      ...save,
      version: 3,
      cells: save.cells.map((c) => ({ ...c, p: c.p ?? '0' })),
    }
  }
  if (save.version < 4) {
    // v3 predates Alpha 0.2's rebalance: levels went from 1-based to 0-based,
    // per-type max levels shrank (Basic 10 -> 5, Leech 3 -> 2, Buff 5 -> 2),
    // and Buff split into buffV1/buffV2 (buffV1 keeps index 3, so an old
    // `buff` cell already deserializes as buffV1 for free via
    // INDEX_TO_TYPE - only the level needs rebasing). Decided with the user:
    // clamp and carry over, not wipe or compensate - a maxed Basic loses the
    // flat value its old levels used to grant (that growth moved into the
    // new Basic Generator Value upgrade, which starts at 0 and can't
    // retroactively backfill what old levels already paid for).
    const maxLevelByIndex = [0, MAX_LEVEL.basic, MAX_LEVEL.leech, MAX_LEVEL.buffV1, MAX_LEVEL.buffV2]
    save = {
      ...save,
      version: 4,
      cells: save.cells.map((c) => ({
        ...c,
        l: Math.max(0, Math.min(c.l - 1, maxLevelByIndex[c.t] ?? 0)),
      })),
      upgrades: makeEmptyUpgradeLevels(),
      highestBuffLevel: Math.max(0, save.highestBuffLevel - 1),
    }
  }
  if (save.version < 5) {
    // v4 predates the Grid Size upgrade - its `upgrades` object exists but
    // is missing the `gridSize` key entirely (not just zero - genuinely
    // absent, since the shape itself grew a new field). Merging over
    // defaults backfills it to 0 without disturbing any level the player
    // already bought in the other 6. The board's existing width/height carry
    // over untouched, whatever they were - resizeGrid() only ever grows, so
    // buying Grid Size levels later can't shrink a board that's already
    // bigger than gridSizeForLevel(0) (3x3).
    save = {
      ...save,
      version: 5,
      upgrades: { ...makeEmptyUpgradeLevels(), ...save.upgrades },
    }
  }
  return save
}

/** Pure: SaveData -> GameState. Migrates first, so callers never see a stale shape. */
export function deserialize(rawSave: SaveData): GameState {
  const save = migrate(rawSave)
  const cells: Cell[] = save.cells.map((c) => ({
    type: INDEX_TO_TYPE[c.t] ?? 'empty',
    level: c.l,
    buffAccum: new Decimal(c.b),
    facing: c.f ?? 'up',
    placementCost: new Decimal(c.p ?? '0'),
  }))
  return {
    version: save.version,
    width: save.width,
    height: save.height,
    cells,
    currency: new Decimal(save.currency),
    tickCount: save.tickCount,
    lastSaved: save.lastSaved,
    upgrades: save.upgrades ?? makeEmptyUpgradeLevels(),
    startedAt: save.startedAt,
    prestigeStartedAt: save.prestigeStartedAt,
    activePlayMs: save.activePlayMs,
    lifetimeCurrencyEarned: new Decimal(save.lifetimeCurrencyEarned),
    totalGeneratorsBuilt: save.totalGeneratorsBuilt,
    totalUpgrades: save.totalUpgrades,
    highestValue: { basic: new Decimal(save.highestValue.basic), leech: new Decimal(save.highestValue.leech) },
    highestBuffLevel: save.highestBuffLevel,
    unlockedAchievements: save.unlockedAchievements,
  }
}

// --- base64 export/import ---
// TextEncoder/TextDecoder + btoa/atob, rather than the classic
// escape/unescape trick, since both are non-deprecated and available in
// both browsers and this Node version (used by tests).

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Decode(b64: string): string {
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Stamps lastSaved to now, then serialises. Shared by every real save path (local storage, export). */
function stampAndSerialize(state: GameState): SaveData {
  state.lastSaved = Date.now()
  return serialize(state)
}

export function exportSave(state: GameState): string {
  return base64Encode(JSON.stringify(stampAndSerialize(state)))
}

/** Throws if `text` isn't a valid save - callers should catch and report, not crash. */
export function importSave(text: string): GameState {
  const json = base64Decode(text)
  const data = JSON.parse(json) as SaveData
  return deserialize(data)
}

// --- localStorage ---
// Wrapped in try/catch throughout: throws in private browsing, and is
// unavailable entirely in some third-party iframe contexts (e.g. itch.io) -
// export/import above is the fallback for exactly that case (spec §8).

const STORAGE_KEY = 'grid-incremental-save'

export function saveToLocalStorage(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stampAndSerialize(state)))
  } catch {
    // Nothing we can do here; the player still has export as a fallback.
  }
}

export function loadFromLocalStorage(): GameState | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (!json) return null
    return deserialize(JSON.parse(json) as SaveData)
  } catch {
    return null
  }
}
