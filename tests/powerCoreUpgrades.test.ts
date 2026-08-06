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
  isPowerCoreUpgradeLocked,
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
      for (const fromLevel of [0, 1, 2]) {
        for (const count of [1, 2, 3]) {
          if (fromLevel + count > pcMaxLevelFor(id)) continue
          const closedForm = pcBulkUpgradeCost(id, fromLevel, count).toNumber()
          const bruteForce = bruteForceBulkCost(id, fromLevel, count).toNumber()
          expect(closedForm).toBeCloseTo(bruteForce, 4)
        }
      }
    }
  })

  it('costs strictly increase level over level for every upgrade (x10/level for the 4 slot upgrades)', () => {
    for (const id of POWER_CORE_UPGRADE_IDS) {
      if (pcMaxLevelFor(id) < 2) continue
      expect(pcUpgradeCostAt(id, 1).gt(pcUpgradeCostAt(id, 0))).toBe(true)
      expect(pcUpgradeCostAt(id, 2).gt(pcUpgradeCostAt(id, 1))).toBe(true)
    }
    // The 4 evolution-slot upgrades are confirmed to grow x10/level.
    for (const id of ['critTowerSlots', 'basicSteadySlots', 'buffStackerSlots', 'buffAllSlots'] as const) {
      expect(pcUpgradeCostAt(id, 1).div(pcUpgradeCostAt(id, 0)).toNumber()).toBeCloseTo(10, 6)
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
      const powerCores = pcUpgradeCostAt(id, 0).times(2.5)
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
  it('is all-or-nothing: deducts the exact bulk cost from powerCores (never touching currency) and advances the level', () => {
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e12)
    state.currency = new Decimal(777) // untouched throughout

    const cost = pcBulkUpgradeCost('critTowerSlots', 0, 3)
    expect(buyPowerCoreUpgrade(state, 'critTowerSlots', 3)).toBe(true)
    expect(state.powerCoreUpgrades.critTowerSlots).toBe(3)
    expect(state.powerCores.toString()).toBe(new Decimal(1e12).minus(cost).toString())
    expect(state.currency.toString()).toBe('777')

    state.powerCores = new Decimal(0)
    const before = state.powerCoreUpgrades.critTowerSlots
    expect(buyPowerCoreUpgrade(state, 'critTowerSlots', 1)).toBe(false)
    expect(state.powerCoreUpgrades.critTowerSlots).toBe(before) // unchanged, not a partial buy
  })

  it('refuses to buy past the max level', () => {
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e12)
    state.powerCoreUpgrades.buffAllSlots = pcMaxLevelFor('buffAllSlots')
    expect(buyPowerCoreUpgrade(state, 'buffAllSlots', 1)).toBe(false)
  })

  it('the 4 evolution-slot upgrades are fully independent - buying one never affects the others', () => {
    const state = makeGameState(3, 3)
    state.powerCores = new Decimal(1e12)
    expect(buyPowerCoreUpgrade(state, 'buffStackerSlots', 5)).toBe(true)
    expect(state.powerCoreUpgrades.buffStackerSlots).toBe(5)
    expect(state.powerCoreUpgrades.buffAllSlots).toBe(0)
    expect(state.powerCoreUpgrades.critTowerSlots).toBe(0)
    expect(state.powerCoreUpgrades.basicSteadySlots).toBe(0)
  })

  it('POWER_CORE_UPGRADE_MAX_LEVEL matches the confirmed level caps for every upgrade', () => {
    expect(POWER_CORE_UPGRADE_MAX_LEVEL).toEqual({
      gridSize: 3,
      critTowerSlots: 5,
      basicSteadySlots: 5,
      buffStackerSlots: 5,
      buffAllSlots: 5,
    })
  })
})

describe('isPowerCoreUpgradeLocked', () => {
  it('the 4 evolution-slot upgrades are locked at level 0 and unlock once a level is bought', () => {
    const state = makeGameState(3, 3)
    for (const id of ['critTowerSlots', 'basicSteadySlots', 'buffStackerSlots', 'buffAllSlots'] as const) {
      expect(isPowerCoreUpgradeLocked(state, id)).toBe(true)
    }
    state.powerCoreUpgrades.critTowerSlots = 1
    expect(isPowerCoreUpgradeLocked(state, 'critTowerSlots')).toBe(false)
  })

  it('gridSize is never locked, even at level 0', () => {
    const state = makeGameState(3, 3)
    expect(isPowerCoreUpgradeLocked(state, 'gridSize')).toBe(false)
  })
})
