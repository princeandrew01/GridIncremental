import Decimal from 'break_infinity.js'
import type { GameState, UpgradeId } from './types'
import { resizeGrid } from './types'
import {
  UPGRADE_MAX_LEVEL,
  UPGRADE_COST,
  TICK_SPEED_MS_PER_LEVEL,
  BASIC_BASE_VALUE,
  BASIC_VALUE_PER_LEVEL,
  GENERATOR_VALUE_PCT_PER_LEVEL,
  CRIT_CHANCE_UPGRADE_PER_LEVEL,
  CRIT_AMOUNT_UPGRADE_PER_LEVEL,
  REMOVAL_REFUND_PER_LEVEL,
  GRID_SIZE_PER_LEVEL,
  TICK_MS,
  GRID_W,
  BASIC_CRIT_CHANCE_PER_LEVEL,
  BASIC_CRIT_AMOUNT_MULT,
  CRIT_BASE_CHANCE,
  CRIT_BASE_AMOUNT,
  REMOVE_REFUND_FRACTION,
  PC_TICK_SPEED_PCT_PER_LEVEL,
  PC_BASIC_VALUE_PER_LEVEL,
  PC_CRIT_CHANCE_PER_LEVEL,
  PC_CRIT_AMOUNT_PCT_PER_LEVEL,
  PC_GRID_SIZE_PER_LEVEL,
  POWER_CORE_CHANCE_BASE,
  POWER_CORE_CHANCE_PER_LEVEL,
  POWER_CORE_AMOUNT_BASE,
  POWER_CORE_AMOUNT_PER_LEVEL,
  POWER_CORE_REDUCTION_PER_LEVEL,
} from './config'

export const UPGRADE_IDS: UpgradeId[] = [
  'tickSpeed',
  'basicValue',
  'generatorValuePct',
  'critChance',
  'critAmount',
  'removalRefund',
  'gridSize',
]

export const UPGRADE_LABEL: Record<UpgradeId, string> = {
  tickSpeed: 'Tick Speed',
  basicValue: 'Basic Generator Value',
  generatorValuePct: 'Generator Value %',
  critChance: 'Crit Chance',
  critAmount: 'Crit Amount',
  removalRefund: 'Removal Refund',
  gridSize: 'Grid Size',
}

export const UPGRADE_DESCRIPTION: Record<UpgradeId, string> = {
  tickSpeed: `-${TICK_SPEED_MS_PER_LEVEL}ms per tick.`,
  basicValue: `+${BASIC_VALUE_PER_LEVEL} to every Basic's base value.`,
  generatorValuePct: `+${GENERATOR_VALUE_PCT_PER_LEVEL * 100}% to every Basic's base value (Leech inherits it too).`,
  critChance: `+${CRIT_CHANCE_UPGRADE_PER_LEVEL * 100}% crit chance.`,
  critAmount: `+${CRIT_AMOUNT_UPGRADE_PER_LEVEL}x crit amount.`,
  removalRefund: `+${REMOVAL_REFUND_PER_LEVEL * 100}% currency refunded on Remove.`,
  gridSize: `+${GRID_SIZE_PER_LEVEL} to both grid dimensions.`,
}

/** The board size a given Grid Size upgrade level targets - GRID_W (the starting 4x4) plus 1 per level. */
export function gridSizeForLevel(level: number): number {
  return GRID_W + level * GRID_SIZE_PER_LEVEL
}

export function maxLevelFor(id: UpgradeId): number {
  return UPGRADE_MAX_LEVEL[id]
}

export function isUpgradeMaxed(state: GameState, id: UpgradeId): boolean {
  return state.upgrades[id] >= maxLevelFor(id)
}

/** Cost of buying a single level, going from `level` to `level + 1`. */
export function upgradeCostAt(id: UpgradeId, level: number): Decimal {
  const curve = UPGRADE_COST[id]
  if (curve.kind === 'quadratic') {
    return new Decimal(curve.coefficient).times((level + 1) ** 2)
  }
  return new Decimal(curve.baseCost).times(Decimal.pow(curve.growth, level))
}

/**
 * Cost of buying `count` consecutive levels starting at `fromLevel`, in
 * closed form - never a loop, since basicValue alone can be bought up to
 * 999,999 levels at once via the "Max" button. Float64 has ~15-17 significant
 * digits, comfortably more precision than a displayed cost ever needs even at
 * the top of that range, so the plain-number sum-of-squares below is safe.
 */
export function bulkUpgradeCost(id: UpgradeId, fromLevel: number, count: number): Decimal {
  if (count <= 0) return new Decimal(0)
  const curve = UPGRADE_COST[id]
  if (curve.kind === 'quadratic') {
    const sumSquares = (n: number) => (n * (n + 1) * (2 * n + 1)) / 6
    return new Decimal(curve.coefficient).times(sumSquares(fromLevel + count) - sumSquares(fromLevel))
  }
  const { baseCost, growth } = curve
  if (growth === 1) return new Decimal(baseCost).times(count) // degenerate, but keep the formula defined
  // Geometric series: baseCost * growth^fromLevel * (growth^count - 1) / (growth - 1)
  return new Decimal(baseCost)
    .times(Decimal.pow(growth, fromLevel))
    .times(Decimal.pow(growth, count).minus(1))
    .div(growth - 1)
}

/** Largest `count` (capped at the upgrade's max level) affordable with `currency`, via binary search over the closed-form bulk cost. */
export function maxAffordableCount(id: UpgradeId, fromLevel: number, currency: Decimal): number {
  const cap = maxLevelFor(id) - fromLevel
  if (cap <= 0) return 0
  let lo = 0
  let hi = cap
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (bulkUpgradeCost(id, fromLevel, mid).lte(currency)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Buys `count` levels of `id`, all-or-nothing (like placeCell/upgradeCell):
 * fails if it would exceed the max level or isn't affordable. Returns
 * whether it happened.
 *
 * Grid Size is the one upgrade with a side effect beyond the level counter
 * itself - every other upgrade's effect is read fresh off state.upgrades at
 * calc time (see the effect accessors below), but the board's actual
 * width/height/cells are real stored state (used everywhere, serialized in
 * saves), not something recomputed on the fly. Growing it here, in the one
 * place the level can change, keeps "gridSize level N" and "board is at
 * least gridSizeForLevel(N)" from ever drifting apart. resizeGrid() itself
 * never shrinks, so this is safe even if the board's already bigger.
 */
export function buyUpgrade(state: GameState, id: UpgradeId, count: number): boolean {
  const current = state.upgrades[id]
  if (count <= 0 || current + count > maxLevelFor(id)) return false
  const cost = bulkUpgradeCost(id, current, count)
  if (state.currency.lt(cost)) return false
  state.currency = state.currency.minus(cost)
  state.upgrades[id] = current + count
  if (id === 'gridSize') {
    const size = gridSizeForLevel(totalGridSizeLevel(state))
    resizeGrid(state, size, size)
  }
  return true
}

// --- Effect accessors: the single source of truth every other module reads
// (engine.ts, economy.ts, offline.ts, the UI) - no formula duplicated. Each
// one below that has a Power Core Menu counterpart (see config.ts's PC_*
// constants and powerCoreUpgrades.ts) combines both tracks here, per the
// stacking rule confirmed with the user for that specific stat - additive or
// multiplicative, never assumed uniform across all five. ---

/** Flat bonus added to every Basic's base value, from both Basic Generator Value upgrades (additive). */
export function basicValueBonus(state: GameState): number {
  return state.upgrades.basicValue * BASIC_VALUE_PER_LEVEL + state.powerCoreUpgrades.basicValue * PC_BASIC_VALUE_PER_LEVEL
}

/** Multiplier applied to every Basic's base value (and, transitively, whatever a Leech reads from it). */
export function generatorValueMultiplier(state: GameState): number {
  return 1 + state.upgrades.generatorValuePct * GENERATOR_VALUE_PCT_PER_LEVEL
}

/** Chance [0,1] that a Basic at this level crits this tick: global base + this Basic's own level bonus + both Crit Chance upgrades (additive). */
export function critChanceFor(state: GameState, basicLevel: number): number {
  return (
    CRIT_BASE_CHANCE +
    BASIC_CRIT_CHANCE_PER_LEVEL * basicLevel +
    CRIT_CHANCE_UPGRADE_PER_LEVEL * state.upgrades.critChance +
    PC_CRIT_CHANCE_PER_LEVEL * state.powerCoreUpgrades.critChance
  )
}

/**
 * Multiplier applied on a crit: (global base + Energy's Crit Amount upgrade)
 * x (this Basic's own level bonus) x (Power Core's Crit Amount upgrade,
 * multiplicative on top of everything else - confirmed with the user, unlike
 * the other four shared-name upgrades which stack additively).
 */
export function critAmountFor(state: GameState, basicLevel: number): number {
  const globalAmount = CRIT_BASE_AMOUNT + CRIT_AMOUNT_UPGRADE_PER_LEVEL * state.upgrades.critAmount
  const pcMultiplier = 1 + state.powerCoreUpgrades.critAmount * PC_CRIT_AMOUNT_PCT_PER_LEVEL
  return globalAmount * BASIC_CRIT_AMOUNT_MULT[basicLevel] * pcMultiplier
}

/** Fraction of a generator's placement cost refunded on Remove, capped at 1 (100%). */
export function refundFraction(state: GameState): number {
  return Math.min(1, REMOVE_REFUND_FRACTION + state.upgrades.removalRefund * REMOVAL_REFUND_PER_LEVEL)
}

/**
 * Effective tick length in ms. The two Tick Speed upgrades stack
 * multiplicatively (confirmed with the user): Energy's shortens the base
 * tick first, Power Core's then takes a further percentage off *that*
 * result, rather than both subtracting flat ms from the original 1000ms -
 * this can't ever reach zero, and combines cleanly if more reductions are
 * ever added later.
 */
export function effectiveTickMs(state: GameState): number {
  const energyFraction = state.upgrades.tickSpeed * (TICK_SPEED_MS_PER_LEVEL / TICK_MS)
  const powerCoreFraction = state.powerCoreUpgrades.tickSpeed * PC_TICK_SPEED_PCT_PER_LEVEL
  return TICK_MS * (1 - energyFraction) * (1 - powerCoreFraction)
}

/** Combined Grid Size level across both upgrade tracks - what actually determines the board's target size (see gridSizeForLevel). */
export function totalGridSizeLevel(state: GameState): number {
  return state.upgrades.gridSize + state.powerCoreUpgrades.gridSize * PC_GRID_SIZE_PER_LEVEL
}

/** Chance [0,1] that an energy-producing generator (Basic or Leech) also produces a power core this tick - purely upgrade-driven, no per-cell-level term, each cell rolls independently (see engine.ts rollPowerCoreProcs). */
export function powerCoreChanceFor(state: GameState): number {
  return POWER_CORE_CHANCE_BASE + state.powerCoreUpgrades.powerCoreChance * POWER_CORE_CHANCE_PER_LEVEL
}

/** Power cores produced per proc - shared by the exponent award, a Power Core Chance hit, and the Power Core Generator. */
export function powerCoreAmountFor(state: GameState): number {
  return POWER_CORE_AMOUNT_BASE + state.powerCoreUpgrades.powerCoreAmount * POWER_CORE_AMOUNT_PER_LEVEL
}

/** Fraction knocked off every 10^n energy threshold that awards a power core (see stats.ts checkPowerCoreExponents), capped at 1 so a threshold can never go to 0 or below. */
export function powerCoreReductionFraction(state: GameState): number {
  return Math.min(1, state.powerCoreUpgrades.powerCoreReduction * POWER_CORE_REDUCTION_PER_LEVEL)
}

export function isPowerCoreGeneratorUnlocked(state: GameState): boolean {
  return state.powerCoreUpgrades.unlockPowerCoreGenerator >= 1
}

/**
 * The value Buffs scale off: a Basic's base value with no buffAccum yet (the
 * account-wide floor plus Basic Generator Value bonus, times Generator Value
 * %) - identical for every Basic on the board, since none of those three
 * inputs vary by cell (see engine.ts recalculate()). Buffs read this instead
 * of a hardcoded flat number so a firing stays a meaningful fraction of a
 * Basic's output as that floor grows, rather than shrinking toward
 * irrelevance the way a flat +1 every 5 ticks does once BASIC_MULT/crit/
 * Leech push real output into the millions (see engine.ts
 * buffV1PowerPerFiring/buffV2PowerPerFiring, config.ts BUFF_V1_PCT_PER_FIRING/
 * BUFF_V2_PCT_PER_FIRING).
 */
export function buffScalingBaseValue(state: GameState): number {
  return (BASIC_BASE_VALUE + basicValueBonus(state)) * generatorValueMultiplier(state)
}
