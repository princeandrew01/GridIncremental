import Decimal from 'break_infinity.js'

export type CellType =
  | 'empty'
  | 'basic'
  | 'leech'
  | 'buff'
  | 'buffStacker'
  | 'buffAll'
  | 'basicCrit'
  | 'basicSteady'
  | 'powerCoreGenerator'

// `facing` records which side a directional cell currently targets,
// rotatable in place by the player. Used by `buff` (targets 1 adjacent
// cell) and `buffStacker` (same - it just also special-cases what happens
// when that target is itself a buff-type cell, see engine.ts). Meaningless
// on `buffAll` (always whole-board, no target), the two Basic evolutions
// (`basicCrit`/`basicSteady` - private per-cell bonuses, nothing to aim),
// `powerCoreGenerator`, and everything else.
export type Facing = 'up' | 'down' | 'left' | 'right'

// Account-wide upgrade levels, purchased from the Upgrades tab - distinct
// from a Cell's own `level`, which is per-placement. See game/upgrades.ts for
// what each one does and its cost curve; kept here (not upgrades.ts) so
// types.ts has no dependency on it and stays the foundational, dependency-
// free module every other game/* file can safely import.
export type UpgradeId =
  | 'tickSpeed'
  | 'basicValue'
  | 'generatorValuePct'
  | 'critChance'
  | 'critAmount'
  | 'removalRefund'
  | 'gridSize'
  | 'powerGeneratorCount'

export type UpgradeLevels = Record<UpgradeId, number>

export function makeEmptyUpgradeLevels(): UpgradeLevels {
  return {
    tickSpeed: 0,
    basicValue: 0,
    generatorValuePct: 0,
    critChance: 0,
    critAmount: 0,
    removalRefund: 0,
    gridSize: 0,
    powerGeneratorCount: 0,
  }
}

// The Power Core Menu's upgrade track - a fully separate currency/counter
// from the energy UpgradeLevels above, purchased with power cores (see
// game/powerCoreUpgrades.ts). As of Alpha 0.31 this is down to 5 ids: Grid
// Size (the one survivor that still combines with its energy counterpart -
// see game/upgrades.ts totalGridSizeLevel) plus 4 independent build-count
// caps, one per evolution type, each capping how many of that evolved
// tower can exist on the board at once (see game/economy.ts canEvolve).
export type PowerCoreUpgradeId = 'gridSize' | 'critTowerSlots' | 'basicSteadySlots' | 'buffStackerSlots' | 'buffAllSlots'

export type PowerCoreUpgradeLevels = Record<PowerCoreUpgradeId, number>

export function makeEmptyPowerCoreUpgradeLevels(): PowerCoreUpgradeLevels {
  return {
    gridSize: 0,
    critTowerSlots: 0,
    basicSteadySlots: 0,
    buffStackerSlots: 0,
    buffAllSlots: 0,
  }
}

export interface Cell {
  type: CellType
  // basic 0-10, leech 0-2, buff 0-9, powerCoreGenerator 0-4; always 0 for
  // buffStacker/buffAll/basicCrit/basicSteady - evolved cells don't level
  // further (for now - see _working/ALPHA_0.31_CHANGES.md "Deferred").
  // Meaningless when type is 'empty'.
  level: number
  facing: Facing // buff/buffStacker only; meaningless otherwise
  // The cost actually paid to place this generator - stored per-cell since
  // placement cost escalates with how many of that type are already on the
  // board, so it can't be recomputed later. Powers the Remove refund
  // (economy.ts), which also reads the account-wide Removal Refund upgrade;
  // meaningless when type is 'empty'. An evolved cell inherits whatever its
  // pre-evolution self already had here - evolving doesn't re-place it.
  placementCost: Decimal
  // powerCoreGenerator only: ticks accumulated since its last core, 0 to
  // (period - 1) where period = 5 - level (see config.ts). Production is
  // discrete (a proc every `period` ticks), not continuous like a Basic -
  // each generator's period depends on its own level, so this can't be
  // driven by a single shared counter.
  coreProgress: number
}

export interface GameState {
  version: number
  width: number
  height: number
  cells: Cell[] // flat array, index = y * width + x
  currency: Decimal // energy - kept as the internal field name; only display text says "Energy" (see ui/currencyHeader.ts)
  tickCount: number // total logical ticks elapsed since game start
  lastSaved: number // epoch ms
  upgrades: UpgradeLevels // account-wide, energy-purchased, see game/upgrades.ts

  // --- Power Cores: a second resource, its own meta-progression menu, see
  // game/powerCoreUpgrades.ts. As of Alpha 0.31, produced exclusively by the
  // Power Core Generator - no other source. ---
  powerCores: Decimal
  powerCoreUpgrades: PowerCoreUpgradeLevels
  // Energy earned since this run started - identical to lifetimeCurrencyEarned
  // for now (there's no prestige yet to diverge them), but is the field a
  // future prestige reset would zero out; lifetimeCurrencyEarned never resets.
  // Kept as a plain stat (Stats tab) even though nothing mechanical reads it
  // as of Alpha 0.31 - sets up for prestige later.
  currentRunEnergyEarned: Decimal
  // Best currentRunEnergyEarned ever reached, across all runs - persists
  // through a future prestige reset unlike currentRunEnergyEarned itself.
  bestRunEnergyEarned: Decimal

  // Every placeable type's build button hides its real name/description
  // ("???") until the player has, at some point, had enough Energy to
  // afford placing one - a one-time, permanent-once-crossed discovery per
  // type, not re-hidden if the balance drops back below the cost later.
  discoveredTypes: Partial<Record<Exclude<CellType, 'empty'>, true>>

  // --- Lifetime tracking, for the Stats/Achievements tabs. Stored, not
  // derived: history (playtime, past highs, past totals) can't be
  // recomputed from the current board alone. ---
  startedAt: number // epoch ms, set once at creation
  prestigeStartedAt: number // epoch ms; == startedAt until prestige exists
  activePlayMs: number // lifetime active-tab time (pauses when hidden); powers playtime achievements
  lifetimeCurrencyEarned: Decimal // cumulative all-time earnings; never decreases when currency is spent
  totalGeneratorsBuilt: number // lifetime placements
  totalUpgrades: number // lifetime cell level-ups (not account-wide upgrade purchases)
  highestValue: { basic: Decimal; leech: Decimal } // running max final-tick value ever reached, per type
  highestBuffLevel: number // highest level reached by either buff type - its own output is always 0, so "highest value" doesn't apply
  unlockedAchievements: string[] // achievement IDs already earned
}

/** Per-cell computed values for a single tick. Never stored, always recomputed. */
export interface TickResult {
  // For a Basic-family cell, `base` is the raw pre-level, pre-Buff, crit-
  // inclusive value (a display/diagnostic figure - the panel's "Base (no
  // crit)" row); `final` is what it actually produces (level/evolution
  // multiplier and any Buff included). For a Leech, `base` is its own
  // pre-cascading collection from nearby non-Leech cells and `final` adds
  // what other Leeches in range also contribute - a Leech steals a share of
  // what a cell actually PRODUCES (`final`), not its pre-multiplier `base` -
  // see engine.ts recalculate() for the full pass breakdown.
  base: Decimal[]
  final: Decimal[]
  production: Decimal
  crits: boolean[] // whether each cell's base included a crit this evaluation - basics/evolved-basics only, false elsewhere
  // Power cores: a full parallel to base/final/production above.
  // basePowerCores is a powerCoreGenerator's own raw per-proc amount (pre-
  // Buff); finalPowerCores is its actual output (Buff included) for a
  // generator, or a Leech's own power-core collection/cascade, same
  // base/final relationship as the energy fields above.
  basePowerCores: Decimal[]
  finalPowerCores: Decimal[]
  powerCoreProduction: Decimal
}

export function emptyCell(): Cell {
  return {
    type: 'empty',
    level: 0,
    facing: 'up',
    placementCost: new Decimal(0),
    coreProgress: 0,
  }
}

export function makeGameState(width: number, height: number): GameState {
  const cells: Cell[] = []
  for (let i = 0; i < width * height; i++) cells.push(emptyCell())
  const now = Date.now()
  return {
    version: 1,
    width,
    height,
    cells,
    currency: new Decimal(0),
    tickCount: 0,
    lastSaved: now,
    upgrades: makeEmptyUpgradeLevels(),
    powerCores: new Decimal(0),
    powerCoreUpgrades: makeEmptyPowerCoreUpgradeLevels(),
    currentRunEnergyEarned: new Decimal(0),
    bestRunEnergyEarned: new Decimal(0),
    discoveredTypes: {},
    startedAt: now,
    prestigeStartedAt: now,
    activePlayMs: 0,
    lifetimeCurrencyEarned: new Decimal(0),
    totalGeneratorsBuilt: 0,
    totalUpgrades: 0,
    highestValue: { basic: new Decimal(0), leech: new Decimal(0) },
    highestBuffLevel: 0,
    unlockedAchievements: [],
  }
}

export function cellIndex(x: number, y: number, width: number): number {
  return y * width + x
}

/**
 * Grows the board to at least (newWidth, newHeight) - every existing cell
 * keeps its exact (x, y) position and contents; new cells beyond the old
 * bounds start empty. Never shrinks: if the board is already at least this
 * big (e.g. an imported save from before the Grid Size upgrade existed, or
 * one built bigger via the debug grid-size selector), this is a no-op rather
 * than dropping cells - see upgrades.ts buyUpgrade(), the only real caller.
 */
export function resizeGrid(state: GameState, newWidth: number, newHeight: number): void {
  const width = Math.max(newWidth, state.width)
  const height = Math.max(newHeight, state.height)
  if (width === state.width && height === state.height) return

  const cells: Cell[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(x < state.width && y < state.height ? state.cells[cellIndex(x, y, state.width)] : emptyCell())
    }
  }
  state.width = width
  state.height = height
  state.cells = cells
}
