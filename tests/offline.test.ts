import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import type { GameState, CellType, Facing } from '../src/game/types'
import { tick } from '../src/game/engine'
import { sumFloorDiv5, computeOfflineTicks, applyOfflineProgress } from '../src/game/offline'
import { MAX_OFFLINE_TICKS, TICK_MS } from '../src/game/config'

function place(state: GameState, x: number, y: number, type: CellType, level: number, facing?: Facing) {
  const i = cellIndex(x, y, state.width)
  state.cells[i].type = type
  state.cells[i].level = level
  if (facing) state.cells[i].facing = facing
}

function cloneState(state: GameState): GameState {
  return { ...state, cells: state.cells.map((c) => ({ ...c })) }
}

function buildInterestingBoard(): GameState {
  const state = makeGameState(5, 5)
  place(state, 0, 0, 'basic', 2)
  place(state, 4, 0, 'basic', 4)
  place(state, 1, 0, 'buff', 2, 'left') // targets the basic at (0,0)
  place(state, 3, 0, 'buff', 3, 'right') // targets the basic at (4,0)
  place(state, 2, 2, 'leech', 3) // whole board
  place(state, 0, 4, 'leech', 1) // orthogonal, mostly empty neighbours - fine
  state.currency = new Decimal(500)
  return state
}

function expectMatchesManualSimulation(offlineState: GameState, manualState: GameState): void {
  expect(offlineState.tickCount).toBe(manualState.tickCount)
  expect(offlineState.currency.toString()).toBe(manualState.currency.toString())
  for (let i = 0; i < offlineState.cells.length; i++) {
    expect(offlineState.cells[i].buffAccum.toString()).toBe(manualState.cells[i].buffAccum.toString())
  }
}

describe('sumFloorDiv5', () => {
  function naive(N: number): number {
    let sum = 0
    for (let j = 0; j < N; j++) sum += Math.floor(j / 5)
    return sum
  }

  it('matches a naive loop across a range of N', () => {
    for (const N of [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 23, 24, 25, 100, 137, 1000]) {
      expect(sumFloorDiv5(N)).toBe(naive(N))
    }
  })

  it('is 0 for N <= 0', () => {
    expect(sumFloorDiv5(0)).toBe(0)
    expect(sumFloorDiv5(-5)).toBe(0)
  })
})

describe('applyOfflineProgress', () => {
  it('6. closed-form total over N ticks equals running N ticks manually, for N = 1, 4, 5, 6, 100, 1000', () => {
    for (const N of [1, 4, 5, 6, 100, 1000]) {
      const offlineState = buildInterestingBoard()
      const manualState = cloneState(offlineState)

      applyOfflineProgress(offlineState, N)
      for (let i = 0; i < N; i++) tick(manualState)

      expectMatchesManualSimulation(offlineState, manualState)
    }
  })

  it('also matches manual simulation starting from a non-phase-aligned tickCount', () => {
    for (const N of [1, 4, 5, 6, 23, 100]) {
      const base = buildInterestingBoard()
      // Advance 3 real ticks first so tickCount % 5 !== 0 - not aligned to a
      // firing boundary, which is the case the closed form has to get right.
      tick(base)
      tick(base)
      tick(base)
      expect(base.tickCount % 5).not.toBe(0)

      const offlineState = cloneState(base)
      const manualState = cloneState(base)

      applyOfflineProgress(offlineState, N)
      for (let i = 0; i < N; i++) tick(manualState)

      expectMatchesManualSimulation(offlineState, manualState)
    }
  })

  it('N <= 0 is a no-op', () => {
    const state = buildInterestingBoard()
    const before = cloneState(state)
    const result = applyOfflineProgress(state, 0)
    expect(result.ticksApplied).toBe(0)
    expect(result.currencyGained.toString()).toBe('0')
    expect(state.tickCount).toBe(before.tickCount)
    expect(state.currency.toString()).toBe(before.currency.toString())
  })

  it('an empty board gains no currency but still advances tickCount', () => {
    const state = makeGameState(3, 3)
    const result = applyOfflineProgress(state, 50)
    expect(result.currencyGained.toString()).toBe('0')
    expect(state.tickCount).toBe(50)
  })
})

describe('computeOfflineTicks', () => {
  it('computes floor(elapsed / TICK_MS)', () => {
    const now = 1_700_000_000_000
    const lastSaved = now - 12_345 * TICK_MS
    expect(computeOfflineTicks(lastSaved, now)).toBe(12_345)
  })

  it('clamps to MAX_OFFLINE_TICKS for very long absences', () => {
    const now = 1_700_000_000_000
    const lastSaved = now - (MAX_OFFLINE_TICKS + 10_000) * TICK_MS
    expect(computeOfflineTicks(lastSaved, now)).toBe(MAX_OFFLINE_TICKS)
  })

  it('never goes negative for clock skew (lastSaved in the future)', () => {
    const now = 1_700_000_000_000
    expect(computeOfflineTicks(now + 10_000, now)).toBe(0)
  })
})
