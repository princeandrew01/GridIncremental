import Decimal from 'break_infinity.js'
import type { Cell, CellType, GameState } from './types'
import { cellIndex, emptyCell, resizeGrid } from './types'
import { BASE_COST, COST_GROWTH, UPGRADE_COST_GROWTH, MAX_LEVEL, GRID_W, GRID_H, MAX_GRID_SIZE } from './config'
import { defaultFacingFor } from './engine'
import { refundFraction, isPowerCoreGeneratorUnlocked, maxLevelFor } from './upgrades'
import { pcMaxLevelFor } from './powerCoreUpgrades'

export type BuildableType = Exclude<CellType, 'empty'>

/** Which balance a given generator type is priced in - everything except the Power Core Generator is Energy. */
export function currencyFor(type: BuildableType): 'energy' | 'powerCores' {
  return type === 'powerCoreGenerator' ? 'powerCores' : 'energy'
}

function balanceFor(state: GameState, type: BuildableType): Decimal {
  return currencyFor(type) === 'energy' ? state.currency : state.powerCores
}

function deduct(state: GameState, type: BuildableType, amount: Decimal): void {
  if (currencyFor(type) === 'energy') state.currency = state.currency.minus(amount)
  else state.powerCores = state.powerCores.minus(amount)
}

function credit(state: GameState, type: BuildableType, amount: Decimal): void {
  if (currencyFor(type) === 'energy') state.currency = state.currency.plus(amount)
  else state.powerCores = state.powerCores.plus(amount)
}

export function countOfType(state: GameState, type: BuildableType): number {
  let n = 0
  for (const cell of state.cells) {
    if (cell.type === type) n++
  }
  return n
}

/** Cost to place the next generator of this type. Rises with how many are already on the board. */
export function placementCost(state: GameState, type: BuildableType): Decimal {
  const count = countOfType(state, type)
  return new Decimal(BASE_COST[type]).times(Decimal.pow(COST_GROWTH, count))
}

/** Whether `type` can be placed at all right now, ignoring cost/occupancy - only the Power Core Generator is gated, behind its own unlock upgrade (see upgrades.ts isPowerCoreGeneratorUnlocked). Everything else is always buildable. */
export function isBuildable(state: GameState, type: BuildableType): boolean {
  return type !== 'powerCoreGenerator' || isPowerCoreGeneratorUnlocked(state)
}

export function canAffordPlacement(state: GameState, type: BuildableType): boolean {
  return isBuildable(state, type) && balanceFor(state, type).gte(placementCost(state, type))
}

/** Places `type` at (x, y) and deducts its cost (Energy, or Power Cores for the Power Core Generator - see currencyFor), if the cell is empty, unlocked (see isBuildable), and it's affordable. Returns whether it happened. */
export function placeCell(state: GameState, x: number, y: number, type: BuildableType): boolean {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type !== 'empty') return false
  if (!isBuildable(state, type)) return false
  const cost = placementCost(state, type)
  if (balanceFor(state, type).lt(cost)) return false
  deduct(state, type, cost)
  cell.type = type
  cell.level = 0 // levels are 0-based: a freshly placed generator starts at level 0
  cell.placementCost = cost // stored per-cell: powers the Remove refund, since cost escalates over time
  cell.coreProgress = 0 // powerCoreGenerator only; meaningless otherwise, but keep it clean
  if (type === 'buffV1') cell.facing = defaultFacingFor(state, x, y)
  state.totalGeneratorsBuilt += 1
  return true
}

/** Cost to upgrade a generator of this type from `currentLevel` to `currentLevel + 1`. */
export function upgradeCost(type: BuildableType, currentLevel: number): Decimal {
  return new Decimal(BASE_COST[type]).times(Decimal.pow(UPGRADE_COST_GROWTH[type], currentLevel))
}

export function isMaxLevel(type: BuildableType, level: number): boolean {
  return level >= MAX_LEVEL[type]
}

export function canUpgrade(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return false
  if (isMaxLevel(cell.type, cell.level)) return false
  return balanceFor(state, cell.type).gte(upgradeCost(cell.type, cell.level))
}

/** Upgrades the generator at (x, y) and deducts its cost, if not maxed and affordable. Returns whether it happened. */
export function upgradeCell(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return false
  if (isMaxLevel(cell.type, cell.level)) return false
  const cost = upgradeCost(cell.type, cell.level)
  if (balanceFor(state, cell.type).lt(cost)) return false
  deduct(state, cell.type, cost)
  cell.level += 1
  state.totalUpgrades += 1
  return true
}

/** What removing the generator at (x, y) would refund - 0 for an empty cell. Reads the account-wide Removal Refund upgrade (see upgrades.ts), applied uniformly regardless of which currency the generator was paid for in. */
export function removeRefund(state: GameState, x: number, y: number): Decimal {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return new Decimal(0)
  return cell.placementCost.times(refundFraction(state))
}

/**
 * Removes whatever's at (x, y), refunding a fraction of what was paid to
 * place it (never what was spent on upgrades since - see Cell.placementCost),
 * credited back to whichever currency it was actually paid in.
 * The freed cell is fully reset, so the next placement there starts fresh.
 * Doesn't touch totalGeneratorsBuilt - that's a lifetime achievement counter,
 * not a "currently on board" count, and removal shouldn't claw back progress
 * already earned toward it.
 */
export function removeCell(state: GameState, x: number, y: number): boolean {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type === 'empty') return false
  credit(state, cell.type, removeRefund(state, x, y))
  state.cells[i] = emptyCell()
  return true
}

/**
 * Self-heal for the Grid Size rebalance (both max levels dropped 5 -> 3,
 * default board grew 3x3 -> 4x4, hard cap dropped 13x13 -> MAX_GRID_SIZE
 * 10x10). Idempotent and cheap for an already-compliant state, so this runs
 * on every load (see main.ts useGameState()) rather than being a one-shot
 * version-gated save migration - the same "self-heal on load" pattern
 * checkPowerCoreExponents already uses for its own backfilled best-guess.
 *
 * Three independent fixes, confirmed with the user:
 * 1. Both Grid Size upgrade levels clamp down to their new max, in case a
 *    save bought past it under the old (higher) cap.
 * 2. A board still sitting at the exact old fixed default (3x3, meaning it
 *    was never grown at all) moves up to the new default - resizeGrid()
 *    only ever grows, so this direction is always safe.
 * 3. A board bigger than MAX_GRID_SIZE (only reachable via the old, higher
 *    per-track max levels) shrinks back down to it. Any generator that
 *    would fall outside the new bounds is refunded first, in whichever
 *    currency it was actually paid in (see currencyFor) - not silently
 *    discarded, and not left oversized.
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
        credit(state, cell.type, removeRefund(state, x, y))
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
