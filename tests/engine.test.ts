import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import { recalculate, tick, rotateBuffFacing, facingTargetIndex, FACING_ORDER } from '../src/game/engine'
import { BASIC_MULT } from '../src/game/config'
import type { GameState, CellType, Facing } from '../src/game/types'

function place(state: GameState, x: number, y: number, type: CellType, level: number, facing?: Facing) {
  const i = cellIndex(x, y, state.width)
  state.cells[i].type = type
  state.cells[i].level = level
  if (facing) state.cells[i].facing = facing
}

describe('engine', () => {
  it('1. single basic, level 1, value 1, empty board -> production 1', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'basic', 1)
    const result = recalculate(state)
    expect(result.production.toNumber()).toBe(1)
  })

  it('2. the three-leech grid: bases 2/2/2, finals 4/6/4, total 20, stable after 100 ticks', () => {
    const state = makeGameState(3, 3)
    // row 0: basics
    place(state, 0, 0, 'basic', 1)
    place(state, 1, 0, 'basic', 1)
    place(state, 2, 0, 'basic', 1)
    // row 1: level-1 leeches
    place(state, 0, 1, 'leech', 1)
    place(state, 1, 1, 'leech', 1)
    place(state, 2, 1, 'leech', 1)
    // row 2: basics
    place(state, 0, 2, 'basic', 1)
    place(state, 1, 2, 'basic', 1)
    place(state, 2, 2, 'basic', 1)

    const result = recalculate(state)
    const leechBases = [0, 1, 2].map((x) => result.base[cellIndex(x, 1, 3)].toNumber())
    expect(leechBases).toEqual([2, 2, 2])

    const leechFinals = [0, 1, 2].map((x) => result.final[cellIndex(x, 1, 3)].toNumber())
    expect(leechFinals).toEqual([4, 6, 4])

    expect(result.production.toNumber()).toBe(20)

    // Regression test for the feedback loop: production must stay exactly 20,
    // tick after tick, with no drift or blowup.
    for (let i = 0; i < 100; i++) {
      const r = tick(state)
      expect(r.production.toNumber()).toBe(20)
    }
    expect(state.currency.toNumber()).toBe(2000) // 100 ticks * 20
  })

  it('3. buff accumulation: basic base increases by 1 at tick 5, 10, 15, not between', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 1)
    place(state, 1, 0, 'buff', 1, 'left') // facing the basic at (0, 0)

    const baseAt = (t: number) => {
      const r = tick(state)
      void t
      return r.base[cellIndex(0, 0, state.width)].toNumber()
    }

    expect(baseAt(1)).toBe(1) // tick 1
    expect(baseAt(2)).toBe(1)
    expect(baseAt(3)).toBe(1)
    expect(baseAt(4)).toBe(1)
    expect(baseAt(5)).toBe(2) // tick 5: +1
    expect(baseAt(6)).toBe(2)
    expect(baseAt(7)).toBe(2)
    expect(baseAt(8)).toBe(2)
    expect(baseAt(9)).toBe(2)
    expect(baseAt(10)).toBe(3) // tick 10: +1
    expect(baseAt(11)).toBe(3)
    expect(baseAt(12)).toBe(3)
    expect(baseAt(13)).toBe(3)
    expect(baseAt(14)).toBe(3)
    expect(baseAt(15)).toBe(4) // tick 15: +1
  })

  it('4. level 3 leech on a filled board matches the naive whole-board sum', () => {
    const state = makeGameState(4, 4)
    // Fill the board with a mix of basics, buffs, and one level-3 leech.
    let level = 1
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = cellIndex(x, y, 4)
        if (x === 3 && y === 3) {
          state.cells[i].type = 'leech'
          state.cells[i].level = 3
        } else if ((x + y) % 2 === 0) {
          state.cells[i].type = 'basic'
          state.cells[i].level = (level % 10) + 1
          level++
        } else {
          state.cells[i].type = 'buff'
          state.cells[i].level = (level % 5) + 1
          level++
        }
      }
    }

    const result = recalculate(state)

    // Naive whole-board sum: every non-leech cell's base value. A Basic's
    // base is BASIC_BASE_VALUE + buffAccum + (level - 1) - the multiplier
    // applies only to its own final output, not to what a Leech reads.
    let naiveSum = new Decimal(0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = cellIndex(x, y, 4)
        const cell = state.cells[i]
        if (cell.type === 'basic') {
          naiveSum = naiveSum.plus(new Decimal(1).plus(cell.buffAccum).plus(cell.level - 1))
        }
        // buffs contribute 0 to base, empty contribute 0
      }
    }

    const leechIdx = cellIndex(3, 3, 4)
    expect(result.base[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
    // Only one leech on the board, so final == base (no other leeches to add).
    expect(result.final[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
  })

  it('5. buff before multiplier: a buff next to a level 5 basic gives more output than next to a level 1 basic', () => {
    const highState = makeGameState(2, 1)
    place(highState, 0, 0, 'basic', 5)
    place(highState, 1, 0, 'buff', 1, 'left') // facing the basic at (0, 0)

    const lowState = makeGameState(2, 1)
    place(lowState, 0, 0, 'basic', 1)
    place(lowState, 1, 0, 'buff', 1, 'left') // facing the basic at (0, 0)

    // Advance both boards to tick 5 so the buff has fired once.
    let highResult = recalculate(highState)
    let lowResult = recalculate(lowState)
    for (let i = 0; i < 5; i++) {
      highResult = tick(highState)
      lowResult = tick(lowState)
    }

    expect(highResult.production.toNumber()).toBeGreaterThan(lowResult.production.toNumber())
  })

  it('6. a buff only buffs the single cell it faces, not other adjacent basics', () => {
    // Buff at (1,1) surrounded by 4 basics, facing only 'up'.
    const state = makeGameState(3, 3)
    place(state, 1, 0, 'basic', 1) // up
    place(state, 1, 2, 'basic', 1) // down
    place(state, 0, 1, 'basic', 1) // left
    place(state, 2, 1, 'basic', 1) // right
    place(state, 1, 1, 'buff', 1, 'up')

    for (let i = 0; i < 5; i++) tick(state)

    expect(state.cells[cellIndex(1, 0, 3)].buffAccum.toNumber()).toBe(1) // targeted: gained power
    expect(state.cells[cellIndex(1, 2, 3)].buffAccum.toNumber()).toBe(0) // not targeted
    expect(state.cells[cellIndex(0, 1, 3)].buffAccum.toNumber()).toBe(0) // not targeted
    expect(state.cells[cellIndex(2, 1, 3)].buffAccum.toNumber()).toBe(0) // not targeted
  })

  it('7. rotateBuffFacing cycles clockwise and wraps, and is a no-op on non-buff cells', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'buff', 1, 'up')

    const seen: Facing[] = [state.cells[cellIndex(1, 1, 3)].facing]
    for (let i = 0; i < 4; i++) {
      rotateBuffFacing(state, 1, 1)
      seen.push(state.cells[cellIndex(1, 1, 3)].facing)
    }
    expect(seen).toEqual(['up', 'right', 'down', 'left', 'up']) // full rotation, back to start
    expect(seen.slice(0, 4).sort()).toEqual([...FACING_ORDER].sort())

    place(state, 0, 0, 'basic', 1)
    expect(rotateBuffFacing(state, 0, 0)).toBe(false) // not a buff, no-op
  })

  it('8. a buff facing off the board targets nothing (no crash, no effect)', () => {
    const state = makeGameState(2, 2)
    place(state, 0, 0, 'buff', 1, 'up') // (0,-1) is off-board
    place(state, 1, 0, 'basic', 1)

    expect(facingTargetIndex(0, 0, 'up', 2, 2)).toBeNull()

    for (let i = 0; i < 5; i++) tick(state)
    expect(state.cells[cellIndex(1, 0, 2)].buffAccum.toNumber()).toBe(0)
  })

  it('9. a leveled-up basic: its own output is multiplied, but a Leech only ever reads the pre-multiplier base', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 3) // base = 1 + 0 + (3-1) = 3; own output = 3 * BASIC_MULT[3]
    place(state, 1, 0, 'leech', 1)

    const result = recalculate(state)
    const basicIdx = cellIndex(0, 0, 3)
    const leechIdx = cellIndex(1, 0, 3)

    expect(result.base[basicIdx].toNumber()).toBe(3) // pre-multiplier: what the Leech reads
    expect(result.final[basicIdx].toNumber()).toBe(3 * BASIC_MULT[3]) // own output: multiplied
    expect(result.base[leechIdx].toNumber()).toBe(3) // Leech read the pre-multiplier base, not 3 * BASIC_MULT[3]
    expect(result.final[leechIdx].toNumber()).toBe(3) // no other leeches on this board
  })
})
