import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState } from '../src/game/types'
import type { UpgradeId } from '../src/game/types'
import {
  UPGRADE_IDS,
  upgradeCostAt,
  bulkUpgradeCost,
  maxAffordableCount,
  buyUpgrade,
  maxLevelFor,
  basicValueBonus,
  generatorValueMultiplier,
  critChanceFor,
  critAmountFor,
  refundFraction,
  effectiveTickMs,
  gridSizeForLevel,
  totalGridSizeLevel,
  isPowerCoreGeneratorUnlocked,
  powerCoreGeneratorCap,
} from '../src/game/upgrades'
import { buyPowerCoreUpgrade, pcMaxLevelFor } from '../src/game/powerCoreUpgrades'
import {
  CRIT_BASE_CHANCE,
  CRIT_BASE_AMOUNT,
  CRIT_CHANCE_UPGRADE_PER_LEVEL,
  CRIT_AMOUNT_UPGRADE_PER_LEVEL,
  CRIT_TOWER_CHANCE_BONUS,
  CRIT_TOWER_AMOUNT_MULT,
  GENERATOR_VALUE_PCT_PER_LEVEL,
  BASIC_VALUE_PER_LEVEL,
  REMOVE_REFUND_FRACTION,
  REMOVAL_REFUND_PER_LEVEL,
  TICK_MS,
  TICK_SPEED_MS_PER_LEVEL,
  GRID_W,
  GRID_H,
  GRID_SIZE_PER_LEVEL,
  PC_GRID_SIZE_PER_LEVEL,
  MAX_GRID_SIZE,
} from '../src/game/config'

// Brute-force sum, one level at a time - the thing bulkUpgradeCost's closed
// form has to agree with, for both cost-curve kinds.
function bruteForceBulkCost(id: UpgradeId, fromLevel: number, count: number): Decimal {
  let total = new Decimal(0)
  for (let i = 0; i < count; i++) total = total.plus(upgradeCostAt(id, fromLevel + i))
  return total
}

describe('bulkUpgradeCost', () => {
  it('matches a brute-force per-level sum for every upgrade, across a range of starting levels and counts', () => {
    for (const id of UPGRADE_IDS) {
      for (const fromLevel of [0, 1, 5, 20]) {
        for (const count of [1, 3, 10]) {
          if (fromLevel + count > maxLevelFor(id)) continue
          const closedForm = bulkUpgradeCost(id, fromLevel, count).toNumber()
          const bruteForce = bruteForceBulkCost(id, fromLevel, count).toNumber()
          expect(closedForm).toBeCloseTo(bruteForce, 4)
        }
      }
    }
  })

  it('matches a brute-force sum near the top of basicValue\'s 999,999-level range (quadratic curve)', () => {
    const fromLevel = 999_900
    const count = 50
    const closedForm = bulkUpgradeCost('basicValue', fromLevel, count).toNumber()
    const bruteForce = bruteForceBulkCost('basicValue', fromLevel, count).toNumber()
    // Float64 has ~15-17 significant digits; at this magnitude (~1e16) that's
    // still several digits of comfortable relative precision - see the
    // comment on bulkUpgradeCost in upgrades.ts.
    expect(closedForm / bruteForce).toBeCloseTo(1, 9)
  })

  it('is 0 for count <= 0', () => {
    for (const id of UPGRADE_IDS) {
      expect(bulkUpgradeCost(id, 0, 0).toNumber()).toBe(0)
      expect(bulkUpgradeCost(id, 5, -3).toNumber()).toBe(0)
    }
  })
})

describe('maxAffordableCount', () => {
  it('returns the largest count whose bulk cost is affordable, and one more is not', () => {
    for (const id of UPGRADE_IDS) {
      const currency = new Decimal(upgradeCostAt(id, 0)).times(5.5) // enough for a handful of levels
      const n = maxAffordableCount(id, 0, currency)
      expect(bulkUpgradeCost(id, 0, n).lte(currency)).toBe(true)
      if (n < maxLevelFor(id)) {
        expect(bulkUpgradeCost(id, 0, n + 1).gt(currency)).toBe(true)
      }
    }
  })

  it('is 0 with no currency, and 0 once already at the max level', () => {
    for (const id of UPGRADE_IDS) {
      expect(maxAffordableCount(id, 0, new Decimal(0))).toBe(0)
      expect(maxAffordableCount(id, maxLevelFor(id), new Decimal(1e30))).toBe(0)
    }
  })

  it('never exceeds the distance to the max level, however much currency is available', () => {
    for (const id of UPGRADE_IDS) {
      const n = maxAffordableCount(id, 0, new Decimal(1e50))
      expect(n).toBe(maxLevelFor(id))
    }
  })
})

describe('buyUpgrade', () => {
  it('is all-or-nothing: deducts the exact bulk cost and advances the level, or changes nothing at all', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1e9)
    const cost = bulkUpgradeCost('critChance', 0, 5)
    expect(buyUpgrade(state, 'critChance', 5)).toBe(true)
    expect(state.upgrades.critChance).toBe(5)
    expect(state.currency.toString()).toBe(new Decimal(1e9).minus(cost).toString())

    state.currency = new Decimal(0)
    const before = state.upgrades.critChance
    expect(buyUpgrade(state, 'critChance', 1)).toBe(false)
    expect(state.upgrades.critChance).toBe(before) // unchanged, not a partial buy
  })

  it('refuses to buy past the max level', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1e60)
    state.upgrades.removalRefund = maxLevelFor('removalRefund')
    expect(buyUpgrade(state, 'removalRefund', 1)).toBe(false)
  })

  it('buying gridSize levels grows the board to match, on top of the normal level/cost bookkeeping', () => {
    const state = makeGameState(GRID_W, GRID_H) // starting 4x4
    state.currency = new Decimal(1e30)

    expect(buyUpgrade(state, 'gridSize', 2)).toBe(true)
    expect(state.upgrades.gridSize).toBe(2)
    expect(state.width).toBe(gridSizeForLevel(2))
    expect(state.height).toBe(gridSizeForLevel(2))

    expect(buyUpgrade(state, 'gridSize', 1)).toBe(true) // up to the max (3)
    expect(state.upgrades.gridSize).toBe(3)
    expect(state.width).toBe(gridSizeForLevel(3))
    expect(gridSizeForLevel(3)).toBe(7) // 4x4 -> 7x7 at this track's max alone (10x10 needs Power Core's track too)
  })

  it("buying gridSize never shrinks a board that's already bigger than the target (e.g. a migrated save)", () => {
    const state = makeGameState(8, 8) // already bigger than what a low gridSize level would target
    state.currency = new Decimal(1e30)
    expect(buyUpgrade(state, 'gridSize', 1)).toBe(true) // targets gridSizeForLevel(1) = 5x5
    expect(state.width).toBe(8) // unchanged - resizeGrid() never shrinks
    expect(state.height).toBe(8)
  })

  it('gridSizeForLevel is GRID_W plus GRID_SIZE_PER_LEVEL per level', () => {
    expect(gridSizeForLevel(0)).toBe(GRID_W)
    expect(gridSizeForLevel(maxLevelFor('gridSize'))).toBe(GRID_W + maxLevelFor('gridSize') * GRID_SIZE_PER_LEVEL)
  })

  it('buying powerGeneratorCount both raises the cap and is what unlocks the Power Core Generator at all', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1e30)
    expect(isPowerCoreGeneratorUnlocked(state)).toBe(false)
    expect(powerCoreGeneratorCap(state)).toBe(0)

    expect(buyUpgrade(state, 'powerGeneratorCount', 1)).toBe(true)
    expect(isPowerCoreGeneratorUnlocked(state)).toBe(true)
    expect(powerCoreGeneratorCap(state)).toBe(1)

    expect(buyUpgrade(state, 'powerGeneratorCount', 2)).toBe(true)
    expect(powerCoreGeneratorCap(state)).toBe(3)
  })
})

describe('effect accessors', () => {
  it('basicValueBonus and generatorValueMultiplier read directly off their upgrade levels', () => {
    const state = makeGameState(1, 1)
    expect(basicValueBonus(state)).toBe(0)
    expect(generatorValueMultiplier(state)).toBe(1)

    state.upgrades.basicValue = 7
    state.upgrades.generatorValuePct = 3
    expect(basicValueBonus(state)).toBe(7 * BASIC_VALUE_PER_LEVEL)
    expect(generatorValueMultiplier(state)).toBeCloseTo(1 + 3 * GENERATOR_VALUE_PCT_PER_LEVEL, 12)
  })

  it('critChanceFor: global base + the Crit Chance upgrade, plus the Crit Generator bonus only when isCritTower is true', () => {
    const state = makeGameState(1, 1)
    expect(critChanceFor(state, false)).toBeCloseTo(CRIT_BASE_CHANCE, 12)
    expect(critChanceFor(state, true)).toBeCloseTo(CRIT_BASE_CHANCE + CRIT_TOWER_CHANCE_BONUS, 12)

    state.upgrades.critChance = 10
    const expected = CRIT_BASE_CHANCE + CRIT_CHANCE_UPGRADE_PER_LEVEL * 10
    expect(critChanceFor(state, false)).toBeCloseTo(expected, 12)
    expect(critChanceFor(state, true)).toBeCloseTo(expected + CRIT_TOWER_CHANCE_BONUS, 12)
  })

  it('critAmountFor: global amount x the Crit Generator multiplier only when isCritTower is true', () => {
    const state = makeGameState(1, 1)
    expect(critAmountFor(state, false)).toBeCloseTo(CRIT_BASE_AMOUNT, 12)
    expect(critAmountFor(state, true)).toBeCloseTo(CRIT_BASE_AMOUNT * CRIT_TOWER_AMOUNT_MULT, 9)

    state.upgrades.critAmount = 10 // maxed
    const globalAmount = CRIT_BASE_AMOUNT + 10 * CRIT_AMOUNT_UPGRADE_PER_LEVEL
    expect(critAmountFor(state, false)).toBeCloseTo(globalAmount, 12)
    expect(critAmountFor(state, true)).toBeCloseTo(globalAmount * CRIT_TOWER_AMOUNT_MULT, 9)
  })

  it('refundFraction rises with the Removal Refund upgrade and caps at 1 (100%)', () => {
    const state = makeGameState(1, 1)
    expect(refundFraction(state)).toBeCloseTo(REMOVE_REFUND_FRACTION, 12)

    state.upgrades.removalRefund = maxLevelFor('removalRefund')
    expect(refundFraction(state)).toBeCloseTo(1, 12)
    expect(REMOVE_REFUND_FRACTION + maxLevelFor('removalRefund') * REMOVAL_REFUND_PER_LEVEL).toBeCloseTo(1, 12)
  })

  it('effectiveTickMs shortens by TICK_SPEED_MS_PER_LEVEL per level (Energy-only now - the old Power Core Tick Speed track is gone)', () => {
    const state = makeGameState(1, 1)
    expect(effectiveTickMs(state)).toBe(TICK_MS)

    state.upgrades.tickSpeed = 25
    expect(effectiveTickMs(state)).toBe(TICK_MS - 25 * TICK_SPEED_MS_PER_LEVEL)
  })

  it('totalGridSizeLevel adds both tracks, and buying either one resizes the board to the combined total (Grid Size is the one Power Core upgrade that survived unchanged)', () => {
    const state = makeGameState(GRID_W, GRID_H)
    state.currency = new Decimal(1e30)
    state.powerCores = new Decimal(1e9)

    expect(totalGridSizeLevel(state)).toBe(0)
    buyUpgrade(state, 'gridSize', 2) // energy: level 2
    expect(totalGridSizeLevel(state)).toBe(2)
    expect(state.width).toBe(gridSizeForLevel(2))

    buyPowerCoreUpgrade(state, 'gridSize', 3) // power core: level 3, combined 5
    expect(totalGridSizeLevel(state)).toBe(5)
    expect(state.width).toBe(gridSizeForLevel(5))
    expect(state.height).toBe(gridSizeForLevel(5))
  })

  it('MAX_GRID_SIZE matches what both Grid Size tracks maxed out actually add up to - the number economy.ts healGridSize shrinks legacy oversized boards down to', () => {
    const maxCombinedLevel = maxLevelFor('gridSize') + pcMaxLevelFor('gridSize') * PC_GRID_SIZE_PER_LEVEL
    expect(gridSizeForLevel(maxCombinedLevel)).toBe(MAX_GRID_SIZE)
  })
})
