import Decimal from 'break_infinity.js'
import type { GameState } from './types'
import { recalculate, expectedCritMultipliers, powerCoreGeneratorPeriod } from './engine'
import { maxOfflineTicks, OFFLINE_CRIT_VARIANCE } from './config'

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
 * Closed-form power-core gain over N ticks. Alpha 0.31: each Power Core
 * Generator's own proc count over N ticks is a per-cell floor-division
 * (its own period, based on its own level - `floor((coreProgress+N)/period)
 * - floor(coreProgress/period)`, mutating `coreProgress` for real, same as
 * firePowerCoreGenerators does for a single tick), each proc worth exactly
 * 1 core (see config.ts - the old Power Core Amount upgrade that used to
 * scale this is gone).
 *
 * Rather than hand-duplicating recalculate()'s leech-stealing + Buff
 * multiplier logic here (a real, error-prone duplication the old Alpha 0.3
 * version of this function did), this builds one N-tick TOTAL per generator
 * and feeds it straight into the real, already-tested recalculate() as if
 * it were "this tick's" proc amounts. That's valid because the whole
 * pipeline downstream of basePowerCores is linear (leech stealing is just
 * summing, and a Buff multiplier is a constant factor across the gap, same
 * assumption every other offline calculation already makes) - summing over
 * N ticks commutes with it exactly, so recalculate()'s own
 * `finalPowerCores`/`powerCoreProduction` come out as the correct N-tick
 * totals, buffed and leech-stolen correctly, with zero duplicated logic.
 */
function offlinePowerCoreGain(state: GameState, N: number): Decimal {
  const n = state.cells.length
  const generatorTotals: Decimal[] = new Array(n).fill(new Decimal(0))
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'powerCoreGenerator') continue
    const period = powerCoreGeneratorPeriod(cell.level)
    const cp = cell.coreProgress
    const procs = Math.floor((cp + N) / period) - Math.floor(cp / period)
    generatorTotals[i] = new Decimal(procs)
    cell.coreProgress = (cp + N) % period
  }
  return recalculate(state, undefined, generatorTotals).powerCoreProduction
}

/**
 * Closed-form catch-up over N ticks - no simulation, however long N is.
 * Mutates `state` in place: advances tickCount, currency, and power cores.
 *
 * Alpha 0.31: Energy production is no longer "linear in buff-firings so
 * far" - buffs stopped accumulating over time entirely (see engine.ts
 * resolveBuffMultipliers), so per-tick production is simply CONSTANT across
 * the whole gap (assuming nothing is purchased mid-gap, same assumption
 * this always made for account upgrades). That collapses what used to be a
 * two-sample linear-interpolation derivation (see git history / the old
 * SESSION_LOG for the pre-0.31 version) down to one call to recalculate()
 * (already includes crit's expected value and every Buff's live multiplier)
 * times N - a real simplification, not just a rewrite.
 *
 * Power cores get their own separate closed form (see offlinePowerCoreGain
 * above) since each generator has its own period - they don't fit the
 * single "one constant rate for the whole gap" shape Energy does.
 */
export function applyOfflineProgress(state: GameState, N: number, rng: () => number = Math.random): OfflineResult {
  if (N <= 0) return { ticksApplied: 0, currencyGained: new Decimal(0), powerCoresGained: new Decimal(0) }

  const critMultipliers = expectedCritMultipliers(state)
  const perTickProduction = recalculate(state, critMultipliers).production

  let currencyGained = perTickProduction.times(N)

  // Single ±OFFLINE_CRIT_VARIANCE roll on the total (flavour, so two
  // absences of the same length don't earn the exact same amount) - one
  // roll, not one per tick, so this stays closed-form.
  const varianceFactor = 1 + (rng() * 2 - 1) * OFFLINE_CRIT_VARIANCE
  currencyGained = currencyGained.times(varianceFactor)

  const powerCoresGained = offlinePowerCoreGain(state, N)

  state.tickCount += N
  state.currency = state.currency.plus(currencyGained)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(currencyGained)
  state.currentRunEnergyEarned = state.currentRunEnergyEarned.plus(currencyGained)
  state.powerCores = state.powerCores.plus(powerCoresGained)

  return { ticksApplied: N, currencyGained, powerCoresGained }
}
