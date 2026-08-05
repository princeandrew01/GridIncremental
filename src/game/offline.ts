import Decimal from 'break_infinity.js'
import type { GameState } from './types'
import { cellIndex } from './types'
import { recalculate, advanceBuffsBy, expectedCritMultipliers, leechRangeIndices, powerCoreGeneratorPeriod } from './engine'
import { BUFF_TICK_INTERVAL, maxOfflineTicks, OFFLINE_CRIT_VARIANCE } from './config'
import { powerCoreChanceFor, powerCoreAmountFor } from './upgrades'
import { checkPowerCoreExponents } from './stats'

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

/**
 * Ticks to catch up for, given how long ago the state was last saved.
 * Clamped to [0, maxOfflineTicks(tickMs)]. `tickMs` is the *effective* tick
 * length (see upgrades.ts effectiveTickMs) - the Tick Speed upgrade shortens
 * it, so both how many ticks elapsed and how many ticks 24h caps out at have
 * to use the same value the player actually had equipped.
 */
export function computeOfflineTicks(lastSaved: number, tickMs: number, now: number = Date.now()): number {
  const elapsedMs = Math.max(0, now - lastSaved)
  const rawTicks = Math.floor(elapsedMs / tickMs)
  return Math.min(rawTicks, maxOfflineTicks(tickMs))
}

export interface OfflineResult {
  ticksApplied: number
  currencyGained: Decimal
  powerCoresGained: Decimal
}

/**
 * Closed-form power-core gain over N ticks - a fully separate, additive term
 * from the energy calculation below, not a rewrite of it. Two independent
 * sources:
 *
 * 1. Power Core Chance: a constant expected rate per applicable cell per
 *    tick (chance and amount are both purely upgrade-driven, not board
 *    state that changes over the gap) - a plain multiply, no derivation
 *    needed, same shape as the crit expected-value approach below.
 * 2. Power Core Generators: each cell has its own period (based on its own
 *    level), so this can't reuse sumFloorDiv5's single shared-period trick -
 *    each generator's proc count over N ticks is its own
 *    floor((coreProgress+N)/period) - floor(coreProgress/period), a direct
 *    per-cell analogue. A Leech's share mirrors engine.ts recalculate()'s
 *    two-layer pass (steal from generators, then from other leeches) almost
 *    exactly, just summing gap TOTALS instead of instantaneous snapshots,
 *    and reuses the same whole-board O(1) running-sum trick for level-2
 *    leeches instead of re-summing per leech.
 *
 * Mutates every generator's coreProgress for real (advancing it by N ticks),
 * same as advanceBuffsBy does for buffAccum.
 */
function offlinePowerCoreGain(state: GameState, N: number): Decimal {
  const { width, height, cells } = state
  const n = cells.length
  const amount = powerCoreAmountFor(state)

  // --- Power Core Chance: constant rate over N ticks, private to whichever
  // Basic/Leech cell it belongs to - never part of the Leech-stealable sums below. ---
  let chanceProducers = 0
  for (const cell of cells) {
    if (cell.type === 'basic' || cell.type === 'leech') chanceProducers += 1
  }
  const chanceGain = new Decimal(chanceProducers).times(powerCoreChanceFor(state)).times(amount).times(N)

  // --- Power Core Generators: per-cell period, mutates coreProgress for real. ---
  const productionByIndex: Decimal[] = new Array(n).fill(new Decimal(0))
  let nonLeechPowerCoreTotal = new Decimal(0)
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    if (cell.type !== 'powerCoreGenerator') continue
    const period = powerCoreGeneratorPeriod(cell.level)
    const cp = cell.coreProgress
    const procs = Math.floor((cp + N) / period) - Math.floor(cp / period)
    const total = new Decimal(procs).times(amount)
    productionByIndex[i] = total
    nonLeechPowerCoreTotal = nonLeechPowerCoreTotal.plus(total)
    cell.coreProgress = (cp + N) % period
  }

  // Each Leech's own steal-total from nearby generators, over the whole gap.
  const leechStealTotal: Decimal[] = new Array(n).fill(new Decimal(0))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      if (cell.level >= 2) {
        leechStealTotal[i] = nonLeechPowerCoreTotal // whole board; already excludes leeches
      } else {
        let sum = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type !== 'leech') sum = sum.plus(productionByIndex[j])
        }
        leechStealTotal[i] = sum
      }
    }
  }

  let leechBaseTotalSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type === 'leech') leechBaseTotalSum = leechBaseTotalSum.plus(leechStealTotal[i])
  }

  // Each Leech's final power-core total: its own steal + other leeches'
  // steals within range (mirrors recalculate()'s leech.final pass exactly).
  let leechFinalTotal = new Decimal(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      if (cell.level >= 2) {
        leechFinalTotal = leechFinalTotal.plus(leechStealTotal[i].plus(leechBaseTotalSum.minus(leechStealTotal[i])))
      } else {
        let otherLeeches = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type === 'leech') otherLeeches = otherLeeches.plus(leechStealTotal[j])
        }
        leechFinalTotal = leechFinalTotal.plus(leechStealTotal[i].plus(otherLeeches))
      }
    }
  }

  // Generators' own output (nonLeechPowerCoreTotal) + whatever Leeches
  // additionally read from them (leechFinalTotal, a deliberate duplicate -
  // stealing doesn't remove from the source) + the private chance procs.
  return nonLeechPowerCoreTotal.plus(leechFinalTotal).plus(chanceGain)
}

/**
 * Closed-form catch-up over N ticks - no simulation, however long N is
 * (spec §6). Mutates `state` in place: advances tickCount, buffAccum (all
 * at once, not firing-by-firing), currency, and now power cores.
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
 * Crit is folded in via expectedCritMultipliers - a constant per-Basic
 * scalar (chance and amount depend only on upgrades and that Basic's own
 * level, neither of which changes across the offline gap), so it doesn't
 * disturb the linearity this derivation depends on. `rng` (default
 * Math.random) drives a single ±OFFLINE_CRIT_VARIANCE roll on the *total*,
 * layered on top of the exact expected value rather than replacing it -
 * flavour, not a second derivation.
 *
 * Power cores are computed entirely separately (see offlinePowerCoreGain
 * above) - they don't fit this same "linear in a single shared firings
 * count" shape (each generator has its own period), so they get their own
 * closed form rather than being folded into A/B.
 *
 * Over N ticks starting from tickCount C, firings-so-far at relative tick k
 * (1..N) is floor((C+k)/BUFF_TICK_INTERVAL) - floor(C/BUFF_TICK_INTERVAL) -
 * NOT simply floor(k/BUFF_TICK_INTERVAL) unless C happens to be a multiple
 * of BUFF_TICK_INTERVAL. Summing that over k=1..N reduces to two calls to
 * sumFloorDiv5 plus simple arithmetic - no phase-alignment special case
 * needed. See _working/SESSION_LOG.md for the full worked derivation.
 */
export function applyOfflineProgress(state: GameState, N: number, rng: () => number = Math.random): OfflineResult {
  if (N <= 0) return { ticksApplied: 0, currencyGained: new Decimal(0), powerCoresGained: new Decimal(0) }

  const C = state.tickCount
  const critMultipliers = expectedCritMultipliers(state)

  const resultNow = recalculate(state, critMultipliers)
  const A = resultNow.production

  // Preview one more firing on a scratch copy - never mutates the real
  // state. Cells are shallow-copied; Decimal is immutable (every operation
  // returns a new instance), so sharing the buffAccum reference is safe -
  // advanceBuffsBy reassigns the clone's cell.buffAccum, not the original's.
  const preview: GameState = { ...state, cells: state.cells.map((c) => ({ ...c })) }
  advanceBuffsBy(preview, 1)
  // Same critMultipliers reused: chance/amount depend only on upgrades and
  // each Basic's own level, neither of which a buff firing changes.
  const B = recalculate(preview, critMultipliers).production.minus(A)

  // sum_{k=1}^{N} [floor((C+k)/interval) - floor(C/interval)], via sumFloorDiv5.
  const firingsWeightedSum =
    sumFloorDiv5(C + N + 1) - sumFloorDiv5(C + 1) - N * Math.floor(C / BUFF_TICK_INTERVAL)

  let currencyGained = A.times(N).plus(B.times(firingsWeightedSum))

  // Single ±OFFLINE_CRIT_VARIANCE roll on the total (user's call: "use the
  // chances to work out how many ticks would have been crits... you can even
  // do a +/-10% random roll to make it seem more efficient") - one roll, not
  // one per tick, so this stays closed-form.
  const varianceFactor = 1 + (rng() * 2 - 1) * OFFLINE_CRIT_VARIANCE
  currencyGained = currencyGained.times(varianceFactor)

  const powerCoresGained = offlinePowerCoreGain(state, N)

  // Advance the real state. buffAccum jumps by every new firing in one
  // step (advanceBuffsBy is O(cells), not O(cells * firings)); generator
  // coreProgress was already advanced for real inside offlinePowerCoreGain.
  const totalNewFirings = Math.floor((C + N) / BUFF_TICK_INTERVAL) - Math.floor(C / BUFF_TICK_INTERVAL)
  if (totalNewFirings > 0) advanceBuffsBy(state, totalNewFirings)
  state.tickCount = C + N
  state.currency = state.currency.plus(currencyGained)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(currencyGained)
  state.currentRunEnergyEarned = state.currentRunEnergyEarned.plus(currencyGained)
  state.powerCores = state.powerCores.plus(powerCoresGained)
  checkPowerCoreExponents(state)

  return { ticksApplied: N, currencyGained, powerCoresGained }
}
