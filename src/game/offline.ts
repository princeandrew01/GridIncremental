import Decimal from 'break_infinity.js'
import type { GameState } from './types'
import { recalculate, advanceBuffsBy } from './engine'
import { TICK_MS, BUFF_TICK_INTERVAL, MAX_OFFLINE_TICKS } from './config'

/**
 * sum_{j=0}^{N-1} floor(j / interval), in closed form - no loop, however
 * large N is. `interval` defaults to BUFF_TICK_INTERVAL, matching spec §6's
 * formula (written for a fixed divisor of 5, which is exactly
 * BUFF_TICK_INTERVAL). Its own tested function, per spec.
 */
export function sumFloorDiv5(N: number, interval: number = BUFF_TICK_INTERVAL): number {
  if (N <= 0) return 0
  const q = Math.floor(N / interval)
  const r = N % interval
  return (interval * q * (q - 1)) / 2 + r * q
}

/** Ticks to catch up for, given how long ago the state was last saved. Clamped to [0, MAX_OFFLINE_TICKS]. */
export function computeOfflineTicks(lastSaved: number, now: number = Date.now()): number {
  const elapsedMs = Math.max(0, now - lastSaved)
  const rawTicks = Math.floor(elapsedMs / TICK_MS)
  return Math.min(rawTicks, MAX_OFFLINE_TICKS)
}

export interface OfflineResult {
  ticksApplied: number
  currencyGained: Decimal
}

/**
 * Closed-form catch-up over N ticks - no simulation, however long N is
 * (spec §6). Mutates `state` in place: advances tickCount, buffAccum (all
 * at once, not firing-by-firing), and currency.
 *
 * Derivation: every quantity in the two-pass calculation (a Basic's base, a
 * Leech's base, any final value) is either constant or a fixed linear
 * combination of buffAccum values, and each buffAccum grows by a fixed
 * amount per firing. So board production is *exactly* linear in "firings
 * so far" - production(q) = A + B*q - regardless of board layout, leech
 * levels, or how many buffs target the same Basic. That means two samples,
 * taken via the real (already-tested) recalculate()/advanceBuffsBy()
 * functions rather than re-derived by hand, fully determine production at
 * any tick:
 *   A = recalculate(state).production                       (0 more firings)
 *   B = recalculate(state after 1 more firing).production - A (per-firing delta)
 *
 * Over N ticks starting from tickCount C, firings-so-far at relative tick k
 * (1..N) is floor((C+k)/BUFF_TICK_INTERVAL) - floor(C/BUFF_TICK_INTERVAL) -
 * NOT simply floor(k/BUFF_TICK_INTERVAL) unless C happens to be a multiple
 * of BUFF_TICK_INTERVAL. Summing that over k=1..N reduces to two calls to
 * sumFloorDiv5 plus simple arithmetic - no phase-alignment special case
 * needed. See _working/SESSION_LOG.md for the full worked derivation.
 */
export function applyOfflineProgress(state: GameState, N: number): OfflineResult {
  if (N <= 0) return { ticksApplied: 0, currencyGained: new Decimal(0) }

  const C = state.tickCount

  const resultNow = recalculate(state)
  const A = resultNow.production

  // Preview one more firing on a scratch copy - never mutates the real
  // state. Cells are shallow-copied; Decimal is immutable (every operation
  // returns a new instance), so sharing the buffAccum reference is safe -
  // advanceBuffsBy reassigns the clone's cell.buffAccum, not the original's.
  const preview: GameState = { ...state, cells: state.cells.map((c) => ({ ...c })) }
  advanceBuffsBy(preview, 1)
  const B = recalculate(preview).production.minus(A)

  // sum_{k=1}^{N} [floor((C+k)/interval) - floor(C/interval)], via sumFloorDiv5.
  const firingsWeightedSum =
    sumFloorDiv5(C + N + 1) - sumFloorDiv5(C + 1) - N * Math.floor(C / BUFF_TICK_INTERVAL)

  const currencyGained = A.times(N).plus(B.times(firingsWeightedSum))

  // Advance the real state. buffAccum jumps by every new firing in one
  // step (advanceBuffsBy is O(cells), not O(cells * firings)).
  const totalNewFirings = Math.floor((C + N) / BUFF_TICK_INTERVAL) - Math.floor(C / BUFF_TICK_INTERVAL)
  if (totalNewFirings > 0) advanceBuffsBy(state, totalNewFirings)
  state.tickCount = C + N
  state.currency = state.currency.plus(currencyGained)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(currencyGained)

  return { ticksApplied: N, currencyGained }
}
