import Decimal from 'break_infinity.js'
import type { Facing, GameState, TickResult } from './types'
import { cellIndex } from './types'
import {
  BASIC_BASE_VALUE,
  BASIC_MULT,
  BUFF_V1_PCT_PER_FIRING,
  BUFF_V2_PCT_PER_FIRING,
  MIN_BUFF_POWER_PER_FIRING,
  BUFF_TICK_INTERVAL,
  POWER_CORE_GENERATOR_BASE_TICKS,
  POWER_CORE_GENERATOR_TICKS_PER_LEVEL,
} from './config'
import {
  generatorValueMultiplier,
  basicValueBonus,
  critChanceFor,
  critAmountFor,
  powerCoreChanceFor,
  powerCoreAmountFor,
  buffScalingBaseValue,
} from './upgrades'

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height
}

// --- Buff V1 facing: levels buy coverage, not power (see config.ts). Level 0
// targets exactly one orthogonal neighbour, chosen by the player and
// rotatable in place (deviation from the original spec's "all 4 orthogonal
// neighbours" - see types.ts). Level 1 also targets the opposite side.
// Level 2 targets all 4. ---

const FACING_DELTA: Record<Facing, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
}

/** Clockwise rotation order: up -> right -> down -> left -> up. Also level 2's full coverage set. */
export const FACING_ORDER: Facing[] = ['up', 'right', 'down', 'left']

const AXIS_PAIR: Record<Facing, [Facing, Facing]> = {
  up: ['up', 'down'],
  down: ['up', 'down'],
  left: ['left', 'right'],
  right: ['left', 'right'],
}

function isVertical(facing: Facing): boolean {
  return facing === 'up' || facing === 'down'
}

/**
 * Rotates `facing` one step, per Buff V1's level: level 0 cycles through all
 * 4 sides one at a time (today's behaviour); level 1 toggles between the two
 * axes (vertical <-> horizontal) - self-normalising, so whichever single side
 * was inherited from level 0 still toggles correctly; level 2 is a no-op,
 * since every side is already active and there's nothing left to choose.
 */
export function nextFacing(facing: Facing, level: number): Facing {
  if (level <= 0) {
    const i = FACING_ORDER.indexOf(facing)
    return FACING_ORDER[(i + 1) % FACING_ORDER.length]
  }
  if (level === 1) {
    return isVertical(facing) ? 'right' : 'up'
  }
  return facing // level >= 2: all sides active, nothing to rotate
}

/** The cell index a Buff V1 at (x,y) facing `facing` targets, or null if that points off the board. */
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

/** Which sides a Buff V1 at this level currently targets - 1, 2 (opposite pair), or all 4. Position-independent, used by both facingTargetIndices below and the grid UI's multi-arrow rendering. */
export function activeFacings(facing: Facing, level: number): Facing[] {
  if (level <= 0) return [facing]
  if (level === 1) return AXIS_PAIR[facing]
  return FACING_ORDER
}

/** Every cell index a Buff V1 at (x,y) with the given level/facing currently targets - 1, 2, or 4 of them, off-board ones dropped. */
export function facingTargetIndices(
  x: number,
  y: number,
  facing: Facing,
  level: number,
  width: number,
  height: number,
): number[] {
  const out: number[] = []
  for (const f of activeFacings(facing, level)) {
    const idx = facingTargetIndex(x, y, f, width, height)
    if (idx !== null) out.push(idx)
  }
  return out
}

/**
 * Facing to use for a newly-placed Buff V1 at (x,y): points at an adjacent
 * Basic if one already exists, otherwise the first in-bounds direction.
 */
export function defaultFacingFor(state: GameState, x: number, y: number): Facing {
  const { width, height, cells } = state
  for (const facing of FACING_ORDER) {
    const idx = facingTargetIndex(x, y, facing, width, height)
    if (idx !== null && cells[idx].type === 'basic') return facing
  }
  for (const facing of FACING_ORDER) {
    if (facingTargetIndex(x, y, facing, width, height) !== null) return facing
  }
  return 'up'
}

/** Rotates the Buff V1 at (x,y) one step, per its level. Returns whether it happened (false if not a Buff V1). */
export function rotateBuffFacing(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type !== 'buffV1') return false
  cell.facing = nextFacing(cell.facing, cell.level)
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
 * per the required optimisation (spec §5).
 */
export function leechRangeIndices(x: number, y: number, level: number, width: number, height: number): number[] {
  if (level <= 0) return neighborIndices(x, y, width, height, ORTHOGONAL_DELTAS)
  if (level === 1) return neighborIndices(x, y, width, height, MOORE_DELTAS)
  return []
}

/**
 * Power added per firing, per targeted side, for a Buff V1 - a percentage of
 * buffScalingBaseValue rather than a hardcoded flat number (see config.ts
 * BUFF_V1_PCT_PER_FIRING for why), floored at MIN_BUFF_POWER_PER_FIRING.
 * Level only buys coverage for V1 (see facingTargetIndices), never rate.
 */
export function buffV1PowerPerFiring(state: GameState): number {
  return Math.max(MIN_BUFF_POWER_PER_FIRING, buffScalingBaseValue(state) * BUFF_V1_PCT_PER_FIRING)
}

/**
 * Power added per firing, to every Basic on the board, for a Buff V2 at this
 * level - same scaling-percentage idea as buffV1PowerPerFiring, but the rate
 * itself grows with level (0.5% -> 8%, see BUFF_V2_PCT_PER_FIRING) since V2's
 * coverage is already maximal (whole board) from level 0.
 */
export function buffV2PowerPerFiring(state: GameState, level: number): number {
  return Math.max(MIN_BUFF_POWER_PER_FIRING, buffScalingBaseValue(state) * BUFF_V2_PCT_PER_FIRING[level])
}

/**
 * Applies `times` buff firings at once - O(cells), not O(cells * times).
 * Buff V1: each firing gives buffV1PowerPerFiring(state) to every cell it
 * currently targets (1/2/4 depending on level - see facingTargetIndices),
 * only if that cell is a Basic. Buff V2: each firing gives
 * buffV2PowerPerFiring(state, level) to EVERY Basic on the board, regardless
 * of position, summed across every Buff V2 placed.
 *
 * Both power-per-firing values are computed once up front, not per cell -
 * they depend only on account-wide upgrade state (buffScalingBaseValue),
 * never on anything that changes mid-loop, so this stays O(cells) and the
 * result stays a genuinely FIXED increment per firing across the whole call -
 * exactly what keeps offline.ts's closed-form catch-up valid, since it treats
 * production as linear in "firings so far" (see offline.ts's own comment on
 * applyOfflineProgress). `times` > 1 is what makes that catch-up possible: a
 * day away is ~17,000 firings, applied here in one pass instead of looping
 * firing-by-firing.
 */
export function advanceBuffsBy(state: GameState, times: number): void {
  if (times <= 0) return
  const { width, height, cells } = state
  const v1Power = buffV1PowerPerFiring(state)

  let buffV2Power = 0
  for (const cell of cells) {
    if (cell.type === 'buffV2') buffV2Power += buffV2PowerPerFiring(state, cell.level)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[cellIndex(x, y, width)]
      if (cell.type !== 'buffV1') continue
      for (const targetIdx of facingTargetIndices(x, y, cell.facing, cell.level, width, height)) {
        const target = cells[targetIdx]
        if (target.type !== 'basic') continue
        target.buffAccum = target.buffAccum.plus(v1Power * times)
      }
    }
  }

  if (buffV2Power > 0) {
    for (const cell of cells) {
      if (cell.type === 'basic') cell.buffAccum = cell.buffAccum.plus(buffV2Power * times)
    }
  }
}

/** Step 2 of the tick order: a single firing. */
export function advanceBuffs(state: GameState): void {
  advanceBuffsBy(state, 1)
}

/**
 * One crit multiplier per cell (1 = no crit), rolled fresh each call - basics
 * only, everything else stays at 1. `rng` is injectable so callers (and
 * tests) can force deterministic outcomes; real gameplay uses Math.random.
 */
export function rollCrits(state: GameState, rng: () => number = Math.random): number[] {
  const n = state.cells.length
  const multipliers: number[] = new Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'basic') continue
    if (rng() < critChanceFor(state, cell.level)) {
      multipliers[i] = critAmountFor(state, cell.level)
    }
  }
  return multipliers
}

/**
 * Expected crit multiplier per cell - `1 + chance * (amount - 1)`, a constant
 * scalar per Basic rather than a coin flip. This is what keeps
 * applyOfflineProgress()'s closed-form math exact: base stays a linear
 * function of buffAccum with this folded in, so the existing two-sample
 * derivation in offline.ts needs no changes to account for crit.
 */
export function expectedCritMultipliers(state: GameState): number[] {
  const n = state.cells.length
  const multipliers: number[] = new Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'basic') continue
    const chance = critChanceFor(state, cell.level)
    const amount = critAmountFor(state, cell.level)
    multipliers[i] = 1 + chance * (amount - 1)
  }
  return multipliers
}

/**
 * A Power Core Generator's period in ticks - how often it produces (10 at
 * level 0, down to 6 at level 4, confirmed with the user as a per-cell
 * value, since every generator is leveled independently rather than sharing
 * one global timer the way Buffs do).
 */
export function powerCoreGeneratorPeriod(level: number): number {
  return POWER_CORE_GENERATOR_BASE_TICKS - level * POWER_CORE_GENERATOR_TICKS_PER_LEVEL
}

/**
 * Advances every Power Core Generator's progress by exactly one real tick,
 * mutating `coreProgress` for real, and returns how many power cores each
 * cell produced THIS tick (0 for cells that didn't cross their period
 * boundary, or aren't a generator). This is what recalculate() uses to seed
 * `basePowerCores` for a live tick - offline catch-up uses its own
 * closed-form per-cell-period derivation instead (see offline.ts), since
 * this per-tick approach doesn't scale to a day-long gap.
 */
export function firePowerCoreGenerators(state: GameState): Decimal[] {
  const n = state.cells.length
  const amounts: Decimal[] = new Array(n).fill(new Decimal(0))
  const amount = powerCoreAmountFor(state)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'powerCoreGenerator') continue
    const period = powerCoreGeneratorPeriod(cell.level)
    cell.coreProgress += 1
    if (cell.coreProgress >= period) {
      cell.coreProgress -= period
      amounts[i] = new Decimal(amount)
    }
  }
  return amounts
}

/**
 * One power-core-chance roll per applicable cell (Basic and Leech - both
 * "produce energy", confirmed to include Leech - each rolling
 * independently, unlike crit which resolves once and is visible to Leech
 * through `base`; a power-core-chance proc is a private bonus to whichever
 * cell rolled it, not something a neighbouring Leech can steal). Returns the
 * amount produced per cell (0 on a miss).
 */
export function rollPowerCoreProcs(state: GameState, rng: () => number = Math.random): Decimal[] {
  const n = state.cells.length
  const amounts: Decimal[] = new Array(n).fill(new Decimal(0))
  const chance = powerCoreChanceFor(state)
  const amount = powerCoreAmountFor(state)
  for (let i = 0; i < n; i++) {
    const cell = state.cells[i]
    if (cell.type !== 'basic' && cell.type !== 'leech') continue
    if (rng() < chance) amounts[i] = new Decimal(amount)
  }
  return amounts
}

/**
 * Expected power cores produced per tick, per cell - a stable average rather
 * than a live per-tick snapshot (which is 0 on almost every tick and spikes
 * on the rare one something actually procs, the same "bounces around"
 * problem crit has - see expectedCritMultipliers above). Two averaged
 * sources, fed through the same Leech-stealing pass recalculate() uses for a
 * real tick so a Leech's number properly includes what it'd expect to steal:
 * Power Core Chance's constant rate (chance x amount, private to whichever
 * Basic/Leech it belongs to) and each Power Core Generator's duty-cycle rate
 * (amount / period), rather than its instantaneous 0-or-a-lump-sum state.
 */
export function expectedPowerCoreProduction(state: GameState): Decimal[] {
  const chance = powerCoreChanceFor(state)
  const amount = powerCoreAmountFor(state)
  const chanceRate = new Decimal(chance).times(amount)
  const chanceAmounts = state.cells.map((c) => (c.type === 'basic' || c.type === 'leech' ? chanceRate : new Decimal(0)))
  const generatorAmounts = state.cells.map((c) =>
    c.type === 'powerCoreGenerator' ? new Decimal(amount).div(powerCoreGeneratorPeriod(c.level)) : new Decimal(0),
  )
  return recalculate(state, undefined, generatorAmounts, chanceAmounts).finalPowerCores
}

/**
 * The two-pass board evaluation. Pass 2 reads only base[], never final[] -
 * this is what keeps the calculation terminating instead of an unstable
 * feedback loop (spec §5, §15 rule 2).
 *
 * `critMultipliers`, if given, is one multiplier per cell (see rollCrits /
 * expectedCritMultipliers) applied to each Basic's `base` - so crit IS
 * visible to a Leech reading that base, unlike BASIC_MULT below, which stays
 * private to a Basic's own final output. Omitted entirely (the default) for
 * pure display/preview calls, which should show honest, un-critted values.
 *
 * `powerCoreGeneratorAmounts`/`powerCoreChanceAmounts`, if given, are what
 * firePowerCoreGenerators()/rollPowerCoreProcs() returned for THIS
 * evaluation - see the parallel power-core pipeline below, which mirrors the
 * energy one almost exactly except a Power Core Chance proc is private to
 * whichever Basic/Leech rolled it (added directly in pass 2, never part of
 * the Leech-stealable base_pc array) rather than visible to Leech the way
 * crit is.
 */
export function recalculate(
  state: GameState,
  critMultipliers?: number[],
  powerCoreGeneratorAmounts?: Decimal[],
  powerCoreChanceAmounts?: Decimal[],
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

  // --- Pass 1a: basics, buffs, and power core generators. Leeches depend on
  // these; never the reverse. ---
  // Deviation from the original spec: a Basic's `base` (what Leeches read) no
  // longer grows with its own level at all - that flat growth moved out into
  // the account-wide Basic Generator Value upgrade (basicValueBonus). A
  // Basic's own level instead drives crit chance/amount only (see
  // upgrades.ts) and BASIC_MULT below, which - like before - applies only to
  // the Basic's own output, never to what a Leech sees.
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    if (cell.type === 'basic') {
      const raw = new Decimal(BASIC_BASE_VALUE + valueBonus).plus(cell.buffAccum).times(valueMult)
      const critMult = critMultipliers ? critMultipliers[i] : 1
      base[i] = raw.times(critMult)
      crits[i] = critMult > 1
    } else {
      base[i] = new Decimal(0) // buffV1, buffV2, empty, powerCoreGenerator, and leech (leech filled in below)
    }
    // basePowerCores: only a generator's own proc is "stealable" by a Leech -
    // a Basic/Leech's own Power Core Chance proc is private, added in pass 2
    // instead (never part of this array, so it can't be stolen).
    basePowerCores[i] = cell.type === 'powerCoreGenerator' && powerCoreGeneratorAmounts ? powerCoreGeneratorAmounts[i] : new Decimal(0)
  }

  // Running sums of all non-leech base values, computed once - O(N). Required
  // so level-2 (whole board) leeches are O(1) instead of O(N) each.
  let nonLeechSum = new Decimal(0)
  let nonLeechPowerCoreSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type !== 'leech') {
      nonLeechSum = nonLeechSum.plus(base[i])
      nonLeechPowerCoreSum = nonLeechPowerCoreSum.plus(basePowerCores[i])
    }
  }

  // --- Pass 1b: leech.base = sum of NON-LEECH base values within range (energy and power cores both) ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      if (cell.level >= 2) {
        base[i] = nonLeechSum // whole board; nonLeechSum already excludes leeches
        basePowerCores[i] = nonLeechPowerCoreSum
      } else {
        let sum = new Decimal(0)
        let pcSum = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type !== 'leech') {
            sum = sum.plus(base[j])
            pcSum = pcSum.plus(basePowerCores[j])
          }
        }
        base[i] = sum
        basePowerCores[i] = pcSum
      }
    }
  }

  // Running sums of all leech base values, computed once after pass 1b -
  // required so level-2 leeches can read "other leeches" in O(1) in pass 2.
  let leechBaseSum = new Decimal(0)
  let leechPowerCoreBaseSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type === 'leech') {
      leechBaseSum = leechBaseSum.plus(base[i])
      leechPowerCoreBaseSum = leechPowerCoreBaseSum.plus(basePowerCores[i])
    }
  }

  // --- Pass 2: final values, reading only base[]/basePowerCores[] ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      const chanceProc = powerCoreChanceAmounts ? powerCoreChanceAmounts[i] : new Decimal(0)
      if (cell.type === 'basic') {
        // The level multiplier applies here, to the Basic's own output only.
        // base[i] (pre-multiplier, but crit-inclusive) is what Leeches read
        // in pass 1b above.
        final[i] = base[i].times(BASIC_MULT[cell.level])
        finalPowerCores[i] = chanceProc // private Power Core Chance proc only - nothing to steal from
      } else if (cell.type === 'buffV1' || cell.type === 'buffV2' || cell.type === 'empty') {
        final[i] = new Decimal(0)
        finalPowerCores[i] = new Decimal(0)
      } else if (cell.type === 'powerCoreGenerator') {
        final[i] = new Decimal(0) // produces power cores only, no energy
        // No private per-cell multiplier the way BASIC_MULT is for Basic -
        // the cell's own level only sets its period (speed), not the amount.
        finalPowerCores[i] = basePowerCores[i]
      } else {
        // leech.final = leech.base + sum of OTHER leeches' base values within range (energy and power cores both)
        if (cell.level >= 2) {
          final[i] = base[i].plus(leechBaseSum.minus(base[i]))
          finalPowerCores[i] = basePowerCores[i].plus(leechPowerCoreBaseSum.minus(basePowerCores[i])).plus(chanceProc)
        } else {
          let otherLeeches = new Decimal(0)
          let otherLeechesPowerCores = new Decimal(0)
          for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
            if (cells[j].type === 'leech') {
              otherLeeches = otherLeeches.plus(base[j])
              otherLeechesPowerCores = otherLeechesPowerCores.plus(basePowerCores[j])
            }
          }
          final[i] = base[i].plus(otherLeeches)
          // Own steal (from nearby generators) + other leeches' steal within
          // range + this Leech's own private Power Core Chance proc.
          finalPowerCores[i] = basePowerCores[i].plus(otherLeechesPowerCores).plus(chanceProc)
        }
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
 * Advances the game by exactly one logical tick, per the tick order in spec
 * §5. Rolls real crits and power-core procs (not the expected-value
 * approximations offline catch-up uses) so they visibly flash/show on the
 * board - see rollCrits, firePowerCoreGenerators, rollPowerCoreProcs.
 */
export function tick(state: GameState, rng: () => number = Math.random): TickResult {
  state.tickCount += 1
  if (state.tickCount % BUFF_TICK_INTERVAL === 0) {
    advanceBuffs(state)
  }
  const critMultipliers = rollCrits(state, rng)
  const powerCoreGeneratorAmounts = firePowerCoreGenerators(state)
  const powerCoreChanceAmounts = rollPowerCoreProcs(state, rng)
  const result = recalculate(state, critMultipliers, powerCoreGeneratorAmounts, powerCoreChanceAmounts)
  state.currency = state.currency.plus(result.production)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  state.currentRunEnergyEarned = state.currentRunEnergyEarned.plus(result.production)
  state.powerCores = state.powerCores.plus(result.powerCoreProduction)
  return result
}
