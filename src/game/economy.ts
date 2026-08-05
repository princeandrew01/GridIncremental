import Decimal from 'break_infinity.js'
import type { CellType, GameState } from './types'
import { cellIndex, emptyCell } from './types'
import { BASE_COST, COST_GROWTH, UPGRADE_COST_GROWTH, MAX_LEVEL } from './config'
import { defaultFacingFor } from './engine'
import { refundFraction } from './upgrades'

export type BuildableType = Exclude<CellType, 'empty'>

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

export function canAffordPlacement(state: GameState, type: BuildableType): boolean {
  return state.currency.gte(placementCost(state, type))
}

/** Places `type` at (x, y) and deducts its cost, if the cell is empty and it's affordable. Returns whether it happened. */
export function placeCell(state: GameState, x: number, y: number, type: BuildableType): boolean {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type !== 'empty') return false
  const cost = placementCost(state, type)
  if (state.currency.lt(cost)) return false
  state.currency = state.currency.minus(cost)
  cell.type = type
  cell.level = 0 // levels are 0-based: a freshly placed generator starts at level 0
  cell.placementCost = cost // stored per-cell: powers the Remove refund, since cost escalates over time
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
  return state.currency.gte(upgradeCost(cell.type, cell.level))
}

/** Upgrades the generator at (x, y) and deducts its cost, if not maxed and affordable. Returns whether it happened. */
export function upgradeCell(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return false
  if (isMaxLevel(cell.type, cell.level)) return false
  const cost = upgradeCost(cell.type, cell.level)
  if (state.currency.lt(cost)) return false
  state.currency = state.currency.minus(cost)
  cell.level += 1
  state.totalUpgrades += 1
  return true
}

/** What removing the generator at (x, y) would refund - 0 for an empty cell. Reads the account-wide Removal Refund upgrade (see upgrades.ts). */
export function removeRefund(state: GameState, x: number, y: number): Decimal {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type === 'empty') return new Decimal(0)
  return cell.placementCost.times(refundFraction(state))
}

/**
 * Removes whatever's at (x, y), refunding a fraction of what was paid to
 * place it (never what was spent on upgrades since - see Cell.placementCost).
 * The freed cell is fully reset, so the next placement there starts fresh.
 * Doesn't touch totalGeneratorsBuilt - that's a lifetime achievement counter,
 * not a "currently on board" count, and removal shouldn't claw back progress
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
