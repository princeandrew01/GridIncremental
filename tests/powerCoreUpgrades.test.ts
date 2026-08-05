import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState } from '../src/game/types'
import {
  POWER_CORE_UPGRADE_IDS,
  pcUpgradeCostAt,
  pcBulkUpgradeCost,
  pcMaxAffordableCount,
  pcMaxLevelFor,
  buyPowerCoreUpgrade,
} from '../src/game/powerCoreUpgrades'
import { POWER_CORE_UPGRADE_MAX_LEVEL } from '../src/game/config'
import type { PowerCoreUpgradeId } from '../src/game/types'

// Brute-force sum, one level at a time - the thing pcBulkUpgradeCost's closed
// form has to agree with, for both cost-curve kinds (mirrors upgrades.test.ts's
// own bruteForceBulkCost for the Energy side).
function bruteForceBulkCost(id: PowerCoreUpgradeId, fromLevel: number, count: number): Decimal {
  let total = new Decimal(0)
  for (let i = 0; i < count; i++) total = total.plus(pcUpgradeCostAt(id, fromLevel + i))
  return total
}

describe('pcUpgradeCostAt / pcBulkUpgradeCost', () => {
  it('matches a brute-force per-level sum for every upgrade, across a range of starting levels and counts', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      for (const fromLevel of [0, 1, 5, 20]) {
        for (const count of [1, 3, 10]) {
          if (fromLevel + count > pcMaxLevelFor(id)) continue
          const closedForm = pcBulkUpgradeCost(id, fromLevel, count).toNumber()
          const bruteForce = bruteForceBulkCost(id, fromLevel, count).toNumber()
          expect(closedForm).toBeCloseTo(bruteForce, 4)
        }
      }
    }
  })

  it("matches a brute-force sum near the top of basicValue's 999,999-level range (quadratic curve)", () => {
    const fromLevel = 999_900
    const count = 50
    const closedForm = pcBulkUpgradeCost('basicValue', fromLevel, count).toNumber()
    const bruteForce = bruteForceBulkCost('basicValue', fromLevel, count).toNumber()
    expect(closedForm / bruteForce).toBeCloseTo(1, 9)
  })

  it('costs strictly increase level over level for every upgrade (no flat pricing left)', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      if (pcMaxLevelFor(id) < 2) continue // unlockPowerCoreGenerator only ever buys one level
      expect(pcUpgradeCostAt(id, 1).gt(pcUpgradeCostAt(id, 0))).toBe(true)
      expect(pcUpgradeCostAt(id, 5).gt(pcUpgradeCostAt(id, 1))).toBe(true)
    }
  })

  it('is 0 for count <= 0', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      expect(pcBulkUpgradeCost(id, 0, 0).toNumber()).toBe(0)
      expect(pcBulkUpgradeCost(id, 5, -3).toNumber()).toBe(0)
    }
  })
})

describe('pcMaxAffordableCount', () => {
  it('returns the largest count whose bulk cost is affordable, and one more is not', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      const powerCores = pcUpgradeCostAt(id, 0).times(5.5) // enough for a handful of levels
      const n = pcMaxAffordableCount(id, 0, powerCores)
      expect(pcBulkUpgradeCost(id, 0, n).lte(powerCores)).toBe(true)
      if (n < pcMaxLevelFor(id)) {
        expect(pcBulkUpgradeCost(id, 0, n + 1).gt(powerCores)).toBe(true)
      }
    }
  })

  it('is 0 with no power cores, and 0 once already at the max level', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      expect(pcMaxAffordableCount(id, 0, new Decimal(0))).toBe(0)
      expect(pcMaxAffordableCount(id, pcMaxLevelFor(id), new Decimal(1e30))).toBe(0)
    }
  })

  it('never exceeds the distance to the max level, however many power cores are available', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      expect(pcMaxAffordableCount(id, 0, new Decimal(1e50))).toBe(pcMaxLevelFor(id))
    }
  })
})

describe('buyPowerCoreUpgrade', () => {
  it('is all-or-nothing: deducts the exact flat bulk cost from powerCores (never touching currency) and advances the level', () => {
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e6)
    state.currency = new Decimal(777) // untouched throughout

    const cost = pcBulkUpgradeCost('critChance', 0, 5)
    expect(buyPowerCoreUpgrade(state, 'critChance', 5)).toBe(true)
    expect(state.powerCoreUpgrades.critChance).toBe(5)
    expect(state.powerCores.toString()).toBe(new Decimal(1e6).minus(cost).toString())
    expect(state.currency.toString()).toBe('777')

    state.powerCores = new Decimal(0)
    const before = state.powerCoreUpgrades.critChance
    expect(buyPowerCoreUpgrade(state, 'critChance', 1)).toBe(false)
    expect(state.powerCoreUpgrades.critChance).toBe(before) // unchanged, not a partial buy
  })

  it('refuses to buy past the max level', () => {
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e9)
    state.powerCoreUpgrades.powerCoreChance = pcMaxLevelFor('powerCoreChance')
    expect(buyPowerCoreUpgrade(state, 'powerCoreChance', 1)).toBe(false)
  })

  it('unlockPowerCoreGenerator has max level 1 - a one-shot gate, not a leveled stat', () => {
    expect(pcMaxLevelFor('unlockPowerCoreGenerator')).toBe(1)
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e9)
    expect(buyPowerCoreUpgrade(state, 'unlockPowerCoreGenerator', 1)).toBe(true)
    expect(buyPowerCoreUpgrade(state, 'unlockPowerCoreGenerator', 1)).toBe(false) // already at max
  })

  it('POWER_CORE_UPGRADE_MAX_LEVEL matches the confirmed level caps for every upgrade', () => {
    expect(POWER_CORE_UPGRADE_MAX_LEVEL).toEqual({
      powerCoreReduction: 25,
      powerCoreAmount: 99,
      powerCoreChance: 25,
      unlockPowerCoreGenerator: 1,
      tickSpeed: 25,
      basicValue: 999_999,
      critChance: 25,
      critAmount: 25,
      gridSize: 3,
    })
  })
})
