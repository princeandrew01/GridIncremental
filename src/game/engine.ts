import Decimal from 'break_infinity.js'
import type { Facing, GameState, TickResult } from './types'
import { cellIndex } from './types'
import { BASIC_BASE_VALUE, BASIC_MULT, BUFF_V1_POWER, BUFF_V2_POWER, BUFF_TICK_INTERVAL } from './config'
import { generatorValueMultiplier, basicValueBonus, critChanceFor, critAmountFor } from './upgrades'

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
function leechRangeIndices(x: number, y: number, level: number, width: number, height: number): number[] {
  if (level <= 0) return neighborIndices(x, y, width, height, ORTHOGONAL_DELTAS)
  if (level === 1) return neighborIndices(x, y, width, height, MOORE_DELTAS)
  return []
}

/**
 * Applies `times` buff firings at once - O(cells), not O(cells * times).
 * Buff V1: each firing gives BUFF_V1_POWER to every cell it currently
 * targets (1/2/4 depending on level - see facingTargetIndices), only if that
 * cell is a Basic. Buff V2: each firing gives its level's power to EVERY
 * Basic on the board, regardless of position.
 *
 * `times` > 1 is what makes offline.ts's closed-form catch-up possible: a
 * day away is ~17,000 firings, and this applies all of them in one pass
 * instead of looping firing-by-firing. Both buff types stay O(cells) here,
 * so that closed-form property is preserved.
 */
export function advanceBuffsBy(state: GameState, times: number): void {
  if (times <= 0) return
  const { width, height, cells } = state

  let buffV2Power = 0
  for (const cell of cells) {
    if (cell.type === 'buffV2') buffV2Power += BUFF_V2_POWER[cell.level]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[cellIndex(x, y, width)]
      if (cell.type !== 'buffV1') continue
      for (const targetIdx of facingTargetIndices(x, y, cell.facing, cell.level, width, height)) {
        const target = cells[targetIdx]
        if (target.type !== 'basic') continue
        target.buffAccum = target.buffAccum.plus(BUFF_V1_POWER * times)
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
 * The two-pass board evaluation. Pass 2 reads only base[], never final[] -
 * this is what keeps the calculation terminating instead of an unstable
 * feedback loop (spec §5, §15 rule 2).
 *
 * `critMultipliers`, if given, is one multiplier per cell (see rollCrits /
 * expectedCritMultipliers) applied to each Basic's `base` - so crit IS
 * visible to a Leech reading that base, unlike BASIC_MULT below, which stays
 * private to a Basic's own final output. Omitted entirely (the default) for
 * pure display/preview calls, which should show honest, un-critted values.
 */
export function recalculate(state: GameState, critMultipliers?: number[]): TickResult {
  const { width, height, cells } = state
  const n = width * height
  const base: Decimal[] = new Array(n)
  const final: Decimal[] = new Array(n)
  const crits: boolean[] = new Array(n).fill(false)

  const valueMult = generatorValueMultiplier(state)
  const valueBonus = basicValueBonus(state)

  // --- Pass 1a: basics and buffs. Leeches depend on these; never the reverse. ---
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
      base[i] = new Decimal(0) // buffV1, buffV2, empty, and leech (leech filled in below)
    }
  }

  // Running sum of all non-leech base values, computed once - O(N). Required
  // so level-2 (whole board) leeches are O(1) instead of O(N) each.
  let nonLeechSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type !== 'leech') nonLeechSum = nonLeechSum.plus(base[i])
  }

  // --- Pass 1b: leech.base = sum of NON-LEECH base values within range ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type !== 'leech') continue
      if (cell.level >= 2) {
        base[i] = nonLeechSum // whole board; nonLeechSum already excludes leeches
      } else {
        let sum = new Decimal(0)
        for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
          if (cells[j].type !== 'leech') sum = sum.plus(base[j])
        }
        base[i] = sum
      }
    }
  }

  // Running sum of all leech base values, computed once after pass 1b -
  // required so level-2 leeches can read "other leeches" in O(1) in pass 2.
  let leechBaseSum = new Decimal(0)
  for (let i = 0; i < n; i++) {
    if (cells[i].type === 'leech') leechBaseSum = leechBaseSum.plus(base[i])
  }

  // --- Pass 2: final values, reading only base[] ---
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = cellIndex(x, y, width)
      const cell = cells[i]
      if (cell.type === 'basic') {
        // The level multiplier applies here, to the Basic's own output only.
        // base[i] (pre-multiplier, but crit-inclusive) is what Leeches read
        // in pass 1b above.
        final[i] = base[i].times(BASIC_MULT[cell.level])
      } else if (cell.type === 'buffV1' || cell.type === 'buffV2' || cell.type === 'empty') {
        final[i] = new Decimal(0)
      } else {
        // leech.final = leech.base + sum of OTHER leeches' base values within range
        if (cell.level >= 2) {
          final[i] = base[i].plus(leechBaseSum.minus(base[i]))
        } else {
          let otherLeeches = new Decimal(0)
          for (const j of leechRangeIndices(x, y, cell.level, width, height)) {
            if (cells[j].type === 'leech') otherLeeches = otherLeeches.plus(base[j])
          }
          final[i] = base[i].plus(otherLeeches)
        }
      }
    }
  }

  let production = new Decimal(0)
  for (let i = 0; i < n; i++) production = production.plus(final[i])

  return { base, final, production, crits }
}

/**
 * Advances the game by exactly one logical tick, per the tick order in spec
 * §5. Rolls real crits (not the expected-value approximation offline catch-up
 * uses) so they visibly flash on the board - see rollCrits.
 */
export function tick(state: GameState, rng: () => number = Math.random): TickResult {
  state.tickCount += 1
  if (state.tickCount % BUFF_TICK_INTERVAL === 0) {
    advanceBuffs(state)
  }
  const critMultipliers = rollCrits(state, rng)
  const result = recalculate(state, critMultipliers)
  state.currency = state.currency.plus(result.production)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  return result
}
