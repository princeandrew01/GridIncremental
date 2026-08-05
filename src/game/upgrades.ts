import Decimal from 'break_infinity.js'
import type { GameState, UpgradeId } from './types'
import { resizeGrid } from './types'
import {
  UPGRADE_MAX_LEVEL,
  UPGRADE_COST,
  TICK_SPEED_MS_PER_LEVEL,
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

/** The board size a given Grid Size upgrade level targets - GRID_W (the starting 3x3) plus 1 per level, 3x3 -> 8x8 at max. */
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
    const size = gridSizeForLevel(state.upgrades.gridSize)
    resizeGrid(state, size, size)
  }
  return true
}

// --- Effect accessors: the single source of truth every other module reads
// (engine.ts, economy.ts, offline.ts, the UI) - no formula duplicated. ---

/** Flat bonus added to every Basic's base value, from the Basic Generator Value upgrade. */
export function basicValueBonus(state: GameState): number {
  return state.upgrades.basicValue * BASIC_VALUE_PER_LEVEL
}

/** Multiplier applied to every Basic's base value (and, transitively, whatever a Leech reads from it). */
export function generatorValueMultiplier(state: GameState): number {
  return 1 + state.upgrades.generatorValuePct * GENERATOR_VALUE_PCT_PER_LEVEL
}

/** Chance [0,1] that a Basic at this level crits this tick: global base + global upgrade + this Basic's own level bonus. */
export function critChanceFor(state: GameState, basicLevel: number): number {
  return CRIT_BASE_CHANCE + BASIC_CRIT_CHANCE_PER_LEVEL * basicLevel + CRIT_CHANCE_UPGRADE_PER_LEVEL * state.upgrades.critChance
}

/** Multiplier applied on a crit: (global base + global upgrade) x (this Basic's own level bonus) - sources stack multiplicatively. */
export function critAmountFor(state: GameState, basicLevel: number): number {
  const globalAmount = CRIT_BASE_AMOUNT + CRIT_AMOUNT_UPGRADE_PER_LEVEL * state.upgrades.critAmount
  return globalAmount * BASIC_CRIT_AMOUNT_MULT[basicLevel]
}

/** Fraction of a generator's placement cost refunded on Remove, capped at 1 (100%). */
export function refundFraction(state: GameState): number {
  return Math.min(1, REMOVE_REFUND_FRACTION + state.upgrades.removalRefund * REMOVAL_REFUND_PER_LEVEL)
}

/** Effective tick length in ms, after the Tick Speed upgrade. */
export function effectiveTickMs(state: GameState): number {
  return TICK_MS - state.upgrades.tickSpeed * TICK_SPEED_MS_PER_LEVEL
}
