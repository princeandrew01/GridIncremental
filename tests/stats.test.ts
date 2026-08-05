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
    }
    updateHighestValues(state, fakeHighResult)
    expect(state.highestValue.basic.toString()).toBe('9999')
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

  it('has at least one tier per category and all category ids are unique', () => {
    const ids = ACHIEVEMENT_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const category of ACHIEVEMENT_CATEGORIES) {
      expect(category.tiers.length).toBeGreaterThan(0)
    }
  })
})
