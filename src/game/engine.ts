import Decimal from 'break_infinity.js'
import type { Facing, GameState, TickResult } from './types'
import { cellIndex } from './types'
import { BASIC_BASE_VALUE, BASIC_MULT, BUFF_POWER, BUFF_TICK_INTERVAL } from './config'

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height
}

// --- Buff facing: a Buff targets exactly one orthogonal neighbour, chosen by
// the player and rotatable in place (deviation from the original spec's
// "all 4 orthogonal neighbours" - see types.ts). ---

const FACING_DELTA: Record<Facing, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
}

/** Clockwise rotation order: up -> right -> down -> left -> up. */
export const FACING_ORDER: Facing[] = ['up', 'right', 'down', 'left']

export function nextFacing(facing: Facing): Facing {
  const i = FACING_ORDER.indexOf(facing)
  return FACING_ORDER[(i + 1) % FACING_ORDER.length]
}

/** The cell index a Buff at (x,y) facing `facing` targets, or null if that points off the board. */
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
 * Facing to use for a newly-placed Buff at (x,y): points at an adjacent
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

/** Rotates the Buff at (x,y) one step clockwise. Returns whether it happened (false if not a buff). */
export function rotateBuffFacing(state: GameState, x: number, y: number): boolean {
  const cell = state.cells[cellIndex(x, y, state.width)]
  if (cell.type !== 'buff') return false
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
 * Indices a leech at (x,y) with the given level reads from.
 * Level 3 (whole board) is NOT represented here - it's handled separately via
 * precomputed running sums, per the required optimisation (spec §5).
 */
function leechRangeIndices(x: number, y: number, level: number, width: number, height: number): number[] {
  if (level <= 1) return neighborIndices(x, y, width, height, ORTHOGONAL_DELTAS)
  if (level === 2) return neighborIndices(x, y, width, height, MOORE_DELTAS)
  return []
}

/**
 * Applies `times` buff firings at once - O(cells), not O(cells * times).
 * Each firing gives a Buff's power to whichever single cell it currently
 * faces, only if that cell is a Basic. (Deviation from the original spec's
 * "hits all 4 orthogonal neighbours": one target, chosen by facing - see
 * types.ts.)
 *
 * `times` > 1 is what makes offline.ts's closed-form catch-up possible: a
 * day away is ~17,000 firings, and this applies all of them in one pass
 * instead of looping firing-by-firing.
 */
export function advanceBuffsBy(state: GameState, times: number): void {
  if (times <= 0) return
  const { width, height, cells } = state
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[cellIndex(x, y, width)]
      if (cell.type !== 'buff') continue
      const targetIdx = facingTargetIndex(x, y, cell.facing, width, height)
      if (targetIdx === null) continue
      const target = cells[targetIdx]
      if (target.type !== 'basic') continue
      target.buffAccum = target.buffAccum.plus(BUFF_POWER[cell.level] * times)
    }
  }
}

/** Step 2 of the tick order: a single firing. */
export function advanceBuffs(state: GameState): void {
  advanceBuffsBy(state, 1)
}

/**
 * The two-pass board evaluation. Pass 2 reads only base[], never final[] -
 * this is what keeps the calculation terminating instead of an unstable
 * feedback loop (spec §5, §15 rule 2).
 */
export function recalculate(state: GameState): TickResult {
  const { width, height, cells } = state
  const n = width * height
  const base: Decimal[] = new Array(n)
  const final: Decimal[] = new Array(n)

  // --- Pass 1a: basics and buffs. Leeches depend on these; never the reverse. ---
  // Deviation from the original spec: a Basic's `base` (what Leeches read)
  // grows by a flat +1 per level, not by the level multiplier. The
  // multiplier is applied afterwards, in pass 2, to the Basic's own output
  // only - Leeches never see the multiplied value. This keeps a leveled-up
  // Basic's own production high without letting a Leech farm that same
  // multiplier by proxy.
  for (let i = 0; i < n; i++) {
    const cell = cells[i]
    if (cell.type === 'basic') {
      base[i] = new Decimal(BASIC_BASE_VALUE).plus(cell.buffAccum).plus(cell.level - 1)
    } else {
      base[i] = new Decimal(0) // buff, empty, and leech (leech filled in below)
    }
  }

  // Running sum of all non-leech base values, computed once - O(N). Required
  // so level-3 (whole board) leeches are O(1) instead of O(N) each.
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
      if (cell.level >= 3) {
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
  // required so level-3 leeches can read "other leeches" in O(1) in pass 2.
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
        // base[i] (pre-multiplier) is what Leeches read in pass 1b above.
        final[i] = base[i].times(BASIC_MULT[cell.level])
      } else if (cell.type === 'buff' || cell.type === 'empty') {
        final[i] = new Decimal(0)
      } else {
        // leech.final = leech.base + sum of OTHER leeches' base values within range
        if (cell.level >= 3) {
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

  return { base, final, production }
}

/** Advances the game by exactly one logical tick, per the tick order in spec §5. */
export function tick(state: GameState): TickResult {
  state.tickCount += 1
  if (state.tickCount % BUFF_TICK_INTERVAL === 0) {
    advanceBuffs(state)
  }
  const result = recalculate(state)
  state.currency = state.currency.plus(result.production)
  state.lifetimeCurrencyEarned = state.lifetimeCurrencyEarned.plus(result.production)
  return result
}
