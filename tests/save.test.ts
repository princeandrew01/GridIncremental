import { describe, it, expect, afterEach } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
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

function buildInterestingState(): GameState {
  const state = makeGameState(4, 3)
  const basic = state.cells[cellIndex(0, 0, 4)]
  basic.type = 'basic'
  basic.level = 7
  basic.buffAccum = new Decimal(3)
  basic.placementCost = new Decimal(10)

  const leech = state.cells[cellIndex(1, 0, 4)]
  leech.type = 'leech'
  leech.level = 3
  leech.placementCost = new Decimal(132.5)

  const buff = state.cells[cellIndex(2, 0, 4)]
  buff.type = 'buff'
  buff.level = 4
  buff.facing = 'left'
  buff.placementCost = new Decimal(287.75)

  // Beyond Number.MAX_VALUE (~1.8e308) - the whole reason break_infinity
  // exists, and exactly what a naive JSON round-trip through a plain number
  // would silently mangle into Infinity.
  state.currency = Decimal.fromMantissaExponent(1.23456, 350)
  state.tickCount = 4242
  state.lastSaved = 1_700_000_000_000

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
  }

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
  it('7. round-trip through serialize/deserialize (simulating actual JSON storage) reproduces identical state, including Decimal precision beyond 1e308', () => {
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

  it('migrate() backfills a v1 save (predating lifetime stats and placementCost) all the way to the current version', () => {
    // Shaped exactly like a save produced before either feature existed - no
    // lifetime-stat fields and no per-cell `p`, not just missing/undefined.
    const v1Save = {
      version: 1,
      width: 2,
      height: 1,
      cells: [
        { t: 1, l: 3, b: '0', f: 'up' }, // basic
        { t: 0, l: 0, b: '0', f: 'up' }, // empty
      ],
      currency: '4200',
      tickCount: 999,
      lastSaved: 1_700_000_000_000,
    }

    const migrated = migrate(v1Save as unknown as import('../src/game/save').SaveData)
    expect(migrated.version).toBe(3) // cascades v1 -> v2 -> v3 in one call
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

    // And it loads cleanly end-to-end through deserialize, not just migrate().
    const state = deserialize(v1Save as unknown as import('../src/game/save').SaveData)
    expect(state.cells[0].type).toBe('basic')
    expect(state.cells[0].level).toBe(3)
    expect(state.cells[0].placementCost.toString()).toBe('0')
    expect(state.currency.toString()).toBe('4200')
    expect(state.lifetimeCurrencyEarned.toString()).toBe('4200')
  })

  it('migrate() backfills a v2 save (predating placementCost) to v3', () => {
    const v2Save = {
      version: 2,
      width: 1,
      height: 1,
      cells: [{ t: 1, l: 1, b: '0', f: 'up' }],
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

    const migrated = migrate(v2Save as unknown as import('../src/game/save').SaveData)
    expect(migrated.version).toBe(3)
    expect(migrated.cells[0].p).toBe('0')
    // Everything from v2 carries through untouched.
    expect(migrated.activePlayMs).toBe(5000)
    expect(migrated.unlockedAchievements).toEqual(['generators_built_1'])
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
