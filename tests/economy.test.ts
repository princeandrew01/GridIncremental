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
  currencyFor,
  canAffordPlacement,
  healGridSize,
} from '../src/game/economy'
import { BASE_COST, COST_GROWTH, UPGRADE_COST_GROWTH, MAX_LEVEL, REMOVE_REFUND_FRACTION, GRID_W, GRID_H, MAX_GRID_SIZE } from '../src/game/config'
import { buyPowerCoreUpgrade } from '../src/game/powerCoreUpgrades'
import { maxLevelFor } from '../src/game/upgrades'

describe('economy', () => {
  it('placement cost grows with COST_GROWTH per generator already placed', () => {
    const state = makeGameState(8, 8)
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic, 6)
    place(state, 0, 0, 'basic')
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH, 6)
    place(state, 1, 0, 'basic')
    expect(placementCost(state, 'basic').toNumber()).toBeCloseTo(BASE_COST.basic * COST_GROWTH ** 2, 6)
  })

  it('placement fails without enough currency, succeeds and deducts cost with enough, and starts at level 0', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(5)
    expect(placeCell(state, 0, 0, 'basic')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')

    state.currency = new Decimal(BASE_COST.basic)
    expect(placeCell(state, 0, 0, 'basic')).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('basic')
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(0) // levels are 0-based
    expect(state.currency.toNumber()).toBe(0)
  })

  it('placement fails on an occupied cell', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(10000)
    expect(placeCell(state, 0, 0, 'basic')).toBe(true)
    expect(placeCell(state, 0, 0, 'leech')).toBe(false)
  })

  it('upgrade cost grows with the type\'s own UPGRADE_COST_GROWTH per level', () => {
    expect(upgradeCost('basic', 0).toNumber()).toBeCloseTo(BASE_COST.basic, 6)
    expect(upgradeCost('basic', 1).toNumber()).toBeCloseTo(BASE_COST.basic * UPGRADE_COST_GROWTH.basic, 6)
    expect(upgradeCost('basic', 2).toNumber()).toBeCloseTo(BASE_COST.basic * UPGRADE_COST_GROWTH.basic ** 2, 6)
  })

  it('upgrade deducts cost and increments level, respects max level', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1_000_000)
    placeCell(state, 0, 0, 'leech') // starts at level 0, max level 2
    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(1)
    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(2)

    expect(isMaxLevel('leech', 2)).toBe(true)
    expect(canUpgrade(state, 0, 0)).toBe(false)
    expect(upgradeCell(state, 0, 0)).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(2) // unchanged
  })

  it('upgrade fails without enough currency', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(BASE_COST.buffV1)
    placeCell(state, 0, 0, 'buffV1')
    expect(state.currency.toNumber()).toBe(0)
    expect(canUpgrade(state, 0, 0)).toBe(false)
    expect(upgradeCell(state, 0, 0)).toBe(false)
  })

  it('MAX_LEVEL config sanity: basic 5, leech 2, buffV1 2, buffV2 4, powerCoreGenerator 4 (all 0-based)', () => {
    expect(MAX_LEVEL).toEqual({ basic: 5, leech: 2, buffV1: 2, buffV2: 4, powerCoreGenerator: 4 })
  })

  it('currencyFor: everything is priced in energy except the Power Core Generator', () => {
    expect(currencyFor('basic')).toBe('energy')
    expect(currencyFor('leech')).toBe('energy')
    expect(currencyFor('buffV1')).toBe('energy')
    expect(currencyFor('buffV2')).toBe('energy')
    expect(currencyFor('powerCoreGenerator')).toBe('powerCores')
  })

  it('the Power Core Generator is priced, upgraded, and refunded in power cores, never touching energy', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9) // plenty of energy - none of it should move
    state.powerCores = new Decimal(1e6)
    buyPowerCoreUpgrade(state, 'unlockPowerCoreGenerator', 1) // gated - see isBuildable

    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(true)
    expect(state.currency.toString()).toBe(new Decimal(1e9).toString()) // untouched
    expect(state.powerCores.lt(1e6)).toBe(true) // spent

    const powerCoresAfterPlace = state.powerCores
    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(1)
    expect(state.currency.toString()).toBe(new Decimal(1e9).toString()) // still untouched
    expect(state.powerCores.lt(powerCoresAfterPlace)).toBe(true) // spent again

    const powerCoresBeforeRemove = state.powerCores
    expect(removeCell(state, 0, 0)).toBe(true)
    expect(state.powerCores.gt(powerCoresBeforeRemove)).toBe(true) // refunded in power cores
    expect(state.currency.toString()).toBe(new Decimal(1e9).toString()) // still untouched
  })

  it('placing a Power Core Generator fails without enough power cores, even with abundant energy', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    state.powerCores = new Decimal(0)
    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')
  })

  it('placing a Power Core Generator fails while locked, even with abundant power cores - regression for the UI-only [hidden] bug (see style.css .build-button[hidden])', () => {
    const state = makeGameState(8, 8)
    state.powerCores = new Decimal(1e9) // plenty - the lock, not affordability, is what should block this
    expect(state.powerCoreUpgrades.unlockPowerCoreGenerator).toBe(0) // not unlocked
    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')
    expect(canAffordPlacement(state, 'powerCoreGenerator')).toBe(false) // isBuildable folds into this too

    buyPowerCoreUpgrade(state, 'unlockPowerCoreGenerator', 1)
    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(true)
  })

  it('placing a buff V1 next to an existing basic auto-faces it', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'basic')
    placeCell(state, 1, 0, 'buffV1') // basic is to its left
    expect(state.cells[cellIndex(1, 0, 8)].facing).toBe('left')
  })

  it('placing a buff V1 with no adjacent basic still picks an in-bounds facing', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'buffV1')
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

  it('removeRefund defaults to REMOVE_REFUND_FRACTION of what was actually paid (no Removal Refund upgrade bought), not the current placement price', () => {
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

  it('removeRefund rises with the Removal Refund upgrade, capped at 100%', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic')
    state.upgrades.removalRefund = 10 // max level: 50% + 10*5% = 100%
    expect(removeRefund(state, 0, 0).toNumber()).toBeCloseTo(BASE_COST.basic, 6) // full refund
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

describe('healGridSize', () => {
  it('is a no-op for an already-compliant state (fresh default board, no upgrades)', () => {
    const state = makeGameState(GRID_W, GRID_H)
    const before = { width: state.width, height: state.height, cells: state.cells.length }
    healGridSize(state)
    expect(state.width).toBe(before.width)
    expect(state.height).toBe(before.height)
    expect(state.cells.length).toBe(before.cells)
  })

  it('bumps a board still sitting at the old fixed 3x3 default up to the new 4x4 default', () => {
    const state = makeGameState(3, 3)
    healGridSize(state)
    expect(state.width).toBe(GRID_W)
    expect(state.height).toBe(GRID_H)
    expect(state.cells.length).toBe(GRID_W * GRID_H)
  })

  it("doesn't touch a board that's some other size entirely (e.g. already grown past 3x3, or a debug size)", () => {
    const state = makeGameState(5, 5)
    healGridSize(state)
    expect(state.width).toBe(5)
    expect(state.height).toBe(5)
  })

  it('clamps both Grid Size upgrade tracks down to their (possibly-lowered) max level', () => {
    const state = makeGameState(8, 8)
    state.upgrades.gridSize = 5 // above the new max of 3 - reachable under the old, higher cap
    state.powerCoreUpgrades.gridSize = 5
    healGridSize(state)
    expect(state.upgrades.gridSize).toBe(maxLevelFor('gridSize'))
    expect(state.powerCoreUpgrades.gridSize).toBe(3)
  })

  it('shrinks a board bigger than MAX_GRID_SIZE back down to it, refunding every cell that falls outside the new bounds', () => {
    const state = makeGameState(13, 13) // reachable under the old max-level-5 tracks (3x3 -> 13x13)
    state.currency = new Decimal(0)
    state.powerCores = new Decimal(0)
    place(state, 12, 12, 'basic') // falls outside the new 10x10 bounds - should be refunded then dropped
    place(state, 3, 3, 'basic') // stays inside - should survive untouched
    const paidForDropped = state.cells[cellIndex(12, 12, 13)].placementCost
    const paidForKept = state.cells[cellIndex(3, 3, 13)].placementCost
    state.currency = new Decimal(0) // place() (the test helper) top-ups currency for affordability - zero it so the refund below is exactly measurable

    healGridSize(state)

    expect(state.width).toBe(MAX_GRID_SIZE)
    expect(state.height).toBe(MAX_GRID_SIZE)
    expect(state.cells.length).toBe(MAX_GRID_SIZE * MAX_GRID_SIZE)
    // Refunded in energy (what a Basic is actually paid in - see currencyFor), at the default 50% refund fraction.
    expect(state.currency.toString()).toBe(paidForDropped.times(0.5).toString())
    // The surviving cell kept its exact position and contents.
    expect(state.cells[cellIndex(3, 3, MAX_GRID_SIZE)].type).toBe('basic')
    expect(state.cells[cellIndex(3, 3, MAX_GRID_SIZE)].placementCost.toString()).toBe(paidForKept.toString())
  })

  it("doesn't shrink a board that's already within MAX_GRID_SIZE, even if larger than the new 4x4 default", () => {
    const state = makeGameState(MAX_GRID_SIZE, MAX_GRID_SIZE)
    healGridSize(state)
    expect(state.width).toBe(MAX_GRID_SIZE)
    expect(state.height).toBe(MAX_GRID_SIZE)
  })
})

function place(state: ReturnType<typeof makeGameState>, x: number, y: number, type: 'basic' | 'leech' | 'buffV1' | 'buffV2') {
  state.currency = state.currency.plus(1e9) // ensure affordable for setup
  placeCell(state, x, y, type)
}
