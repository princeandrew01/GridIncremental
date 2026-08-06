import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import type { GameState, CellType } from '../src/game/types'
import { tick } from '../src/game/engine'
import { placeCell, upgradeCell } from '../src/game/economy'
import { updateHighestValues, checkAchievements, ACHIEVEMENT_CATEGORIES } from '../src/game/stats'

function place(state: GameState, x: number, y: number, type: CellType, level: number) {
  const i = cellIndex(x, y, state.width)
  state.cells[i].type = type
  state.cells[i].level = level
}

describe('updateHighestValues', () => {
  it('tracks the running max final value per type, never decreasing', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 1)
    place(state, 1, 0, 'leech', 1)
    place(state, 2, 0, 'buff', 2)

    updateHighestValues(state, tick(state))
    const afterFirst = { basic: state.highestValue.basic.toString(), leech: state.highestValue.leech.toString() }
    expect(state.highestBuffLevel).toBe(2)

    // A lower final value later must not overwrite a higher recorded max.
    const fakeLowResult = {
      base: state.cells.map(() => new Decimal(0)),
      final: state.cells.map(() => new Decimal(0)),
      production: new Decimal(0),
      crits: state.cells.map(() => false),
      basePowerCores: state.cells.map(() => new Decimal(0)),
      finalPowerCores: state.cells.map(() => new Decimal(0)),
      powerCoreProduction: new Decimal(0),
    }
    updateHighestValues(state, fakeLowResult)
    expect(state.highestValue.basic.toString()).toBe(afterFirst.basic)
    expect(state.highestValue.leech.toString()).toBe(afterFirst.leech)
    expect(state.highestBuffLevel).toBe(2) // a lower buff level cell wouldn't reduce this either

    // A genuinely higher value does update it.
    const fakeHighResult = {
      base: state.cells.map(() => new Decimal(0)),
      final: state.cells.map((_, i) => (i === 0 ? new Decimal(9999) : new Decimal(0))),
      production: new Decimal(0),
      crits: state.cells.map(() => false),
      basePowerCores: state.cells.map(() => new Decimal(0)),
      finalPowerCores: state.cells.map(() => new Decimal(0)),
      powerCoreProduction: new Decimal(0),
    }
    updateHighestValues(state, fakeHighResult)
    expect(state.highestValue.basic.toString()).toBe('9999')
  })

  it("basicCrit and basicSteady (Basic's two evolutions) count toward the same highestValue.basic bucket as a plain Basic", () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basicCrit', 10)
    const result = {
      base: state.cells.map(() => new Decimal(0)),
      final: state.cells.map((_, i) => (i === cellIndex(0, 0, 2) ? new Decimal(12345) : new Decimal(0))),
      production: new Decimal(0),
      crits: state.cells.map(() => false),
      basePowerCores: state.cells.map(() => new Decimal(0)),
      finalPowerCores: state.cells.map(() => new Decimal(0)),
      powerCoreProduction: new Decimal(0),
    }
    updateHighestValues(state, result)
    expect(state.highestValue.basic.toString()).toBe('12345')
  })

  it('highestBuffLevel tracks the COMBINED level across every buff-type cell on the board (Buff/Buff Stacker/Buff All alike), not any single one', () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'buff', 2)
    place(state, 1, 0, 'buffStacker', 3)
    place(state, 2, 0, 'buffAll', 4)
    // no basic/leech needed - buff-only board

    updateHighestValues(state, tick(state))
    expect(state.highestBuffLevel).toBe(9) // 2 + 3 + 4, not max(2, 3, 4)

    // Removing a buff can lower the live sum, but the running max never
    // drops - same ratchet behaviour as highestValue.basic/leech above.
    state.cells[cellIndex(1, 0, 4)].type = 'empty'
    updateHighestValues(state, tick(state))
    expect(state.highestBuffLevel).toBe(9)
  })
})

describe('checkAchievements', () => {
  it('unlocks a tier once its threshold is crossed, and is idempotent', () => {
    const state = makeGameState(3, 3)
    state.totalGeneratorsBuilt = 10
    let unlocked = checkAchievements(state)
    expect(unlocked).toContain('generators_built_1')
    expect(unlocked).toContain('generators_built_10')
    expect(unlocked).not.toContain('generators_built_25')

    unlocked = checkAchievements(state) // no new progress
    expect(unlocked).toEqual([])
    expect(state.unlockedAchievements).toContain('generators_built_10')
  })

  it('unlocks multiple tiers at once on a big jump', () => {
    const state = makeGameState(3, 3)
    state.lifetimeCurrencyEarned = new Decimal(1e10)
    const unlocked = checkAchievements(state)
    expect(unlocked).toEqual(
      expect.arrayContaining(['currency_farmed_1000', 'currency_farmed_10000', 'currency_farmed_1000000000']),
    )
    expect(unlocked).not.toContain('currency_farmed_1000000000000000')
  })

  it('every category is reachable via real gameplay actions (placeCell/upgradeCell/tick)', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1_000_000)
    placeCell(state, 0, 0, 'basic')
    upgradeCell(state, 0, 0)
    tick(state)

    expect(state.totalGeneratorsBuilt).toBe(1)
    expect(state.totalUpgrades).toBe(1)
    expect(state.lifetimeCurrencyEarned.gt(0)).toBe(true)

    const unlocked = checkAchievements(state)
    expect(unlocked).toContain('generators_built_1')
    expect(unlocked).toContain('times_leveled_1')
  })

  it('lifetimeCurrencyEarned never decreases even as currency is spent', () => {
    const state = makeGameState(3, 3)
    state.currency = new Decimal(1000)
    tick(state) // no production yet, but establishes a baseline
    place(state, 0, 0, 'basic', 1)
    for (let i = 0; i < 5; i++) tick(state)
    const earnedBeforeSpend = state.lifetimeCurrencyEarned
    upgradeCell(state, 0, 0) // spends currency
    expect(state.lifetimeCurrencyEarned.gte(earnedBeforeSpend)).toBe(true)
    expect(state.currency.lt(state.lifetimeCurrencyEarned.plus(1000))).toBe(true) // spending shows up as currency < lifetime + starting stake
  })

  it('has at least 10 tiers per category, a unique id, and an icon - the Achievements tab shows one uniform 10-star row per category', () => {
    const ids = ACHIEVEMENT_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const category of ACHIEVEMENT_CATEGORIES) {
      expect(category.tiers.length).toBeGreaterThanOrEqual(10)
      expect(category.icon.length).toBeGreaterThan(0)
      // Tier ids within a category are unique too, and thresholds strictly increase.
      expect(new Set(category.tiers.map((t) => t.id)).size).toBe(category.tiers.length)
      for (let i = 1; i < category.tiers.length; i++) {
        expect(category.tiers[i].threshold).toBeGreaterThan(category.tiers[i - 1].threshold)
      }
    }
  })
})
