import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import type { GameState } from '../src/game/types'
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
  updateDiscoveredTypes,
  canEvolve,
  evolveCell,
  evolutionSlotCap,
  evolutionConversionCost,
  type PlaceableType,
} from '../src/game/economy'
import { BASE_COST, COST_GROWTH, UPGRADE_COST_GROWTH, MAX_LEVEL, REMOVE_REFUND_FRACTION, GRID_W, GRID_H, MAX_GRID_SIZE, EVOLUTION_CONVERSION_BASE_COST } from '../src/game/config'
import { maxLevelFor, powerCoreGeneratorCap, buyUpgrade } from '../src/game/upgrades'

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

  it("upgrade cost grows with the type's own UPGRADE_COST_GROWTH per level", () => {
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
    state.currency = new Decimal(BASE_COST.buff)
    placeCell(state, 0, 0, 'buff')
    expect(state.currency.toNumber()).toBe(0)
    expect(canUpgrade(state, 0, 0)).toBe(false)
    expect(upgradeCell(state, 0, 0)).toBe(false)
  })

  it('an evolved cell (basicCrit/basicSteady/buffStacker/buffAll) is always reported as maxed - no further leveling', () => {
    for (const type of ['basicCrit', 'basicSteady', 'buffStacker', 'buffAll'] as const) {
      expect(MAX_LEVEL[type]).toBe(0)
      expect(isMaxLevel(type, 10)).toBe(true) // whatever level it inherited from its pre-evolution self
      expect(isMaxLevel(type, 0)).toBe(true)
    }
  })

  it('currencyFor: Basic/Leech/Buff level-up in Energy, the Power Core Generator in Power Cores', () => {
    expect(currencyFor('basic')).toBe('energy')
    expect(currencyFor('leech')).toBe('energy')
    expect(currencyFor('buff')).toBe('energy')
    expect(currencyFor('powerCoreGenerator')).toBe('powerCores')
  })

  it('the Power Core Generator is free to place once a slot is available (Power Generator Count already paid for it) - only its own per-cell leveling costs Power Cores, and removing it refunds nothing (nothing was spent at placement)', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    state.powerCores = new Decimal(1e6)
    buyUpgrade(state, 'powerGeneratorCount', 1) // unlocks + grants 1 slot, Energy-priced

    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(true)
    expect(state.powerCores.toString()).toBe(new Decimal(1e6).toString()) // untouched - placement is free
    const currencyAfterUnlock = state.currency

    expect(upgradeCell(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 8)].level).toBe(1)
    expect(state.currency.toString()).toBe(currencyAfterUnlock.toString()) // leveling doesn't touch Energy
    expect(state.powerCores.lt(1e6)).toBe(true) // leveling spent Power Cores

    const powerCoresBeforeRemove = state.powerCores
    expect(removeCell(state, 0, 0)).toBe(true)
    expect(state.powerCores.toString()).toBe(powerCoresBeforeRemove.toString()) // no refund - placementCost was 0
    expect(state.currency.toString()).toBe(currencyAfterUnlock.toString())
  })

  it('placing a Power Core Generator fails with no slot available, even with abundant power cores - and is capped once slots run out', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    state.powerCores = new Decimal(1e9)
    expect(powerCoreGeneratorCap(state)).toBe(0)
    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 8)].type).toBe('empty')
    expect(canAffordPlacement(state, 'powerCoreGenerator')).toBe(false)

    buyUpgrade(state, 'powerGeneratorCount', 1) // cap = 1
    expect(placeCell(state, 0, 0, 'powerCoreGenerator')).toBe(true)
    expect(placeCell(state, 1, 0, 'powerCoreGenerator')).toBe(false) // cap reached

    buyUpgrade(state, 'powerGeneratorCount', 1) // cap = 2
    expect(placeCell(state, 1, 0, 'powerCoreGenerator')).toBe(true)
  })

  it('placing a Buff next to an existing producer auto-faces it', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'basic')
    placeCell(state, 1, 0, 'buff') // basic is to its left
    expect(state.cells[cellIndex(1, 0, 8)].facing).toBe('left')
  })

  it('placing a Buff with no adjacent producer still picks an in-bounds facing', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'buff')
    const facing = state.cells[cellIndex(0, 0, 8)].facing
    expect(['right', 'down']).toContain(facing) // up/left are off-board at (0,0)
  })

  it('a placed cell remembers what it actually cost, even as later placements get more expensive', () => {
    const state = makeGameState(8, 8)
    state.currency = new Decimal(1e6)
    placeCell(state, 0, 0, 'basic') // cost = BASE_COST.basic
    placeCell(state, 1, 0, 'basic') // cost = BASE_COST.basic * COST_GROWTH
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

describe('evolution', () => {
  function maxBasic(state: GameState, x: number, y: number): void {
    state.currency = state.currency.plus(1e15)
    placeCell(state, x, y, 'basic')
    for (let i = 0; i < MAX_LEVEL.basic; i++) upgradeCell(state, x, y)
  }
  function maxBuff(state: GameState, x: number, y: number): void {
    state.currency = state.currency.plus(1e15)
    placeCell(state, x, y, 'buff')
    for (let i = 0; i < MAX_LEVEL.buff; i++) upgradeCell(state, x, y)
  }

  it('canEvolve requires a maxed source cell of the matching family, a free slot, and enough power cores', () => {
    const state = makeGameState(4, 4)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'basic') // not maxed yet (level 0)
    state.powerCoreUpgrades.critTowerSlots = 5
    state.powerCoreUpgrades.basicSteadySlots = 5
    state.powerCores = new Decimal(1e9)
    expect(canEvolve(state, 0, 0, 'basicCrit')).toBe(false) // not maxed

    maxBasic(state, 1, 0)
    expect(canEvolve(state, 1, 0, 'basicCrit')).toBe(true)
    expect(canEvolve(state, 1, 0, 'basicSteady')).toBe(true) // same source family, different evolution
    expect(canEvolve(state, 1, 0, 'buffStacker')).toBe(false) // wrong source family (needs a maxed buff, not basic)

    state.powerCores = new Decimal(0)
    expect(canEvolve(state, 1, 0, 'basicCrit')).toBe(false) // can't afford the conversion fee

    state.powerCores = new Decimal(1e9)
    state.powerCoreUpgrades.critTowerSlots = 0
    expect(canEvolve(state, 1, 0, 'basicCrit')).toBe(false) // no slot
  })

  it('evolveCell converts in place, deducts the conversion fee, and preserves position/level/placementCost - only `type` changes', () => {
    const state = makeGameState(3, 3)
    maxBasic(state, 0, 0)
    state.powerCoreUpgrades.critTowerSlots = 1
    state.powerCores = new Decimal(1e9)
    const placementCostBefore = state.cells[cellIndex(0, 0, 3)].placementCost.toString()

    expect(evolveCell(state, 0, 0, 'basicCrit')).toBe(true)
    const cell = state.cells[cellIndex(0, 0, 3)]
    expect(cell.type).toBe('basicCrit')
    expect(cell.level).toBe(MAX_LEVEL.basic) // inherited unchanged, not reset
    expect(cell.placementCost.toString()).toBe(placementCostBefore) // untouched
    expect(state.powerCores.lt(1e9)).toBe(true) // conversion fee spent
  })

  it('evolveCell fails (and refunds nothing, changes nothing) when canEvolve would be false', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1e9)
    placeCell(state, 0, 0, 'basic') // not maxed
    state.powerCoreUpgrades.critTowerSlots = 5
    state.powerCores = new Decimal(1e9)
    const before = state.powerCores
    expect(evolveCell(state, 0, 0, 'basicCrit')).toBe(false)
    expect(state.cells[cellIndex(0, 0, 3)].type).toBe('basic')
    expect(state.powerCores.toString()).toBe(before.toString())
  })

  it('evolution slot caps are fully independent per type', () => {
    const state = makeGameState(4, 4)
    maxBasic(state, 0, 0)
    maxBasic(state, 1, 0)
    state.powerCores = new Decimal(1e12)
    state.powerCoreUpgrades.critTowerSlots = 1
    state.powerCoreUpgrades.basicSteadySlots = 1

    expect(evolveCell(state, 0, 0, 'basicCrit')).toBe(true)
    expect(evolutionSlotCap(state, 'basicCrit')).toBe(1)
    expect(canEvolve(state, 1, 0, 'basicCrit')).toBe(false) // Crit Tower slot already used

    // Basic Steady's own cap is untouched by Crit Tower's usage - independent.
    expect(canEvolve(state, 1, 0, 'basicSteady')).toBe(true)
    expect(evolveCell(state, 1, 0, 'basicSteady')).toBe(true)
  })

  it('conversion fee doubles per additional evolved instance of the SAME type, and drops back down if one is removed', () => {
    const state = makeGameState(5, 5)
    state.powerCoreUpgrades.critTowerSlots = 5
    state.powerCores = new Decimal(1e15)

    expect(evolutionConversionCost(state, 'basicCrit').toNumber()).toBeCloseTo(EVOLUTION_CONVERSION_BASE_COST, 6) // 0 on board

    maxBasic(state, 0, 0)
    evolveCell(state, 0, 0, 'basicCrit')
    expect(evolutionConversionCost(state, 'basicCrit').toNumber()).toBeCloseTo(EVOLUTION_CONVERSION_BASE_COST * 2, 6) // 1 on board

    maxBasic(state, 1, 0)
    evolveCell(state, 1, 0, 'basicCrit')
    expect(evolutionConversionCost(state, 'basicCrit').toNumber()).toBeCloseTo(EVOLUTION_CONVERSION_BASE_COST * 4, 6) // 2 on board

    // A different evolution type's cost is unaffected by basicCrit's count.
    expect(evolutionConversionCost(state, 'basicSteady').toNumber()).toBeCloseTo(EVOLUTION_CONVERSION_BASE_COST, 6)

    removeCell(state, 0, 0) // one fewer basicCrit on the board
    expect(evolutionConversionCost(state, 'basicCrit').toNumber()).toBeCloseTo(EVOLUTION_CONVERSION_BASE_COST * 2, 6) // back down to 1-on-board pricing
  })

  it("discoveredTypes marks a placeable type discovered the first time it's affordable, and it stays discovered even after the balance drops back down", () => {
    const state = makeGameState(3, 3)
    expect(state.discoveredTypes.basic).toBeUndefined()

    state.currency = new Decimal(0)
    updateDiscoveredTypes(state)
    expect(state.discoveredTypes.basic).toBeUndefined() // can't afford it yet

    state.currency = new Decimal(BASE_COST.basic)
    updateDiscoveredTypes(state)
    expect(state.discoveredTypes.basic).toBe(true)

    state.currency = new Decimal(0) // spend it back down
    updateDiscoveredTypes(state)
    expect(state.discoveredTypes.basic).toBe(true) // sticky - still discovered
  })

  it('placeCell also marks its own type discovered directly, independent of updateDiscoveredTypes', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1e9)
    expect(state.discoveredTypes.basic).toBeUndefined()
    placeCell(state, 0, 0, 'basic')
    expect(state.discoveredTypes.basic).toBe(true)
  })

  it('maxBuff/evolveCell also works for the Buff family (Buff Stacker / Buff All)', () => {
    const state = makeGameState(3, 3)
    maxBuff(state, 0, 0)
    state.powerCoreUpgrades.buffStackerSlots = 1
    state.powerCoreUpgrades.buffAllSlots = 1
    state.powerCores = new Decimal(1e9)

    expect(canEvolve(state, 0, 0, 'buffStacker')).toBe(true)
    expect(canEvolve(state, 0, 0, 'buffAll')).toBe(true)
    expect(canEvolve(state, 0, 0, 'basicCrit')).toBe(false) // wrong family

    expect(evolveCell(state, 0, 0, 'buffStacker')).toBe(true)
    expect(state.cells[cellIndex(0, 0, 3)].type).toBe('buffStacker')
    expect(state.cells[cellIndex(0, 0, 3)].level).toBe(MAX_LEVEL.buff)
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
    // Refunded in Energy, at the default 50% refund fraction.
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

function place(state: GameState, x: number, y: number, type: PlaceableType) {
  state.currency = state.currency.plus(1e9) // ensure affordable for setup
  placeCell(state, x, y, type)
}
