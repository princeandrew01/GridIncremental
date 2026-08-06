import Decimal from 'break_infinity.js'
import type { GameState, PowerCoreUpgradeId } from './types'
import { resizeGrid } from './types'
import { POWER_CORE_UPGRADE_MAX_LEVEL, POWER_CORE_UPGRADE_COST, PC_GRID_SIZE_PER_LEVEL } from './config'
import { totalGridSizeLevel, gridSizeForLevel } from './upgrades'

// Alpha 0.31: down to 5 ids. Grid Size is the one survivor from the old
// combined-with-Energy set (still stacks additively - see upgrades.ts
// totalGridSizeLevel); the other 4 are new build-count-cap upgrades, one
// per evolution type, unrelated to the old power-core-only stats they
// replaced (Power Core Reduction/Amount/Chance, the old flat unlock, and
// the Power Core side of Tick Speed/Basic Value/Crit Chance/Crit Amount -
// all removed entirely, see config.ts).
export const POWER_CORE_UPGRADE_IDS: PowerCoreUpgradeId[] = ['gridSize', 'critTowerSlots', 'basicSteadySlots', 'buffStackerSlots', 'buffAllSlots']

export const POWER_CORE_UPGRADE_LABEL: Record<PowerCoreUpgradeId, string> = {
  gridSize: 'Grid Size',
  critTowerSlots: 'Crit Tower Slots',
  basicSteadySlots: 'Basic Steady Slots',
  buffStackerSlots: 'Buff Stacker Slots',
  buffAllSlots: 'Buff All Slots',
}

export const POWER_CORE_UPGRADE_DESCRIPTION: Record<PowerCoreUpgradeId, string> = {
  gridSize: `+${PC_GRID_SIZE_PER_LEVEL} to both grid dimensions, additive with Energy's Grid Size.`,
  critTowerSlots: 'Each level allows one more Crit Tower (a maxed Basic evolved for +30 percentage points crit chance and x100 crit amount) on the board at once.',
  basicSteadySlots: 'Each level allows one more Basic Steady Tower (a maxed Basic evolved for a x10 output multiplier) on the board at once.',
  buffStackerSlots: 'Each level allows one more Buff Stacker (a maxed Buff evolved to multiply another Buff/Buff All it targets) on the board at once.',
  buffAllSlots: 'Each level allows one more Buff All (a maxed Buff evolved to boost every cell on the board) on the board at once.',
}

/** Whether `id` is still at level 0 - the 4 evolution-slot upgrades show as "Locked" (name/description hidden) until at least 1 level is bought; Grid Size never does, it's not gated behind anything. */
export function isPowerCoreUpgradeLocked(state: GameState, id: PowerCoreUpgradeId): boolean {
  return id !== 'gridSize' && state.powerCoreUpgrades[id] <= 0
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
