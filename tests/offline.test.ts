import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import type { GameState, CellType, Facing } from '../src/game/types'
import { recalculate, expectedCritMultipliers, firePowerCoreGenerators } from '../src/game/engine'
import { computeOfflineTicks, applyOfflineProgress } from '../src/game/offline'
import { MAX_OFFLINE_TICKS, TICK_MS, OFFLINE_CRIT_VARIANCE } from '../src/game/config'

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
  place(state, 1, 0, 'buff', 1, 'left') // 20%, facing the basic at (0,0)
  place(state, 3, 0, 'buff', 0, 'right') // 10%, facing the basic at (4,0)
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
 * per-tick dice roll - the correct invariant to check, since a closed form
 * never claims to reproduce any particular *realized* random sequence, only
 * the exact expected value. Alpha 0.31: production is genuinely CONSTANT
 * every tick now (Buffs no longer accumulate over time - see
 * engine.ts resolveBuffMultipliers), so this loop is really just checking
 * that N calls to the same recalculate() sum to N times one call - a much
 * simpler invariant than the old buff-firing-interval math, but still worth
 * an independent check rather than trusting the multiplication by inspection.
 */
function manualExpectedSimulate(state: GameState, N: number): void {
  const multipliers = expectedCritMultipliers(state)
  for (let i = 0; i < N; i++) {
    state.tickCount += 1
    const result = recalculate(state, multipliers)
    state.currency = state.currency.plus(result.production)
    state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  }
}

function expectMatchesManualSimulation(offlineState: GameState, manualState: GameState): void {
  expect(offlineState.tickCount).toBe(manualState.tickCount)
  expect(offlineState.currency.toString()).toBe(manualState.currency.toString())
}

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

  it('also matches manual simulation starting from a non-zero tickCount (no more firing-phase alignment to worry about - Alpha 0.31 buffs are tick-invariant)', () => {
    for (const N of [1, 4, 5, 6, 23, 100]) {
      const base = buildInterestingBoard()
      manualExpectedSimulate(base, 3)
      expect(base.tickCount).toBe(3)

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

/**
 * Mirrors offlinePowerCoreGain's own claimed math step-by-step using the
 * real, already-tested firePowerCoreGenerators (per-cell period, mutates
 * coreProgress for real) routed through the same recalculate() leech-
 * stealing + Buff-multiplier pass real gameplay uses. An independent check
 * of the same per-cell floor-division math applyOfflineProgress relies on.
 */
function manualPowerCoreExpectedSimulate(state: GameState, N: number): void {
  for (let i = 0; i < N; i++) {
    const genAmounts = firePowerCoreGenerators(state)
    const result = recalculate(state, undefined, genAmounts)
    state.powerCores = state.powerCores.plus(result.powerCoreProduction)
  }
}

function expectPowerCoresMatchManualSimulation(offlineState: GameState, manualState: GameState): void {
  expect(offlineState.powerCores.toString()).toBe(manualState.powerCores.toString())
  for (let i = 0; i < offlineState.cells.length; i++) {
    expect(offlineState.cells[i].coreProgress).toBe(manualState.cells[i].coreProgress)
  }
}

/**
 * Two Power Core Generators at different levels (different periods) and
 * out-of-phase starting progress, a nearby orthogonal Leech and a
 * whole-board Leech, plus a Buff targeting one generator directly - the
 * Buff is the important addition for Alpha 0.31: it's what actually
 * exercises the "summing commutes with a constant Buff multiplier" claim
 * offlinePowerCoreGain's rewrite relies on (see its own comment).
 */
function buildPowerCoreBoard(): GameState {
  const state = makeGameState(5, 5)
  place(state, 0, 0, 'powerCoreGenerator', 0) // period 5
  place(state, 4, 4, 'powerCoreGenerator', 3) // period 2
  state.cells[cellIndex(4, 4, 5)].coreProgress = 1 // not phase-aligned with tick 0
  place(state, 1, 0, 'leech', 0) // orthogonal - reads (0,0)'s procs
  place(state, 2, 2, 'leech', 2) // whole board - reads both generators
  place(state, 0, 1, 'buff', 4, 'up') // 50%, facing (0,0) directly
  return state
}

describe('offlinePowerCoreGain (via applyOfflineProgress)', () => {
  it('regression: closed-form power core gain matches an expected-value manual simulation exactly, for N = 1, 4, 6, 7, 100, 1000', () => {
    for (const N of [1, 4, 6, 7, 100, 1000]) {
      const offlineState = buildPowerCoreBoard()
      const manualState = cloneState(offlineState)

      applyOfflineProgress(offlineState, N, NEUTRAL_RNG)
      manualPowerCoreExpectedSimulate(manualState, N)

      expectPowerCoresMatchManualSimulation(offlineState, manualState)
    }
  })

  it('also matches manual simulation starting from non-phase-aligned coreProgress on every generator', () => {
    for (const N of [1, 3, 6, 7, 23, 100]) {
      const base = buildPowerCoreBoard()
      for (let i = 0; i < 3; i++) firePowerCoreGenerators(base) // desync coreProgress from a fresh start

      const offlineState = cloneState(base)
      const manualState = cloneState(base)

      applyOfflineProgress(offlineState, N, NEUTRAL_RNG)
      manualPowerCoreExpectedSimulate(manualState, N)

      expectPowerCoresMatchManualSimulation(offlineState, manualState)
    }
  })

  it('an empty board gains no power cores but still returns a well-formed result', () => {
    const state = makeGameState(3, 3)
    const result = applyOfflineProgress(state, 50, NEUTRAL_RNG)
    expect(result.powerCoresGained.toString()).toBe('0')
  })

  it('a Buff targeting a Power Core Generator correctly multiplies its offline closed-form output too, not just the live per-tick one', () => {
    const buffedState = makeGameState(2, 1)
    place(buffedState, 0, 0, 'powerCoreGenerator', 0) // period 5
    place(buffedState, 1, 0, 'buff', 4, 'left') // 50%, facing the generator

    const unbuffedState = makeGameState(2, 1)
    place(unbuffedState, 0, 0, 'powerCoreGenerator', 0)

    const buffedResult = applyOfflineProgress(buffedState, 100, NEUTRAL_RNG)
    const unbuffedResult = applyOfflineProgress(unbuffedState, 100, NEUTRAL_RNG)

    expect(buffedResult.powerCoresGained.toNumber()).toBeCloseTo(unbuffedResult.powerCoresGained.toNumber() * 1.5, 6)
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
