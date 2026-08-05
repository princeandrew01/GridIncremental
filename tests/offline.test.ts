import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import type { GameState, CellType, Facing } from '../src/game/types'
import { recalculate, advanceBuffs, expectedCritMultipliers } from '../src/game/engine'
import { sumFloorDiv5, computeOfflineTicks, applyOfflineProgress } from '../src/game/offline'
import { MAX_OFFLINE_TICKS, TICK_MS, BUFF_TICK_INTERVAL, OFFLINE_CRIT_VARIANCE } from '../src/game/config'

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
  place(state, 1, 0, 'buffV1', 1, 'left') // level 1: targets the basic at (0,0) plus its (off-board) opposite
  place(state, 3, 0, 'buffV1', 0, 'right') // level 0: targets the basic at (4,0)
  place(state, 2, 2, 'leech', 2) // whole board
  place(state, 0, 4, 'leech', 0) // orthogonal, mostly empty neighbours - fine
  state.currency = new Decimal(500)
  return state
}

// rng() = 0.5 makes applyOfflineProgress's ±OFFLINE_CRIT_VARIANCE roll exactly
// neutral (varianceFactor = 1 + (0.5*2-1)*variance = 1), so its output is the
// pure closed-form expected value with no randomness layered on top -
// necessary to compare it exactly against a manual simulation.
const NEUTRAL_RNG = () => 0.5

/**
 * Mirrors engine.ts's tick() bookkeeping exactly, but uses the same constant
 * expectedCritMultipliers() applyOfflineProgress uses instead of a real
 * per-tick dice roll. This is the correct invariant to check now that crit
 * exists: applyOfflineProgress never claims to reproduce any particular
 * *realized* random sequence (that's the whole point of a closed form - no
 * per-tick simulation) - it claims to reproduce the exact expected value.
 * expectedCritMultipliers is itself constant across the whole gap (it
 * depends only on upgrades and each Basic's own level, neither of which
 * changes here), so this manual loop is a fair independent check of the
 * same linear-in-firings-so-far math applyOfflineProgress relies on.
 */
function manualExpectedSimulate(state: GameState, N: number): void {
  const multipliers = expectedCritMultipliers(state)
  for (let i = 0; i < N; i++) {
    state.tickCount += 1
    if (state.tickCount % BUFF_TICK_INTERVAL === 0) advanceBuffs(state)
    const result = recalculate(state, multipliers)
    state.currency = state.currency.plus(result.production)
    state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  }
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
  it('regression: closed-form total (expected-value crit, variance neutralised) matches an expected-value manual simulation exactly, for N = 1, 4, 5, 6, 100, 1000', () => {
    for (const N of [1, 4, 5, 6, 100, 1000]) {
      const offlineState = buildInterestingBoard()
      const manualState = cloneState(offlineState)

      applyOfflineProgress(offlineState, N, NEUTRAL_RNG)
      manualExpectedSimulate(manualState, N)

      expectMatchesManualSimulation(offlineState, manualState)
    }
  })

  it('also matches manual simulation starting from a non-phase-aligned tickCount', () => {
    for (const N of [1, 4, 5, 6, 23, 100]) {
      const base = buildInterestingBoard()
      // Advance 3 ticks first so tickCount % 5 !== 0 - not aligned to a
      // firing boundary, which is the case the closed form has to get right.
      manualExpectedSimulate(base, 3)
      expect(base.tickCount % 5).not.toBe(0)

      const offlineState = cloneState(base)
      const manualState = cloneState(base)

      applyOfflineProgress(offlineState, N, NEUTRAL_RNG)
      manualExpectedSimulate(manualState, N)

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
    const result = applyOfflineProgress(state, 50, NEUTRAL_RNG)
    expect(result.currencyGained.toString()).toBe('0')
    expect(state.tickCount).toBe(50)
  })

  it('the variance roll stays within +/- OFFLINE_CRIT_VARIANCE of the neutral (expected-value) total', () => {
    const neutralState = buildInterestingBoard()
    const neutralResult = applyOfflineProgress(neutralState, 500, NEUTRAL_RNG)

    for (const rngValue of [0, 0.25, 0.75, 1]) {
      const state = buildInterestingBoard()
      const result = applyOfflineProgress(state, 500, () => rngValue)
      const ratio = result.currencyGained.div(neutralResult.currencyGained).toNumber()
      expect(ratio).toBeGreaterThanOrEqual(1 - OFFLINE_CRIT_VARIANCE - 1e-9)
      expect(ratio).toBeLessThanOrEqual(1 + OFFLINE_CRIT_VARIANCE + 1e-9)
    }
  })
})

describe('computeOfflineTicks', () => {
  it('computes floor(elapsed / tickMs)', () => {
    const now = 1_700_000_000_000
    const lastSaved = now - 12_345 * TICK_MS
    expect(computeOfflineTicks(lastSaved, TICK_MS, now)).toBe(12_345)
  })

  it('clamps to maxOfflineTicks(tickMs) for very long absences', () => {
    const now = 1_700_000_000_000
    const lastSaved = now - (MAX_OFFLINE_TICKS + 10_000) * TICK_MS
    expect(computeOfflineTicks(lastSaved, TICK_MS, now)).toBe(MAX_OFFLINE_TICKS)
  })

  it('never goes negative for clock skew (lastSaved in the future)', () => {
    const now = 1_700_000_000_000
    expect(computeOfflineTicks(now + 10_000, TICK_MS, now)).toBe(0)
  })

  it('a shorter effective tick length (Tick Speed upgrade) yields both more elapsed ticks and a higher cap', () => {
    const now = 1_700_000_000_000
    const lastSaved = now - 100_000 // 100s elapsed
    const fasterTickMs = TICK_MS / 2
    expect(computeOfflineTicks(lastSaved, fasterTickMs, now)).toBe(200) // 100s / 0.5s
    expect(computeOfflineTicks(lastSaved, TICK_MS, now)).toBe(100) // 100s / 1s
  })
})
