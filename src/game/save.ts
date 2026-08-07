import Decimal from 'break_infinity.js'
import type { Cell, CellType, Facing, GameState, UpgradeLevels, PowerCoreUpgradeLevels } from './types'
import { makeEmptyUpgradeLevels, makeEmptyPowerCoreUpgradeLevels } from './types'
import { powerCoreGeneratorPeriod } from './engine'

export const SAVE_VERSION = 7

// Index 3 was `buffV1` pre-Alpha-0.31 - same index, now deserializes
// straight to the unified `buff` type for free, no per-cell migration
// needed for the rename itself. Index 4 was `buffV2`, removed this pass -
// retired, not reassigned to anything: any leftover index-4 cell just
// becomes 'empty' via INDEX_TO_TYPE below (see migrate()'s v6->v7 step for
// why that's the right call, not silently reusing the slot for a new type).
const TYPE_TO_INDEX: Record<CellType, number> = {
  empty: 0,
  basic: 1,
  leech: 2,
  buff: 3,
  powerCoreGenerator: 5,
  buffStacker: 6,
  buffAll: 7,
  basicCrit: 8,
  basicSteady: 9,
}
const INDEX_TO_TYPE: CellType[] = ['empty', 'basic', 'leech', 'buff', 'empty', 'powerCoreGenerator', 'buffStacker', 'buffAll', 'basicCrit', 'basicSteady']

interface SaveCell {
  t: number // type index
  l: number // level
  f: Facing // facing; meaningless except on buff/buffStacker, but always present - cheap and keeps the shape uniform
  p: string // placementCost, Decimal serialised as string
  cp: number // coreProgress; meaningless except on powerCoreGenerator
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

  // Added in version 6, alongside Power Cores - see GameState. migrate()
  // below backfills these for older saves.
  powerCores: string
  powerCoreUpgrades: PowerCoreUpgradeLevels
  currentRunEnergyEarned: string
  bestRunEnergyEarned: string

  // Added in version 7, alongside the "???"-until-affordable discovery
  // mechanic - see GameState.discoveredTypes. migrate() below backfills
  // this for older saves (anything already on the board must have been
  // affordable at some point).
  discoveredTypes: Partial<Record<string, true>>
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
      f: cell.facing,
      p: cell.placementCost.toString(),
      cp: cell.coreProgress,
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
    powerCores: state.powerCores.toString(),
    powerCoreUpgrades: { ...state.powerCoreUpgrades },
    currentRunEnergyEarned: state.currentRunEnergyEarned.toString(),
    bestRunEnergyEarned: state.bestRunEnergyEarned.toString(),
    discoveredTypes: { ...state.discoveredTypes },
  }
}

/**
 * Applies version migrations in sequence, oldest first. Each bump adds one
 * more `if (save.version < N) { ... }` step; never touch old steps once
 * written (spec §8 - versioning from day one is what makes this safe) -
 * with one exception forced by this pass, noted right where it happens.
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
    // `buff` cell already deserializes as buffV1 - now `buff` again - for
    // free via INDEX_TO_TYPE - only the level needs rebasing). Decided with
    // the user: clamp and carry over, not wipe or compensate.
    //
    // These four numbers are hard-coded on purpose, NOT read from the live
    // MAX_LEVEL config - they're what Alpha 0.2's max levels *were*, a
    // historical fact this step has to keep reproducing exactly, forever,
    // regardless of how MAX_LEVEL keeps changing in later passes (it
    // already has twice since - Alpha 0.31 raised Basic to 10 and folded
    // buffV1/buffV2 into a single `buff` at 9). Reading `MAX_LEVEL.basic`
    // etc. here directly was a latent bug: it silently drifted from "the
    // v4 rebase's real max" to "whatever max level happens to be today,"
    // and as of this pass `MAX_LEVEL.buffV1`/`.buffV2` don't exist at all
    // anymore - `maxLevelByIndex[3]`/`[4]` would both be `undefined`,
    // making `Math.min(c.l - 1, undefined)` produce `NaN` for any surviving
    // pre-Alpha-0.2 save. Fixed here, not left for the next person to hit.
    const maxLevelByIndex = [0, 5, 2, 2, 4] // basic, leech, buffV1, buffV2 - Alpha 0.2's actual values
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
  if (save.version < 6) {
    // v5 predates Power Cores entirely - no power-core fields exist at all,
    // and cells have no `cp` (coreProgress). A fresh start on all of it: 0
    // power cores, every power-core upgrade at level 0, no energy threshold
    // crossed yet. currentRunEnergyEarned backfills from
    // lifetimeCurrencyEarned - the same "best available guess" approach the
    // v1->v2 stats backfill used - rather than 0, so a long-running save
    // doesn't have to re-earn energy it's already past.
    //
    // Note: the `powerCoreExponentsAwarded` field this step originally
    // backfilled to 0 no longer exists on GameState as of Alpha 0.31 (see
    // the v6->v7 step below) - not carried forward, simply dropped once
    // deserialize() builds the real GameState. Keeping the field name here
    // for this step's own SaveData shape at the time is harmless; nothing
    // downstream reads it anymore.
    save = {
      ...save,
      version: 6,
      cells: save.cells.map((c) => ({ ...c, cp: c.cp ?? 0 })),
      powerCores: '0',
      powerCoreUpgrades: makeEmptyPowerCoreUpgradeLevels(),
      currentRunEnergyEarned: save.lifetimeCurrencyEarned,
      bestRunEnergyEarned: save.lifetimeCurrencyEarned,
    }
  }
  if (save.version < 7) {
    // v6 predates Alpha 0.31's full rework: Basic/Buff evolutions, the new
    // live-percentage Buff mechanic, and the Power Core system rebuild.
    // Several independent changes bundle into this one step:
    //
    // - Cell types: index 3 (was buffV1) already deserializes as the
    //   unified `buff` type for free via INDEX_TO_TYPE - no per-cell action
    //   needed. Index 4 (was buffV2) is retired and maps straight to
    //   'empty' now, so any old buffV2 cell just becomes empty on load, also
    //   with no explicit conversion needed here. Every other type's level
    //   range only ever grew this pass (Basic 0-5 -> 0-10, buffV1 0-2 ->
    //   Buff 0-9, everything else unchanged), so no level clamping is
    //   needed - old values already fit the new ranges.
    //
    // - Power Core Generator cells: a pre-existing generator's real (Power-
    //   Core-denominated, pre-0.31 pricing) placementCost is zeroed out
    //   here rather than converted - there's no principled way to translate
    //   an old Power-Core cost into the new Energy-priced placement curve
    //   (see economy.ts placementCost), so 0 is the safe, conservative
    //   choice: removeCell's "always refund Energy" logic then just gives
    //   no refund for that specific legacy cell, rather than wrongly
    //   refunding Energy using a number that was actually paid in Power
    //   Cores. No refund is invented for the "lost" old cost, consistent
    //   with this file's established precedent (see the v2->v3 step) of not
    //   backfilling a refund for value that predates the mechanic tracking
    //   it. Every generator placed AFTER loading gets a real placementCost
    //   again as normal, via placeCell. coreProgress is also wrapped into
    //   whatever the new (possibly shorter) period for that level is, in
    //   case it no longer fits.
    //
    // - `upgrades.powerGeneratorCount` backfills to 0 (genuinely new key,
    //   same merge-over-defaults pattern as v4->v5's gridSize backfill) -
    //   the Power Core Generator stays locked until bought for real.
    //
    // - `powerCoreUpgrades` is rebuilt for the new 5-id shape. Grid Size
    //   carries over unchanged (the one upgrade that survived this pass
    //   untouched); every other old level (reduction/amount/chance/unlock/
    //   tickSpeed/basicValue/critChance/critAmount) has no equivalent
    //   anymore and is simply dropped - none of those upgrades exist to
    //   refund either.
    //
    // - `discoveredTypes` backfills generously: any placeable type already
    //   built somewhere on the board must have been affordable at some
    //   point, so it starts pre-discovered; nothing else is assumed
    //   discovered.
    //
    // - `powerCores` balance carries over unchanged - no reason to wipe a
    //   real, already-earned balance just because how it's earned changed.
    //
    // - `powerCoreExponentsAwarded` is simply dropped (the mechanic it
    //   tracked no longer exists - see deserialize(), which never reads it
    //   anymore); `currentRunEnergyEarned`/`bestRunEnergyEarned` carry over
    //   unchanged, kept as plain Stats-tab numbers for a future prestige.
    const discoveredTypes: Partial<Record<string, true>> = {}
    for (const c of save.cells) {
      if (c.t === 1) discoveredTypes.basic = true
      else if (c.t === 2) discoveredTypes.leech = true
      else if (c.t === 3) discoveredTypes.buff = true
      else if (c.t === 5) discoveredTypes.powerCoreGenerator = true
    }
    save = {
      ...save,
      version: 7,
      cells: save.cells.map((c) => {
        if (c.t !== 5) return c
        const period = powerCoreGeneratorPeriod(c.l)
        return { ...c, p: '0', cp: (c.cp ?? 0) % period }
      }),
      upgrades: { ...makeEmptyUpgradeLevels(), ...save.upgrades },
      powerCoreUpgrades: { ...makeEmptyPowerCoreUpgradeLevels(), gridSize: save.powerCoreUpgrades?.gridSize ?? 0 },
      discoveredTypes,
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
    facing: c.f ?? 'up',
    placementCost: new Decimal(c.p ?? '0'),
    coreProgress: c.cp ?? 0,
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
    powerCores: new Decimal(save.powerCores ?? '0'),
    powerCoreUpgrades: save.powerCoreUpgrades ?? makeEmptyPowerCoreUpgradeLevels(),
    currentRunEnergyEarned: new Decimal(save.currentRunEnergyEarned ?? '0'),
    bestRunEnergyEarned: new Decimal(save.bestRunEnergyEarned ?? '0'),
    discoveredTypes: save.discoveredTypes ?? {},
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
