import Decimal from 'break_infinity.js'
import type { Cell, CellType, GameState, PowerCoreUpgradeId } from './types'
import { cellIndex, emptyCell, resizeGrid } from './types'
import {
  BASE_COST,
  COST_GROWTH,
  UPGRADE_COST_GROWTH,
  MAX_LEVEL,
  GRID_W,
  GRID_H,
  MAX_GRID_SIZE,
  POWER_CORE_GENERATOR_LEVEL_BASE_COST,
  POWER_CORE_GENERATOR_BASE_COST,
  POWER_CORE_GENERATOR_COST_GROWTH,
  EVOLUTION_CONVERSION_BASE_COST,
} from './config'
import { defaultFacingFor } from './engine'
import { refundFraction, maxLevelFor, powerCoreGeneratorCap } from './upgrades'
import { pcMaxLevelFor } from './powerCoreUpgrades'

export type BuildableType = Exclude<CellType, 'empty'>

// The 4 types actually created by placing on an empty cell (the Build tab's
// picker). The other 4 (basicCrit/basicSteady/buffStacker/buffAll) are never
// placed empty-handed - they only ever come from evolveCell, converting an
// existing maxed basic/buff in place (see below).
export type PlaceableType = 'basic' | 'leech' | 'buff' | 'powerCoreGenerator'
const PLACEABLE_TYPES: readonly PlaceableType[] = ['basic', 'leech', 'buff', 'powerCoreGenerator']

function isLevelable(type: CellType): type is PlaceableType {
  return type === 'basic' || type === 'leech' || type === 'buff' || type === 'powerCoreGenerator'
}

/** Which balance LEVELING an already-placed generator of this type is priced in - only the Power Core Generator is Power Cores (see upgradeCost/upgradeCell). Every type's PLACEMENT, Power Core Generator included, is always Energy - see placementCost. */
export function currencyFor(type: PlaceableType): 'energy' | 'powerCores' {
  return type === 'powerCoreGenerator' ? 'powerCores' : 'energy'
}

function balanceFor(state: GameState, type: PlaceableType): Decimal {
  return currencyFor(type) === 'energy' ? state.currency : state.powerCores
}

function deduct(state: GameState, type: PlaceableType, amount: Decimal): void {
  if (currencyFor(type) === 'energy') state.currency = state.currency.minus(amount)
  else state.powerCores = state.powerCores.minus(amount)
}

export function countOfType(state: GameState, type: CellType): number {
  let n = 0
  for (const cell of state.cells) {
    if (cell.type === type) n++
  }
  return n
}

/**
 * Cost to place the next generator of this type, in Energy - every
 * PlaceableType, Power Core Generator included. Basic/Leech/Buff share the
 * common BASE_COST/COST_GROWTH curve; the Power Core Generator has its own,
 * much steeper one (POWER_CORE_GENERATOR_BASE_COST/_COST_GROWTH) - 5,000,000
 * for the first, x10 per additional one already on the board. Reinstated
 * after an earlier pass made its placement free (paid for entirely via the
 * Power Generator Count upgrade) - the user reversed that call; Power
 * Generator Count is now a pure cap, not a payment mechanism.
 */
export function placementCost(state: GameState, type: PlaceableType): Decimal {
  const count = countOfType(state, type)
  if (type === 'powerCoreGenerator') {
    return new Decimal(POWER_CORE_GENERATOR_BASE_COST).times(Decimal.pow(POWER_CORE_GENERATOR_COST_GROWTH, count))
  }
  return new Decimal(BASE_COST[type]).times(Decimal.pow(COST_GROWTH, count))
}

/**
 * Whether `type` can currently be placed at all, ignoring affordability -
 * only the Power Core Generator is gated, by how many are already on the
 * board versus the Power Generator Count upgrade's cap (see
 * upgrades.ts powerCoreGeneratorCap - a pure cap now, not a payment
 * mechanism; see placementCost for what actually gets charged).
 * Everything else is always buildable.
 */
export function isBuildable(state: GameState, type: PlaceableType): boolean {
  if (type === 'powerCoreGenerator') return countOfType(state, type) < powerCoreGeneratorCap(state)
  return true
}

export function canAffordPlacement(state: GameState, type: PlaceableType): boolean {
  if (!isBuildable(state, type)) return false
  return state.currency.gte(placementCost(state, type))
}

/** Marks every placeable type the player can currently afford as permanently discovered (see GameState.discoveredTypes) - a one-time reveal; never re-hidden later if the balance drops back below the cost. Call once per render/tick, same pattern as checkAchievements/updateHighestValues. */
export function updateDiscoveredTypes(state: GameState): void {
  for (const type of PLACEABLE_TYPES) {
    if (!state.discoveredTypes[type] && canAffordPlacement(state, type)) {
      state.discoveredTypes[type] = true
    }
  }
}

/** Places `type` at (x, y) - deducts its Energy cost (every PlaceableType, Power Core Generator included - see placementCost), if the cell is empty, buildable, and affordable. Returns whether it happened. Also marks `type` discovered - placing one obviously means it was affordable. */
export function placeCell(state: GameState, x: number, y: number, type: PlaceableType): boolean {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type !== 'empty') return false
  if (!isBuildable(state, type)) return false
  const cost = placementCost(state, type)
  if (state.currency.lt(cost)) return false
  state.currency = state.currency.minus(cost)
  cell.type = type
  cell.level = 0 // levels are 0-based: a freshly placed generator starts at level 0
  cell.placementCost = cost // stored per-cell: powers the Remove refund, since cost escalates over time.
  cell.coreProgress = 0 // powerCoreGenerator only; meaningless otherwise, but keep it clean
  if (type === 'buff') cell.facing = defaultFacingFor(state, x, y)
  state.totalGeneratorsBuilt += 1
  state.discoveredTypes[type] = true
  return true
}

/** Cost to upgrade a generator of this type from `currentLevel` to `currentLevel + 1`. The Power Core Generator uses its own separate base cost (Power-Core-priced, see config.ts POWER_CORE_GENERATOR_LEVEL_BASE_COST) - distinct from its placement cost (Energy-priced, see placementCost above), which has its own separate curve too. */
export function upgradeCost(type: PlaceableType, currentLevel: number): Decimal {
  const base = type === 'powerCoreGenerator' ? POWER_CORE_GENERATOR_LEVEL_BASE_COST : BASE_COST[type]
  return new Decimal(base).times(Decimal.pow(UPGRADE_COST_GROWTH[type], currentLevel))
}

export function isMaxLevel(type: BuildableType, level: number): boolean {
  return level >= MAX_LEVEL[type]
}

export function canUpgrade(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return false
  if (isMaxLevel(cell.type, cell.level)) return false
  if (!isLevelable(cell.type)) return false // the 4 evolved types are always maxed above (MAX_LEVEL 0), so this never actually triggers - just keeps upgradeCost's narrower type honest
  return balanceFor(state, cell.type).gte(upgradeCost(cell.type, cell.level))
}

/**
 * Cost to upgrade a generator of this type from `fromLevel` by `count`
 * consecutive levels, in closed form - the same geometric-series shape
 * upgrades.ts's own bulkUpgradeCost uses for account-wide upgrades, mirrored
 * here since a placed cell's own level-up curve is a completely separate
 * cost track (see upgradeCost above).
 */
export function cellBulkUpgradeCost(type: PlaceableType, fromLevel: number, count: number): Decimal {
  if (count <= 0) return new Decimal(0)
  const base = type === 'powerCoreGenerator' ? POWER_CORE_GENERATOR_LEVEL_BASE_COST : BASE_COST[type]
  const growth = UPGRADE_COST_GROWTH[type]
  if (growth === 1) return new Decimal(base).times(count) // degenerate, but keep the formula defined
  return new Decimal(base)
    .times(Decimal.pow(growth, fromLevel))
    .times(Decimal.pow(growth, count).minus(1))
    .div(growth - 1)
}

/** Largest count of additional levels (capped at the type's max level) affordable with the cell's own current balance (Energy, or Power Cores for the Power Core Generator) - binary search over cellBulkUpgradeCost, same pattern as upgrades.ts maxAffordableCount. */
export function cellMaxAffordableUpgradeCount(state: GameState, x: number, y: number): number {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty' || !isLevelable(cell.type)) return 0
  const cap = MAX_LEVEL[cell.type] - cell.level
  if (cap <= 0) return 0
  const balance = balanceFor(state, cell.type)
  let lo = 0
  let hi = cap
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (cellBulkUpgradeCost(cell.type, cell.level, mid).lte(balance)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Upgrades the generator at (x, y) by `count` levels (default 1) and deducts the bulk cost, all-or-nothing - if not enough levels remain or it isn't fully affordable, nothing happens. Returns whether it happened. */
export function upgradeCell(state: GameState, x: number, y: number, count: number = 1): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return false
  if (!isLevelable(cell.type)) return false
  if (count <= 0 || cell.level + count > MAX_LEVEL[cell.type]) return false
  const cost = cellBulkUpgradeCost(cell.type, cell.level, count)
  if (balanceFor(state, cell.type).lt(cost)) return false
  deduct(state, cell.type, cost)
  cell.level += count
  state.totalUpgrades += count // bulk-buying N levels is N lifetime level-ups, same as buying them one at a time would have been
  return true
}

/**
 * What removing the generator at (x, y) would refund - 0 for an empty cell.
 * Reads the account-wide Removal Refund upgrade (see upgrades.ts). Always
 * denominated in Energy: every non-empty cell's placementCost is an Energy
 * figure now, including the Power Core Generator (its placement is Energy-
 * priced - see placementCost) and the 4 evolved types, which inherit their
 * placementCost unchanged from the plain basic/buff they were converted
 * from (see evolveCell) - evolving never re-prices a cell, only the
 * one-time Power Core conversion fee does, and that's never refunded.
 */
export function removeRefund(state: GameState, x: number, y: number): Decimal {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return new Decimal(0)
  return cell.placementCost.times(refundFraction(state))
}

/**
 * Removes whatever's at (x, y), refunding a fraction of what was paid to
 * place it (never what was spent on upgrades or evolving since - see
 * Cell.placementCost), credited back to Energy (see removeRefund). The freed
 * cell is fully reset, so the next placement there starts fresh. Doesn't
 * touch totalGeneratorsBuilt - that's a lifetime achievement counter, not a
 * "currently on board" count, and removal shouldn't claw back progress
 * already earned toward it.
 */
export function removeCell(state: GameState, x: number, y: number): boolean {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type === 'empty') return false
  state.currency = state.currency.plus(removeRefund(state, x, y))
  state.cells[i] = emptyCell()
  return true
}

// --- Evolution (see game/engine.ts's two-pass calc for how an evolved
// cell's own multiplier/crit is computed; this module only owns the
// unlock/cost/transformation bookkeeping). ---

export type EvolutionType = 'basicCrit' | 'basicSteady' | 'buffStacker' | 'buffAll'

const EVOLUTION_INFO: Record<EvolutionType, { sourceType: 'basic' | 'buff'; slotUpgradeId: PowerCoreUpgradeId }> = {
  basicCrit: { sourceType: 'basic', slotUpgradeId: 'critTowerSlots' },
  basicSteady: { sourceType: 'basic', slotUpgradeId: 'basicSteadySlots' },
  buffStacker: { sourceType: 'buff', slotUpgradeId: 'buffStackerSlots' },
  buffAll: { sourceType: 'buff', slotUpgradeId: 'buffAllSlots' },
}

/** How many of this evolved type the player is currently allowed to have on the board - from its Power Core tab slot upgrade (0 by default: "Locked" until at least 1 level is bought). */
export function evolutionSlotCap(state: GameState, evolutionType: EvolutionType): number {
  return state.powerCoreUpgrades[EVOLUTION_INFO[evolutionType].slotUpgradeId]
}

/**
 * Power Core cost to convert a single maxed source cell into this evolved
 * type right now - doubles per additional instance of that SAME evolved
 * type already on the board (confirmed with the user: based on the current
 * on-board count, so removing one drops the next conversion back down,
 * mirroring how placementCost already works elsewhere).
 */
export function evolutionConversionCost(state: GameState, evolutionType: EvolutionType): Decimal {
  const count = countOfType(state, evolutionType)
  return new Decimal(EVOLUTION_CONVERSION_BASE_COST).times(Decimal.pow(2, count))
}

/** Whether the cell at (x, y) can evolve into `evolutionType` right now - maxed source type, a free slot, and enough power cores. */
export function canEvolve(state: GameState, x: number, y: number, evolutionType: EvolutionType): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  const info = EVOLUTION_INFO[evolutionType]
  if (cell.type !== info.sourceType) return false
  if (!isMaxLevel(cell.type, cell.level)) return false
  if (countOfType(state, evolutionType) >= evolutionSlotCap(state, evolutionType)) return false
  return state.powerCores.gte(evolutionConversionCost(state, evolutionType))
}

/** Converts the maxed cell at (x, y) into `evolutionType` in place, deducting the Power Core conversion fee. Position, facing, and placementCost all carry over unchanged - only `type` changes. Returns whether it happened. */
export function evolveCell(state: GameState, x: number, y: number, evolutionType: EvolutionType): boolean {
  if (!canEvolve(state, x, y, evolutionType)) return false
  const cost = evolutionConversionCost(state, evolutionType)
  state.powerCores = state.powerCores.minus(cost)
  state.cells[cellIndex(x, y, state.width)].type = evolutionType
  return true
}

/**
 * Self-heal for the Grid Size rebalance (both max levels dropped 5 -> 3,
 * default board grew 3x3 -> 4x4, hard cap dropped 13x13 -> MAX_GRID_SIZE
 * 10x10). Idempotent and cheap for an already-compliant state, so this runs
 * on every load (see main.ts useGameState()) rather than being a one-shot
 * version-gated save migration.
 *
 * Three independent fixes, confirmed with the user:
 * 1. Both Grid Size upgrade levels clamp down to their new max, in case a
 *    save bought past it under the old (higher) cap.
 * 2. A board still sitting at the exact old fixed default (3x3, meaning it
 *    was never grown at all) moves up to the new default - resizeGrid()
 *    only ever grows, so this direction is always safe.
 * 3. A board bigger than MAX_GRID_SIZE (only reachable via the old, higher
 *    per-track max levels) shrinks back down to it. Any generator that
 *    would fall outside the new bounds is refunded first, in Energy (see
 *    removeRefund) - not silently discarded, and not left oversized.
 */
export function healGridSize(state: GameState): void {
  state.upgrades.gridSize = Math.min(state.upgrades.gridSize, maxLevelFor('gridSize'))
  state.powerCoreUpgrades.gridSize = Math.min(state.powerCoreUpgrades.gridSize, pcMaxLevelFor('gridSize'))

  if (state.width === 3 && state.height === 3) {
    resizeGrid(state, GRID_W, GRID_H)
  }

  if (state.width > MAX_GRID_SIZE || state.height > MAX_GRID_SIZE) {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (x < MAX_GRID_SIZE && y < MAX_GRID_SIZE) continue
        const cell = state.cells[cellIndex(x, y, state.width)]
        if (cell.type === 'empty') continue
        state.currency = state.currency.plus(removeRefund(state, x, y))
      }
    }
    const newCells: Cell[] = []
    for (let y = 0; y < MAX_GRID_SIZE; y++) {
      for (let x = 0; x < MAX_GRID_SIZE; x++) {
        newCells.push(state.cells[cellIndex(x, y, state.width)])
      }
    }
    state.width = MAX_GRID_SIZE
    state.height = MAX_GRID_SIZE
    state.cells = newCells
  }
}
