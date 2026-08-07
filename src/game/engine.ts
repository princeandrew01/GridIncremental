import Decimal from 'break_infinity.js'
import type { CellType, Facing, GameState, TickResult } from './types'
import { cellIndex } from './types'
import {
  BASIC_BASE_VALUE,
  BASIC_MULT,
  STEADY_TOWER_MULT,
  BUFF_PCT_PER_LEVEL,
  POWER_CORE_GENERATOR_BASE_TICKS,
  POWER_CORE_GENERATOR_TICKS_PER_LEVEL,
  POWER_CORE_GENERATOR_BASE_AMOUNT,
  POWER_CORE_GENERATOR_AMOUNT_PER_LEVEL,
} from './config'
import { generatorValueMultiplier, basicValueBonus, critChanceFor, critAmountFor } from './upgrades'

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height
}

function isBasicFamily(type: CellType): boolean {
  return type === 'basic' || type === 'basicCrit' || type === 'basicSteady'
}

function isBuffType(type: CellType): boolean {
  return type === 'buff' || type === 'buffStacker' || type === 'buffAll'
}

// A producer is anything a directional Buff can meaningfully target - it has
// its own output that a buff percentage actually multiplies. Buff-type cells
// themselves are never producers (their own `final` output is always 0) -
// pointing a buff/buffStacker at another buff-type cell instead triggers the
// Stacker chaining special case (see resolveOwnBuffMultipliers below).
function isProducer(type: CellType): boolean {
  return isBasicFamily(type) || type === 'leech' || type === 'powerCoreGenerator'
}

// --- Facing: a directional cell (Buff, Buff Stacker) always targets exactly
// 1 adjacent cell, rotatable in place by the player. Alpha 0.31: levels no
// longer buy coverage (the old Buff V1 1/2/4-side scaling is gone) - only
// the buff's percentage changes with level now, so rotation is a simple
// fixed 4-way cycle regardless of level. ---

const FACING_DELTA: Record<Facing, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
}

/** Clockwise rotation order: up -> right -> down -> left -> up. */
export const FACING_ORDER: Facing[] = ['up', 'right', 'down', 'left']

/** Rotates `facing` one step clockwise. */
export function nextFacing(facing: Facing): Facing {
  const i = FACING_ORDER.indexOf(facing)
  return FACING_ORDER[(i + 1) % FACING_ORDER.length]
}

/** The cell index a directional cell at (x,y) facing `facing` targets, or null if that points off the board. */
export function facingTargetIndex(
  x: number,
  y: number,
  facing: Facing,
  width: number,
  height: number,
): number | null {
  const [dx, dy] = FACING_DELTA[facing]
  const nx = x + dx
  const ny = y + dy
  if (!inBounds(nx, ny, width, height)) return null
  return cellIndex(nx, ny, width)
}

/**
 * Facing to use for a newly-placed Buff/Buff Stacker at (x,y): points at an
 * adjacent producer (Basic-family, Leech, or Power Core Generator) if one
 * already exists, otherwise the first in-bounds direction.
 */
export function defaultFacingFor(state: GameState, x: number, y: number): Facing {
  const { width, height, cells } = state
  for (const facing of FACING_ORDER) {
    const idx = facingTargetIndex(x, y, facing, width, height)
    if (idx !== null && isProducer(cells[idx].type)) return facing
  }
  for (const facing of FACING_ORDER) {
    if (facingTargetIndex(x, y, facing, width, height) !== null) return facing
  }
  return 'up'
}

/** Rotates the Buff/Buff Stacker at (x,y) one step. Returns whether it happened (false for any other type, including Buff All which has no facing). */
export function rotateBuffFacing(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type !== 'buff' && cell.type !== 'buffStacker') return false
  cell.facing = nextFacing(cell.facing)
  return true
}

const ORTHOGONAL_DELTAS: ReadonlyArray<[number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

const MOORE_DELTAS: ReadonlyArray<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

function neighborIndices(
  x: number,
  y: number,
  width: number,
  height: number,
  deltas: ReadonlyArray<[number, number]>,
): number[] {
  const out: number[] = []
  for (const [dx, dy] of deltas) {
    const nx = x + dx
    const ny = y + dy
    if (inBounds(nx, ny, width, height)) out.push(cellIndex(nx, ny, width))
  }
  return out
}

/**
 * Indices a leech at (x,y) with the given level reads from. Levels are
 * 0-based: 0 = orthogonal, 1 = Moore. Level 2 (whole board) is NOT
 * represented here - it's handled separately via precomputed running sums,
 * per the required optimisation (spec §5). Unchanged in Alpha 0.31.
 */
export function leechRangeIndices(x: number, y: number, level: number, width: number, height: number): number[] {
  if (level <= 0) return neighborIndices(x, y, width, height, ORTHOGONAL_DELTAS)
  if (level === 1) return neighborIndices(x, y, width, height, MOORE_DELTAS)
  return []
}

/**
 * Resolves every Buff/Buff Stacker/Buff All cell's own effective multiplier:
 * 1 + its own level's percentage (BUFF_PCT_PER_LEVEL), further multiplied by
 * whatever it's pointed at IF that target is itself a buff-type cell (the
 * Buff Stacker mechanic - confirmed with the user via a worked example: a
 * 10% Buff pointed at by a maxed 100% Stacker becomes 1.1 x 2 = 2.2, i.e.
 * +120% instead of +10%). Chains to arbitrary depth. A Buff pointed at
 * anything else (or nothing) just resolves to its own factor - so does a
 * Buff Stacker pointed at a non-buff target, or a Buff All (never has a
 * facing, always a "leaf" from its own point of view for this purpose -
 * see below for how something targeting IT still boosts it).
 *
 * Direction matters here: a Buff Stacker doesn't carry its own value
 * outward to whatever it faces when that target is itself a buff-type cell
 * - instead it feeds INTO that target's effective value (confirmed with the
 * user via a worked example: a plain 10% Buff, targeted by a maxed 100%
 * Stacker, becomes effectively 1.1 x 2 = 2.2 - the *target's* value grows,
 * not a separate value the Stacker applies on its own). So this resolves
 * "effective multiplier of X" = X's own factor, times the effective
 * multiplier of every Stacker whose facing targets X - a reverse lookup
 * (targeted-by), not a forward walk. Only Stackers can feed into another
 * buff-type cell this way; a plain Buff pointed at another buff-type cell
 * has no defined effect (buff-type cells have no `final` output of their
 * own to boost) and is simply inert in that configuration.
 *
 * A cycle (two Stackers facing each other, or a longer loop) can't resolve
 * to a finite value in general. This still always terminates and stays
 * bounded (DFS with in-progress marking: revisiting a cell already being
 * resolved treats that one inbound edge as neutral, breaking the cycle) -
 * but which specific cell "eats" the break, and so ends up lower than the
 * other(s), depends on scan order, not a fully symmetric neutralization of
 * every cycle member. Good enough for what's really a degenerate
 * configuration (facing two Stackers at each other has no productive use),
 * as long as it can't hang or blow up.
 */
export function resolveEffectiveBuffMultipliers(state: GameState): Map<number, number> {
  const { width, height, cells } = state
  const n = cells.length
  const effective = new Map<number, number>()
  const visiting = new Set<number>()

  // Reverse index: for each cell, which Stacker cells (by index) target it.
  const targetedBy: number[][] = Array.from({ length: n }, () => [])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      if (cells[i].type !== 'buffStacker') continue
      const targetIdx = facingTargetIndex(x, y, cells[i].facing, width, height)
      if (targetIdx !== null && isBuffType(cells[targetIdx].type)) targetedBy[targetIdx].push(i)
    }
  }

  function resolve(i: number): number {
    const cached = effective.get(i)
    if (cached !== undefined) return cached
    if (visiting.has(i)) return 1 // mid-cycle - this one inbound edge contributes nothing, breaking the loop
    visiting.add(i)
    let total = 1 + BUFF_PCT_PER_LEVEL[cells[i].level]
    for (const stackerIdx of targetedBy[i]) total *= resolve(stackerIdx)
    visiting.delete(i)
    effective.set(i, total)
    return total
  }

  for (let i = 0; i < n; i++) {
    if (isBuffType(cells[i].type)) resolve(i)
  }

  return effective
}

/**
 * One multiplier per cell - the product of every buff effect currently
 * applying to it: any Buff All on the board (applies to everyone, using its
 * own effective value - already boosted by any Stacker targeting it, see
 * above), plus whichever directional Buff/Buff Stacker cells face it
 * directly (using their own effective value too). A cell can be hit by more
 * than one source at once - they all multiply together, never just the
 * strongest. Buff-type cells are never producer-targets here themselves - a
 * directional cell facing another buff-type cell was already consumed by
 * the effective-value resolution above, not applied again as a second effect.
 *
 * Recomputed fresh every call - Alpha 0.31 buffs are a pure function of
 * current board state, nothing about them accumulates over time anymore
 * (see the removed advanceBuffs/advanceBuffsBy and BUFF_TICK_INTERVAL).
 */
export function resolveBuffMultipliers(state: GameState): number[] {
  const { width, height, cells } = state
  const n = cells.length
  const effective = resolveEffectiveBuffMultipliers(state)
  const result: number[] = new Array(n).fill(1)

  for (let i = 0; i < n; i++) {
    if (cells[i].type === 'buffAll') {
      const mult = effective.get(i)!
      for (let j = 0; j < n; j++) result[j] *= mult
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'buff' && cell.type !== 'buffStacker') continue
      const targetIdx = facingTargetIndex(x, y, cell.facing, width, height)
      if (targetIdx === null || isBuffType(cells[targetIdx].type)) continue
      result[targetIdx] *= effective.get(i)!
    }
  }

  return result
}

/**
 * One crit multiplier per cell (1 = no crit), rolled fresh each call -
 * Basic-family (basic/basicCrit/basicSteady) only, everything else stays at
 * 1. `rng` is injectable so callers (and tests) can force deterministic
 * outcomes; real gameplay uses Math.random.
 */
export function rollCrits(state: GameState, rng: () => number = Math.random): number[] {
  const n = state.cells.length
  const multipliers: number[] = new Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (!isBasicFamily(cell.type)) continue
    const isCritTower = cell.type === 'basicCrit'
    if (rng() < critChanceFor(state, isCritTower)) {
      multipliers[i] = critAmountFor(state, isCritTower)
    }
  }
  return multipliers
}

/**
 * Expected crit multiplier per cell - `1 + chance * (amount - 1)`, a constant
 * scalar rather than a coin flip. Used for stable display (never bounces
 * around from tick to tick) and offline catch-up (Energy production is
 * simply this applied once, not a per-tick roll - see offline.ts).
 */
export function expectedCritMultipliers(state: GameState): number[] {
  const n = state.cells.length
  const multipliers: number[] = new Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (!isBasicFamily(cell.type)) continue
    const isCritTower = cell.type === 'basicCrit'
    const chance = critChanceFor(state, isCritTower)
    const amount = critAmountFor(state, isCritTower)
    multipliers[i] = 1 + chance * (amount - 1)
  }
  return multipliers
}

/**
 * A Power Core Generator's period in ticks - how often it produces (10 at
 * level 0, down to 1 at level 9 - a per-cell value, since every generator is
 * leveled independently rather than sharing one global timer).
 */
export function powerCoreGeneratorPeriod(level: number): number {
  return POWER_CORE_GENERATOR_BASE_TICKS - level * POWER_CORE_GENERATOR_TICKS_PER_LEVEL
}

/**
 * A Power Core Generator's own proc amount - how many cores a single proc is
 * worth, before any Buff multiplier (1 at level 0, up to 10 at level 9 -
 * the user's own redesign: period and amount now both scale with level, so
 * a maxed generator is 10x faster AND worth 10x more per proc than a fresh
 * one, not just faster).
 */
export function powerCoreGeneratorAmount(level: number): number {
  return POWER_CORE_GENERATOR_BASE_AMOUNT + level * POWER_CORE_GENERATOR_AMOUNT_PER_LEVEL
}

/**
 * Advances every Power Core Generator's progress by exactly one real tick,
 * mutating `coreProgress` for real, and returns how many power cores each
 * cell produced THIS tick (0 for cells that didn't cross their period
 * boundary, or aren't a generator; powerCoreGeneratorAmount(level)
 * otherwise, before any Buff multiplier). This is what recalculate() uses
 * to seed `basePowerCores` for a live tick - offline catch-up uses its own
 * closed-form per-cell-period derivation instead (see offline.ts), since
 * this per-tick approach doesn't scale to a day-long gap.
 */
export function firePowerCoreGenerators(state: GameState): Decimal[] {
  const n = state.cells.length
  const amounts: Decimal[] = new Array(n).fill(new Decimal(0))
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'powerCoreGenerator') continue
    const period = powerCoreGeneratorPeriod(cell.level)
    cell.coreProgress += 1
    if (cell.coreProgress >= period) {
      cell.coreProgress -= period
      amounts[i] = new Decimal(powerCoreGeneratorAmount(cell.level))
    }
  }
  return amounts
}

/**
 * Full expected power-core TickResult, board-wide - a stable, non-jumpy
 * figure for display, the same spirit as expectedCritMultipliers on the
 * Energy side. Each generator's own expected per-tick output is
 * `amount / period` (a fractional "amount", since over `period` ticks it
 * procs exactly once for `amount` cores) - fed into the real recalculate()
 * as if it were this tick's actual proc amounts, the same trick offline.ts
 * uses for N-tick catch-up totals. That single call then gets Leech-
 * stealing, Buff multipliers, and the leech-duplication behaviour (see
 * recalculate()'s doc comment) exactly right for free, instead of re-
 * deriving that whole pipeline by hand a second time. Exposed as the full
 * result (not just the board-wide total) so a caller can also read a
 * SPECIFIC cell's own expected share - e.g. the grid's own per-cell display,
 * which otherwise has no way to show what a Leech is expected to steal in
 * Power Cores (the "display" recalculate() calls elsewhere never simulate a
 * generator proc at all, so finalPowerCores is always 0 on those).
 */
export function expectedPowerCoreResult(state: GameState): TickResult {
  const amounts: Decimal[] = state.cells.map((cell) =>
    cell.type === 'powerCoreGenerator'
      ? new Decimal(powerCoreGeneratorAmount(cell.level)).div(powerCoreGeneratorPeriod(cell.level))
      : new Decimal(0),
  )
  return recalculate(state, undefined, amounts)
}

/** Just the board-wide total from expectedPowerCoreResult - see its own doc comment. */
export function expectedPowerCoreProductionPerTick(state: GameState): Decimal {
  return expectedPowerCoreResult(state).powerCoreProduction
}

/**
 * The two-pass board evaluation. Pass 2 reads only base[], never final[] -
 * this is what keeps the calculation terminating instead of an unstable
 * feedback loop (spec §5, §15 rule 2).
 *
 * `critMultipliers`, if given, is one multiplier per cell (see rollCrits /
 * expectedCritMultipliers) applied to each Basic-family cell's `base`.
 * Omitted entirely (the default) for pure display/preview calls, which
 * should show honest, un-critted values.
 *
 * `powerCoreGeneratorAmounts`, if given, is what firePowerCoreGenerators()
 * returned for THIS evaluation - the parallel power-core pipeline below
 * mirrors the energy one, except power cores have exactly one source now
 * (the generator itself) - no more private per-cell proc mechanic the way
 * Power Core Chance used to be.
 *
 * Buffs (see resolveBuffMultipliers) are resolved fresh every call from
 * current board state alone - nothing about them depends on `times` or any
 * accumulated history, unlike the pre-0.31 buffAccum mechanic.
 *
 * A Leech steals a share of what a nearby cell actually PRODUCES - its own
 * `final` (crit, level/evolution multiplier, and any Buff on it all
 * included), not the pre-multiplier `base` a much earlier version of this
 * read (corrected per the user: "leech should leech the output value not
 * the base value" - a Leech next to a buffed, maxed generator now sees the
 * whole thing, not just the raw account-wide portion). This still can't
 * cycle: a non-leech producer's own `final` never depends on any Leech (a
 * Buff can target a Leech, but a Leech never feeds back into what a
 * producer collects), so every non-leech `final` is computed in full
 * BEFORE any Leech pass runs, and Leech-to-leech cascading keeps reading
 * `base` (see pass 3) - a leech's own pre-cascading collection, not its
 * post-cascading final - exactly as before, which is what keeps two
 * mutually-in-range leeches from having to read each other's still-being-
 * computed final and deadlocking.
 */
export function recalculate(
  state: GameState,
  critMultipliers?: number[],
  powerCoreGeneratorAmounts?: Decimal[],
): TickResult {
  const { width, height, cells } = state
  const n = width * height
  const base: Decimal[] = new Array(n)
  const final: Decimal[] = new Array(n)
  const crits: boolean[] = new Array(n).fill(false)
  const basePowerCores: Decimal[] = new Array(n)
  const finalPowerCores: Decimal[] = new Array(n)

  const valueMult = generatorValueMultiplier(state)
  const valueBonus = basicValueBonus(state)
  const buffMultipliers = resolveBuffMultipliers(state)

  // --- Pass 1a: Basic-family's raw crit-inclusive value, and power core
  // generators' raw per-proc amount. `base`/`basePowerCores` here are
  // display/diagnostic figures now (the panel's "Base (no crit)" row) -
  // what a Leech actually steals is computed next, in pass 1b. ---
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    if (isBasicFamily(cell.type)) {
      const raw = new Decimal(BASIC_BASE_VALUE + valueBonus).times(valueMult)
      const critMult = critMultipliers ? critMultipliers[i] : 1
      base[i] = raw.times(critMult)
      crits[i] = critMult > 1
    } else {
      base[i] = new Decimal(0) // buff, buffStacker, buffAll, empty, powerCoreGenerator, and leech (leech's real meaning set in pass 2 below)
    }
    basePowerCores[i] = cell.type === 'powerCoreGenerator' && powerCoreGeneratorAmounts ? powerCoreGeneratorAmounts[i] : new Decimal(0)
  }

  // --- Pass 1b: every non-leech cell's OWN final output (energy and power
  // cores both) - level/evolution multiplier and Buff included. Never
  // depends on a Leech, so this is always safe to compute before any Leech
  // pass runs (see the function comment above). Leech and buff-type/empty
  // cells get 0 here; a Leech's real final is set in pass 3. ---
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    const buffMult = buffMultipliers[i]
    if (isBasicFamily(cell.type)) {
      // Basic Steady stacks its evolution multiplier on top of the same
      // level curve every Basic-family cell uses.
      const ownMult = cell.type === 'basicSteady' ? BASIC_MULT[cell.level] * STEADY_TOWER_MULT : BASIC_MULT[cell.level]
      final[i] = base[i].times(ownMult).times(buffMult)
      finalPowerCores[i] = new Decimal(0) // Basic-family never produces power cores directly (Power Core Chance is gone)
    } else if (cell.type === 'powerCoreGenerator') {
      final[i] = new Decimal(0) // produces power cores only, no energy
      finalPowerCores[i] = basePowerCores[i].times(buffMult)
    } else {
      final[i] = new Decimal(0) // leech (real value set in pass 3), buff, buffStacker, buffAll, empty
      finalPowerCores[i] = new Decimal(0)
    }
  }

  // Running sums of every non-leech cell's OWN final, computed once - O(N).
  // Required so level-2 (whole board) leeches are O(1) instead of O(N) each.
  // Summing everyone except leeches (rather than filtering by producer type)
  // is safe: buff-type/empty cells' final is always 0 above, so they
  // contribute nothing either way.
  let nonLeechFinalSum = new Decimal(0)
  let nonLeechPowerCoreFinalSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type !== 'leech') {
      nonLeechFinalSum = nonLeechFinalSum.plus(final[i])
      nonLeechPowerCoreFinalSum = nonLeechPowerCoreFinalSum.plus(finalPowerCores[i])
    }
  }

  // --- Pass 2: leech.base = sum of NON-LEECH final values within range
  // (energy and power cores both) - the leech's own pre-cascading
  // collection. Repurposes the `base`/`basePowerCores` arrays for leech
  // cells specifically (they're otherwise unused for leech, which has no
  // "raw pre-multiplier" concept of its own) - kept as the SAME field
  // Leech-to-leech cascading reads in pass 3, exactly as before this
  // change; only what feeds it (final instead of base) is new. ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      if (cell.level >= 2) {
        base[i] = nonLeechFinalSum // whole board; nonLeechFinalSum already excludes leeches
        basePowerCores[i] = nonLeechPowerCoreFinalSum
      } else {
        let sum = new Decimal(0)
        let pcSum = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type !== 'leech') {
            sum = sum.plus(final[j])
            pcSum = pcSum.plus(finalPowerCores[j])
          }
        }
        base[i] = sum
        basePowerCores[i] = pcSum
      }
    }
  }

  // Running sums of all leech collection amounts, computed once after pass 2
  // - required so level-2 leeches can read "other leeches" in O(1) in pass 3.
  let leechBaseSum = new Decimal(0)
  let leechPowerCoreBaseSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type === 'leech') {
      leechBaseSum = leechBaseSum.plus(base[i])
      leechPowerCoreBaseSum = leechPowerCoreBaseSum.plus(basePowerCores[i])
    }
  }

  // --- Pass 3: leech.final = leech's own collection + OTHER leeches'
  // collections within range (energy and power cores both), times its own
  // Buff multiplier if any. Everything else was already finalized in pass
  // 1b. ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      const buffMult = buffMultipliers[i]
      if (cell.level >= 2) {
        final[i] = base[i].plus(leechBaseSum.minus(base[i])).times(buffMult)
        finalPowerCores[i] = basePowerCores[i].plus(leechPowerCoreBaseSum.minus(basePowerCores[i])).times(buffMult)
      } else {
        let otherLeeches = new Decimal(0)
        let otherLeechesPowerCores = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type === 'leech') {
            otherLeeches = otherLeeches.plus(base[j])
            otherLeechesPowerCores = otherLeechesPowerCores.plus(basePowerCores[j])
          }
        }
        final[i] = base[i].plus(otherLeeches).times(buffMult)
        finalPowerCores[i] = basePowerCores[i].plus(otherLeechesPowerCores).times(buffMult)
      }
    }
  }

  let production = new Decimal(0)
  let powerCoreProduction = new Decimal(0)
  for (let i = 0; i < n; i++) {
    production = production.plus(final[i])
    powerCoreProduction = powerCoreProduction.plus(finalPowerCores[i])
  }

  return { base, final, production, crits, basePowerCores, finalPowerCores, powerCoreProduction }
}

/**
 * Advances the game by exactly one logical tick. Rolls real crits (not the
 * expected-value approximation offline catch-up uses) so they visibly
 * flash/show on the board - see rollCrits, firePowerCoreGenerators. Alpha
 * 0.31: no more buff-firing step - buffs are resolved live inside
 * recalculate() itself now (see resolveBuffMultipliers), not advanced here.
 */
export function tick(state: GameState, rng: () => number = Math.random): TickResult {
  state.tickCount += 1
  const critMultipliers = rollCrits(state, rng)
  const powerCoreGeneratorAmounts = firePowerCoreGenerators(state)
  const result = recalculate(state, critMultipliers, powerCoreGeneratorAmounts)
  state.currency = state.currency.plus(result.production)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  state.currentRunEnergyEarned = state.currentRunEnergyEarned.plus(result.production)
  state.powerCores = state.powerCores.plus(result.powerCoreProduction)
  return result
}
