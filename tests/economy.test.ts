import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import {
  placementCost,
  placeCell,
  upgradeCost,
  upgradeCell,
  canUpgrade,
  isMaxLevel,
  removeCell,
  removeRefund,
} from '../src/game/economy'
import { BASE_COST, COST_GROWTH, UPGRADE_COST_GROWTH, MAX_LEVEL, REMOVE_REFUND_FRACTION } from '../src/game/config'

describe('economy', () => {
  it('placement cost grows with COST_GROWTH per generator already placed', () => {
    const state = makeGameState(8, 8)
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic, 6)
    place(state, 0, 0, 'basic')
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH, 6)
    place(state, 1, 0, 'basic')
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH ** 2, 6)
  })

  it('placement fails without enough currency, succeeds and deducts cost with enough', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(5)
    expect(placeCell(state, 0, 0, 'basic')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')

    state.currency = new Decimal(BASE_COST.basic)
    expect(placeCell(state, 0, 0, 'basic')).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('basic')
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(1)
    expect(state.currency.toNumber()).toBe(0)
  })

  it('placement fails on an occupied cell', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(10000)
    expect(placeCell(state, 0, 0, 'basic')).toBe(true)
    expect(placeCell(state, 0, 0, 'leech')).toBe(false)
  })

  it('upgrade cost grows with UPGRADE_COST_GROWTH per level', () => {
    expect(upgradeCost('basic', 1).toNumber()).toBeCloseTo(BASE_COST.basic * UPGRADE_COST_GROWTH, 6)
    expect(upgradeCost('basic', 2).toNumber()).toBeCloseTo(BASE_COST.basic * UPGRADE_COST_GROWTH ** 2, 6)
  })

  it('upgrade deducts cost and increments level, respects max level', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1_000_000)
    placeCell(state, 0, 0, 'leech') // max level 3
    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(2)
    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(3)

    expect(isMaxLevel('leech', 3)).toBe(true)
    expect(canUpgrade(state, 0, 0)).toBe(false)
    expect(upgradeCell(state, 0, 0)).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(3) // unchanged
  })

  it('upgrade fails without enough currency', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(BASE_COST.buff)
    placeCell(state, 0, 0, 'buff')
    expect(state.currency.toNumber()).toBe(0)
    expect(canUpgrade(state, 0, 0)).toBe(false)
    expect(upgradeCell(state, 0, 0)).toBe(false)
  })

  it('MAX_LEVEL config sanity: basic 10, leech 3, buff 5', () => {
    expect(MAX_LEVEL).toEqual({ basic: 10, leech: 3, buff: 5 })
  })

  it('placing a buff next to an existing basic auto-faces it', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'basic')
    placeCell(state, 1, 0, 'buff') // basic is to its left
    expect(state.cells[cellIndex(1, 0, 8)].facing).toBe('left')
  })

  it('placing a buff with no adjacent basic still picks an in-bounds facing', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'buff')
    const facing = state.cells[cellIndex(0, 0, 8)].facing
    expect(['right', 'down']).toContain(facing) // up/left are off-board at (0,0)
  })

  it('a placed cell remembers what it actually cost, even as later placements get more expensive', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic') // cost = BASE_COST.basic (10)
    placeCell(state, 1, 0, 'basic') // cost = BASE_COST.basic * COST_GROWTH (11.5)
    expect(state.cells[cellIndex(0, 0, 8)].placementCost.toNumber()).toBeCloseTo(BASE_COST.basic, 6)
    expect(state.cells[cellIndex(1, 0, 8)].placementCost.toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH, 6)
  })

  it('removeRefund is REMOVE_REFUND_FRACTION of what was actually paid, not the current placement price', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic') // paid BASE_COST.basic
    placeCell(state, 1, 0, 'basic') // pushes the *next* placement price up, shouldn't affect either refund
    expect(removeRefund(state, 0, 0).toNumber()).toBeCloseTo(BASE_COST.basic * REMOVE_REFUND_FRACTION, 6)
    expect(removeRefund(state, 1, 0).toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH * REMOVE_REFUND_FRACTION, 6)
  })

  it('removeRefund is 0 for an empty cell', () => {
    const state = makeGameState(8, 8)
    expect(removeRefund(state, 3, 3).toNumber()).toBe(0)
  })

  it('removeCell refunds the fraction, empties the cell, and lowers the next placement cost back down', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic')
    placeCell(state, 1, 0, 'basic') // next basic now costs more, since 2 are on the board
    const priceWithTwoOnBoard = placementCost(state, 'basic')

    const currencyBeforeRemove = state.currency
    expect(removeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')
    expect(state.currency.toString()).toBe(currencyBeforeRemove.plus(BASE_COST.basic * REMOVE_REFUND_FRACTION).toString())

    // One fewer on the board now, so the next one should be cheaper again.
    expect(placementCost(state, 'basic').lt(priceWithTwoOnBoard)).toBe(true)
  })

  it('removeCell does nothing to an already-empty cell', () => {
    const state = makeGameState(8, 8)
    const before = state.currency
    expect(removeCell(state, 4, 4)).toBe(false)
    expect(state.currency.toString()).toBe(before.toString())
  })

  it('removeCell does not affect totalGeneratorsBuilt (a lifetime counter, not a currently-on-board count)', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic')
    expect(state.totalGeneratorsBuilt).toBe(1)
    removeCell(state, 0, 0)
    expect(state.totalGeneratorsBuilt).toBe(1) // unchanged
  })
})

function place(state: ReturnType<typeof makeGameState>, x: number, y: number, type: 'basic' | 'leech' | 'buff') {
  state.currency = state.currency.plus(1e9) // ensure affordable for setup
  placeCell(state, x, y, type)
}
