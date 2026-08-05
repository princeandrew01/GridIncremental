import Decimal from 'break_infinity.js'
import type { GameState, PowerCoreUpgradeId } from './types'
import { resizeGrid } from './types'
import {
  POWER_CORE_UPGRADE_MAX_LEVEL,
  POWER_CORE_UPGRADE_COST,
  POWER_CORE_REDUCTION_PER_LEVEL,
  POWER_CORE_AMOUNT_PER_LEVEL,
  POWER_CORE_CHANCE_PER_LEVEL,
  PC_TICK_SPEED_PCT_PER_LEVEL,
  PC_BASIC_VALUE_PER_LEVEL,
  PC_CRIT_CHANCE_PER_LEVEL,
  PC_CRIT_AMOUNT_PCT_PER_LEVEL,
  PC_GRID_SIZE_PER_LEVEL,
} from './config'
import { totalGridSizeLevel, gridSizeForLevel } from './upgrades'

// Match the order the user listed these in.
export const POWER_CORE_UPGRADE_IDS: PowerCoreUpgradeId[] = [
  'powerCoreReduction',
  'powerCoreAmount',
  'powerCoreChance',
  'unlockPowerCoreGenerator',
  'tickSpeed',
  'basicValue',
  'critChance',
  'critAmount',
  'gridSize',
]

export const POWER_CORE_UPGRADE_LABEL: Record<PowerCoreUpgradeId, string> = {
  powerCoreReduction: 'Power Core Reduction',
  powerCoreAmount: 'Power Core Amount',
  powerCoreChance: 'Power Core Chance',
  unlockPowerCoreGenerator: 'Unlock Power Core Generator',
  tickSpeed: 'Tick Speed',
  basicValue: 'Basic Generator Value',
  critChance: 'Crit Chance',
  critAmount: 'Crit Amount',
  gridSize: 'Grid Size',
}

export const POWER_CORE_UPGRADE_DESCRIPTION: Record<PowerCoreUpgradeId, string> = {
  powerCoreReduction: `-${POWER_CORE_REDUCTION_PER_LEVEL * 100}% off every power core energy threshold.`,
  powerCoreAmount: `+${POWER_CORE_AMOUNT_PER_LEVEL} power core(s) per proc - exponent awards, Power Core Chance, and the Power Core Generator all read this.`,
  powerCoreChance: `+${POWER_CORE_CHANCE_PER_LEVEL * 100}% chance for an energy-producing generator to also produce a power core.`,
  unlockPowerCoreGenerator: 'Unlocks the Power Core Generator in the Build tab.',
  tickSpeed: `-${PC_TICK_SPEED_PCT_PER_LEVEL * 100}% tick length, multiplicative on top of Energy's Tick Speed.`,
  basicValue: `+${PC_BASIC_VALUE_PER_LEVEL} to every Basic's base value, additive with Energy's Basic Generator Value.`,
  critChance: `+${PC_CRIT_CHANCE_PER_LEVEL * 100}% crit chance, additive with Energy's Crit Chance.`,
  critAmount: `+${PC_CRIT_AMOUNT_PCT_PER_LEVEL * 100}% crit amount, multiplicative on top of Energy's Crit Amount.`,
  gridSize: `+${PC_GRID_SIZE_PER_LEVEL} to both grid dimensions, additive with Energy's Grid Size.`,
}

export function pcMaxLevelFor(id: PowerCoreUpgradeId): number {
  return POWER_CORE_UPGRADE_MAX_LEVEL[id]
}

/**
 * Cost of buying a single level, going from `level` to `level + 1`. Same two
 * curve shapes Energy's own upgrades use (see upgrades.ts upgradeCostAt) -
 * power-core upgrades started out flat-priced (same cost every level), but
 * that turned out to be the wrong shape once power core income itself started
 * scaling with energy (see config.ts POWER_CORE_UPGRADE_COST for the full
 * reasoning), so this now shares Energy's escalating math instead of its own
 * simpler one.
 */
export function pcUpgradeCostAt(id: PowerCoreUpgradeId, level: number): Decimal {
  const curve = POWER_CORE_UPGRADE_COST[id]
  if (curve.kind === 'quadratic') {
    return new Decimal(curve.coefficient).times((level + 1) ** 2)
  }
  return new Decimal(curve.baseCost).times(Decimal.pow(curve.growth, level))
}

/**
 * Cost of buying `count` consecutive levels starting at `fromLevel`, in
 * closed form - never a loop, since basicValue alone can be bought up to
 * 999,999 levels at once via the "Max" button (identical reasoning to
 * upgrades.ts's own bulkUpgradeCost, which this mirrors exactly).
 */
export function pcBulkUpgradeCost(id: PowerCoreUpgradeId, fromLevel: number, count: number): Decimal {
  if (count <= 0) return new Decimal(0)
  const curve = POWER_CORE_UPGRADE_COST[id]
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

/** Largest `count` (capped at the upgrade's max level) affordable with `powerCores`, via binary search over the closed-form bulk cost. */
export function pcMaxAffordableCount(id: PowerCoreUpgradeId, fromLevel: number, powerCores: Decimal): number {
  const cap = pcMaxLevelFor(id) - fromLevel
  if (cap <= 0) return 0
  let lo = 0
  let hi = cap
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (pcBulkUpgradeCost(id, fromLevel, mid).lte(powerCores)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Buys `count` levels of `id`, all-or-nothing (mirrors upgrades.ts's
 * buyUpgrade), deducting from state.powerCores rather than state.currency.
 * gridSize has the same resizeGrid side effect energy's version does, but
 * targets the COMBINED total (see upgrades.ts totalGridSizeLevel) since the
 * two tracks stack additively - whichever of the two is bought last is the
 * one that actually triggers the resize up to the new combined size.
 * unlockPowerCoreGenerator needs no special-casing: its maxLevel of 1 makes
 * it a one-shot gate for free, reusing the same leveled-upgrade machinery.
 */
export function buyPowerCoreUpgrade(state: GameState, id: PowerCoreUpgradeId, count: number): boolean {
  const current = state.powerCoreUpgrades[id]
  if (count <= 0 || current + count > pcMaxLevelFor(id)) return false
  const cost = pcBulkUpgradeCost(id, current, count)
  if (state.powerCores.lt(cost)) return false
  state.powerCores = state.powerCores.minus(cost)
  state.powerCoreUpgrades[id] = current + count
  if (id === 'gridSize') {
    const size = gridSizeForLevel(totalGridSizeLevel(state))
    resizeGrid(state, size, size)
  }
  return true
}
