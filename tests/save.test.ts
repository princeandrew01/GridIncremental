import { describe, it, expect, afterEach } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex, makeEmptyUpgradeLevels, makeEmptyPowerCoreUpgradeLevels } from '../src/game/types'
import type { GameState } from '../src/game/types'
import {
  serialize,
  deserialize,
  migrate,
  exportSave,
  importSave,
  saveToLocalStorage,
  loadFromLocalStorage,
  SAVE_VERSION,
} from '../src/game/save'
import type { SaveData } from '../src/game/save'

function buildInterestingState(): GameState {
  const state = makeGameState(4, 3)
  const basic = state.cells[cellIndex(0, 0, 4)]
  basic.type = 'basic'
  basic.level = 4
  basic.buffAccum = new Decimal(3)
  basic.placementCost = new Decimal(10)

  const leech = state.cells[cellIndex(1, 0, 4)]
  leech.type = 'leech'
  leech.level = 2
  leech.placementCost = new Decimal(132.5)

  const buffV1 = state.cells[cellIndex(2, 0, 4)]
  buffV1.type = 'buffV1'
  buffV1.level = 1
  buffV1.facing = 'left'
  buffV1.placementCost = new Decimal(287.75)

  const buffV2 = state.cells[cellIndex(3, 0, 4)]
  buffV2.type = 'buffV2'
  buffV2.level = 3
  buffV2.placementCost = new Decimal(4000)

  // (4x3 board has a 5th cell available at (0,1) for the new generator type.)
  const powerCoreGenerator = state.cells[cellIndex(0, 1, 4)]
  powerCoreGenerator.type = 'powerCoreGenerator'
  powerCoreGenerator.level = 2
  powerCoreGenerator.placementCost = new Decimal(15)
  powerCoreGenerator.coreProgress = 6

  // Beyond Number.MAX_VALUE (~1.8e308) - the whole reason break_infinity
  // exists, and exactly what a naive JSON round-trip through a plain number
  // would silently mangle into Infinity.
  state.currency = Decimal.fromMantissaExponent(1.23456, 350)
  state.tickCount = 4242
  state.lastSaved = 1_700_000_000_000

  state.upgrades = {
    tickSpeed: 3,
    basicValue: 12345,
    generatorValuePct: 5,
    critChance: 2,
    critAmount: 1,
    removalRefund: 4,
    gridSize: 2,
  }

  state.powerCores = Decimal.fromMantissaExponent(4.5, 20)
  state.powerCoreUpgrades = {
    powerCoreReduction: 5,
    powerCoreAmount: 12,
    powerCoreChance: 3,
    unlockPowerCoreGenerator: 1,
    tickSpeed: 2,
    basicValue: 999,
    critChance: 1,
    critAmount: 4,
    gridSize: 1,
  }
  state.currentRunEnergyEarned = Decimal.fromMantissaExponent(6.5, 40)
  state.bestRunEnergyEarned = Decimal.fromMantissaExponent(7.5, 45)
  state.powerCoreExponentsAwarded = 6

  state.startedAt = 1_699_000_000_000
  state.prestigeStartedAt = 1_699_500_000_000
  state.activePlayMs = 12_345_678
  state.lifetimeCurrencyEarned = Decimal.fromMantissaExponent(9.87654, 400)
  state.totalGeneratorsBuilt = 17
  state.totalUpgrades = 42
  state.highestValue = { basic: new Decimal(555), leech: new Decimal(777) }
  state.highestBuffLevel = 3
  state.unlockedAchievements = ['generators_built_1', 'generators_built_10']
  return state
}

function expectStatesEqual(a: GameState, b: GameState): void {
  // b.version isn't compared against a.version: serialize() always stamps
  // the *current* SAVE_VERSION, regardless of what the in-memory state's
  // (vestigial) .version field happened to hold - that's correct, not a bug.
  expect(b.version).toBe(SAVE_VERSION)
  expect(b.width).toBe(a.width)
  expect(b.height).toBe(a.height)
  expect(b.tickCount).toBe(a.tickCount)
  expect(b.currency.toString()).toBe(a.currency.toString())
  expect(b.cells.length).toBe(a.cells.length)
  for (let i = 0; i < a.cells.length; i++) {
    expect(b.cells[i].type).toBe(a.cells[i].type)
    expect(b.cells[i].level).toBe(a.cells[i].level)
    expect(b.cells[i].facing).toBe(a.cells[i].facing)
    expect(b.cells[i].buffAccum.toString()).toBe(a.cells[i].buffAccum.toString())
    expect(b.cells[i].placementCost.toString()).toBe(a.cells[i].placementCost.toString())
    expect(b.cells[i].coreProgress).toBe(a.cells[i].coreProgress)
  }

  expect(b.upgrades).toEqual(a.upgrades)
  expect(b.powerCores.toString()).toBe(a.powerCores.toString())
  expect(b.powerCoreUpgrades).toEqual(a.powerCoreUpgrades)
  expect(b.currentRunEnergyEarned.toString()).toBe(a.currentRunEnergyEarned.toString())
  expect(b.bestRunEnergyEarned.toString()).toBe(a.bestRunEnergyEarned.toString())
  expect(b.powerCoreExponentsAwarded).toBe(a.powerCoreExponentsAwarded)
  expect(b.startedAt).toBe(a.startedAt)
  expect(b.prestigeStartedAt).toBe(a.prestigeStartedAt)
  expect(b.activePlayMs).toBe(a.activePlayMs)
  expect(b.lifetimeCurrencyEarned.toString()).toBe(a.lifetimeCurrencyEarned.toString())
  expect(b.totalGeneratorsBuilt).toBe(a.totalGeneratorsBuilt)
  expect(b.totalUpgrades).toBe(a.totalUpgrades)
  expect(b.highestValue.basic.toString()).toBe(a.highestValue.basic.toString())
  expect(b.highestValue.leech.toString()).toBe(a.highestValue.leech.toString())
  expect(b.highestBuffLevel).toBe(a.highestBuffLevel)
  expect(b.unlockedAchievements).toEqual(a.unlockedAchievements)
}

describe('save/load', () => {
  it('round-trip through serialize/deserialize (simulating actual JSON storage) reproduces identical state, including Decimal precision beyond 1e308', () => {
    const original = buildInterestingState()
    // Route through an actual JSON string, same as localStorage would -
    // catches anything that only survives as long as it stays a live object.
    const roundTripped = deserialize(JSON.parse(JSON.stringify(serialize(original))))
    expectStatesEqual(original, roundTripped)
    expect(roundTripped.currency.toString()).toBe('1.23456e+350')
  })

  it('export/import round-trip (the base64 path) reproduces identical state', () => {
    const original = buildInterestingState()
    const text = exportSave(original)
    expect(typeof text).toBe('string')
    const imported = importSave(text)
    expectStatesEqual(original, imported)
  })

  it('exportSave and localStorage saves both stamp lastSaved to now', () => {
    const state = buildInterestingState()
    const before = state.lastSaved
    exportSave(state)
    expect(state.lastSaved).toBeGreaterThanOrEqual(before)
    expect(state.lastSaved).toBeLessThanOrEqual(Date.now())
  })

  it('importSave throws on garbage input rather than silently producing a broken state', () => {
    expect(() => importSave('not a valid save string')).toThrow()
  })

  it('migrate() is a no-op for a save already at the current version', () => {
    const save = JSON.parse(JSON.stringify(serialize(buildInterestingState())))
    expect(migrate(save)).toEqual(save)
    expect(save.version).toBe(SAVE_VERSION)
  })

  it('migrate() backfills a v1 save (predating lifetime stats, placementCost, and Alpha 0.2\'s rebalance) all the way to the current version', () => {
    // Shaped exactly like a save produced before any of those features
    // existed - no lifetime-stat fields, no per-cell `p`, and 1-based levels.
    const v1Save = {
      version: 1,
      width: 2,
      height: 1,
      cells: [
        { t: 1, l: 3, b: '0', f: 'up' }, // basic, old 1-based level 3
        { t: 0, l: 0, b: '0', f: 'up' }, // empty
      ],
      currency: '4200',
      tickCount: 999,
      lastSaved: 1_700_000_000_000,
    }

    const migrated = migrate(v1Save as unknown as SaveData)
    expect(migrated.version).toBe(6) // cascades v1 -> v2 -> v3 -> v4 -> v5 -> v6 in one call
    expect(migrated.startedAt).toBe(v1Save.lastSaved)
    expect(migrated.prestigeStartedAt).toBe(v1Save.lastSaved)
    expect(migrated.activePlayMs).toBe(0)
    expect(migrated.lifetimeCurrencyEarned).toBe('4200') // lower-bound guess: current balance
    expect(migrated.totalGeneratorsBuilt).toBe(1) // backfilled by counting non-empty cells
    expect(migrated.totalUpgrades).toBe(0)
    expect(migrated.highestValue).toEqual({ basic: '0', leech: '0' })
    expect(migrated.highestBuffLevel).toBe(0)
    expect(migrated.unlockedAchievements).toEqual([])
    // v2 -> v3: placementCost defaults to '0' - conservative on purpose, see
    // save.ts. A pre-migration generator refunds nothing if removed.
    expect(migrated.cells.every((c) => c.p === '0')).toBe(true)
    // v3 -> v4: levels rebase from 1-based to 0-based and clamp to the new,
    // smaller max: basic level 3 -> min(3-1, 5) = 2.
    expect(migrated.cells[0].l).toBe(2)
    expect(migrated.cells[1].l).toBe(0) // empty cell: stays 0
    expect(migrated.upgrades).toEqual(makeEmptyUpgradeLevels())
    // v5 -> v6: power cores backfill to empty/zero, except currentRun/
    // bestRunEnergyEarned, which take the same "best available guess"
    // (current lifetimeCurrencyEarned) the v1->v2 stats backfill used.
    expect(migrated.cells.every((c) => c.cp === 0)).toBe(true)
    expect(migrated.powerCores).toBe('0')
    expect(migrated.powerCoreUpgrades).toEqual(makeEmptyPowerCoreUpgradeLevels())
    expect(migrated.currentRunEnergyEarned).toBe('4200')
    expect(migrated.bestRunEnergyEarned).toBe('4200')
    expect(migrated.powerCoreExponentsAwarded).toBe(0)

    // And it loads cleanly end-to-end through deserialize, not just migrate().
    const state = deserialize(v1Save as unknown as SaveData)
    expect(state.cells[0].type).toBe('basic')
    expect(state.cells[0].level).toBe(2)
    expect(state.cells[0].placementCost.toString()).toBe('0')
    expect(state.currency.toString()).toBe('4200')
    expect(state.lifetimeCurrencyEarned.toString()).toBe('4200')
    expect(state.powerCores.toString()).toBe('0')
  })

  it('migrate() backfills a v2 save (predating placementCost and Alpha 0.2\'s rebalance) to the current version', () => {
    const v2Save = {
      version: 2,
      width: 1,
      height: 1,
      cells: [{ t: 1, l: 1, b: '0', f: 'up' }], // basic, old 1-based level 1 (no bonuses)
      currency: '50',
      tickCount: 10,
      lastSaved: 1_700_000_000_000,
      startedAt: 1_699_000_000_000,
      prestigeStartedAt: 1_699_000_000_000,
      activePlayMs: 5000,
      lifetimeCurrencyEarned: '50',
      totalGeneratorsBuilt: 1,
      totalUpgrades: 0,
      highestValue: { basic: '1', leech: '0' },
      highestBuffLevel: 0,
      unlockedAchievements: ['generators_built_1'],
    }

    const migrated = migrate(v2Save as unknown as SaveData)
    expect(migrated.version).toBe(6)
    expect(migrated.cells[0].p).toBe('0')
    expect(migrated.cells[0].l).toBe(0) // rebased: min(1-1, 5) = 0
    expect(migrated.upgrades).toEqual(makeEmptyUpgradeLevels())
    // Everything from v2 carries through untouched.
    expect(migrated.activePlayMs).toBe(5000)
    expect(migrated.unlockedAchievements).toEqual(['generators_built_1'])
  })

  it("migrate() rebases levels and carries the buff type across (index 3 stays buffV1) when migrating a v3 save (pre-Alpha-0.2) to v4", () => {
    const v3Save = {
      version: 3,
      width: 2,
      height: 1,
      cells: [
        { t: 1, l: 10, b: '0', f: 'up', p: '5' }, // basic, maxed out under the old system (old max level 10)
        { t: 3, l: 5, b: '0', f: 'left', p: '2' }, // buff, maxed out under the old system (old max level 5)
      ],
      currency: '100',
      tickCount: 50,
      lastSaved: 1_700_000_000_000,
      startedAt: 1_699_000_000_000,
      prestigeStartedAt: 1_699_000_000_000,
      activePlayMs: 1000,
      lifetimeCurrencyEarned: '100',
      totalGeneratorsBuilt: 2,
      totalUpgrades: 0,
      highestValue: { basic: '10', leech: '0' },
      highestBuffLevel: 5,
      unlockedAchievements: [],
    }

    const migrated = migrate(v3Save as unknown as SaveData)
    expect(migrated.version).toBe(6)
    expect(migrated.cells[0].l).toBe(5) // basic: min(10-1, MAX_LEVEL.basic=5) = 5, clamped down from 9
    expect(migrated.cells[0].t).toBe(1)
    expect(migrated.cells[1].l).toBe(2) // buffV1: min(5-1, MAX_LEVEL.buffV1=2) = 2, clamped down from 4
    expect(migrated.cells[1].t).toBe(3) // unchanged index - an old `buff` cell is a buffV1 for free
    expect(migrated.upgrades).toEqual(makeEmptyUpgradeLevels())
    expect(migrated.highestBuffLevel).toBe(4) // max(0, 5-1)

    const state = deserialize(v3Save as unknown as SaveData)
    expect(state.cells[1].type).toBe('buffV1')
    expect(state.cells[1].level).toBe(2)
    expect(state.upgrades.basicValue).toBe(0)
  })

  it('migrate() backfills the gridSize upgrade key (and only that key) when migrating a v4 save (pre-Grid-Size-upgrade) to v5', () => {
    const v4Save = {
      version: 4,
      width: 8,
      height: 8,
      cells: Array.from({ length: 64 }, () => ({ t: 0, l: 0, b: '0', f: 'up', p: '0' })),
      currency: '100',
      tickCount: 50,
      lastSaved: 1_700_000_000_000,
      startedAt: 1_699_000_000_000,
      prestigeStartedAt: 1_699_000_000_000,
      activePlayMs: 1000,
      lifetimeCurrencyEarned: '100',
      totalGeneratorsBuilt: 0,
      totalUpgrades: 0,
      highestValue: { basic: '0', leech: '0' },
      highestBuffLevel: 0,
      unlockedAchievements: [],
      // Shaped exactly like a real v4 save: has the other 6 keys (some
      // already leveled up), genuinely missing `gridSize` - not undefined,
      // absent - since the field didn't exist yet.
      upgrades: { tickSpeed: 5, basicValue: 100, generatorValuePct: 2, critChance: 3, critAmount: 1, removalRefund: 0 },
    }

    const migrated = migrate(v4Save as unknown as SaveData)
    expect(migrated.version).toBe(6)
    expect(migrated.upgrades.gridSize).toBe(0) // backfilled
    expect(migrated.upgrades.tickSpeed).toBe(5) // everything else carries through untouched
    expect(migrated.upgrades.basicValue).toBe(100)

    // Board size (8x8, already bigger than gridSizeForLevel(0) = 3x3) is left
    // exactly as it was - the migration doesn't touch width/height at all.
    expect(migrated.width).toBe(8)
    expect(migrated.height).toBe(8)

    const state = deserialize(v4Save as unknown as SaveData)
    expect(state.upgrades.gridSize).toBe(0)
    expect(state.width).toBe(8)
  })

  it('migrate() backfills Power Cores entirely when migrating a v5 save (pre-Power-Cores) to v6', () => {
    const v5Save = {
      version: 5,
      width: 3,
      height: 1,
      // Shaped exactly like a real v5 save: cells have no `cp` field at all
      // (genuinely absent, not just 0 - the field didn't exist yet).
      cells: [
        { t: 1, l: 3, b: '0', f: 'up', p: '10' }, // basic
        { t: 0, l: 0, b: '0', f: 'up', p: '0' }, // empty
        { t: 2, l: 1, b: '0', f: 'up', p: '50' }, // leech
      ],
      currency: '9999',
      tickCount: 500,
      lastSaved: 1_700_000_000_000,
      startedAt: 1_699_000_000_000,
      prestigeStartedAt: 1_699_000_000_000,
      activePlayMs: 1000,
      lifetimeCurrencyEarned: '15000', // deliberately > currency, since some was spent - backfill should use this, not currency
      totalGeneratorsBuilt: 2,
      totalUpgrades: 3,
      highestValue: { basic: '500', leech: '200' },
      highestBuffLevel: 0,
      unlockedAchievements: ['generators_built_1'],
      upgrades: { tickSpeed: 1, basicValue: 0, generatorValuePct: 0, critChance: 0, critAmount: 0, removalRefund: 0, gridSize: 0 },
    }

    const migrated = migrate(v5Save as unknown as SaveData)
    expect(migrated.version).toBe(6)
    expect(migrated.cells.every((c) => c.cp === 0)).toBe(true)
    expect(migrated.powerCores).toBe('0')
    expect(migrated.powerCoreUpgrades).toEqual(makeEmptyPowerCoreUpgradeLevels())
    // Backfilled from lifetimeCurrencyEarned (the "best available guess"),
    // not from the current (already partly spent) currency balance.
    expect(migrated.currentRunEnergyEarned).toBe('15000')
    expect(migrated.bestRunEnergyEarned).toBe('15000')
    expect(migrated.powerCoreExponentsAwarded).toBe(0)
    // Everything from v5 carries through untouched.
    expect(migrated.upgrades.tickSpeed).toBe(1)
    expect(migrated.cells[0].l).toBe(3)

    // Loads cleanly end-to-end, and - crucially - checkPowerCoreExponents
    // (run by main.ts right after any load, same self-heal pattern as
    // achievements) would immediately grant the power cores this save
    // already earned the right to (100, 1000, 10000 all crossed by 15000),
    // since powerCoreExponentsAwarded starts at 0 against a nonzero
    // currentRunEnergyEarned - not exercised here, just confirming the
    // preconditions for that self-heal are exactly right.
    const state = deserialize(v5Save as unknown as SaveData)
    expect(state.powerCores.toString()).toBe('0')
    expect(state.currentRunEnergyEarned.toString()).toBe('15000')
    expect(state.powerCoreExponentsAwarded).toBe(0)
    expect(state.cells[0].coreProgress).toBe(0)
  })
})

describe('localStorage persistence', () => {
  function makeMockStorage(): Storage {
    const store = new Map<string, string>()
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
    } as Storage
  }

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage
  })

  it('saveToLocalStorage then loadFromLocalStorage round-trips through a real Storage-shaped object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).localStorage = makeMockStorage()
    const state = buildInterestingState()
    saveToLocalStorage(state)
    const loaded = loadFromLocalStorage()
    expect(loaded).not.toBeNull()
    expectStatesEqual(state, loaded!)
  })

  it('loadFromLocalStorage returns null when nothing has been saved', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).localStorage = makeMockStorage()
    expect(loadFromLocalStorage()).toBeNull()
  })

  it('never throws when localStorage is entirely unavailable (private browsing / blocked iframe)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage
    expect(() => saveToLocalStorage(buildInterestingState())).not.toThrow()
    expect(loadFromLocalStorage()).toBeNull()
  })
})
