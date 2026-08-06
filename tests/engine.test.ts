import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import {
  recalculate,
  tick,
  rotateBuffFacing,
  facingTargetIndex,
  nextFacing,
  defaultFacingFor,
  rollCrits,
  expectedCritMultipliers,
  powerCoreGeneratorPeriod,
  firePowerCoreGenerators,
  resolveBuffMultipliers,
} from '../src/game/engine'
import { critChanceFor, critAmountFor } from '../src/game/upgrades'
import { BASIC_MULT, STEADY_TOWER_MULT, BUFF_PCT_PER_LEVEL, CRIT_TOWER_CHANCE_BONUS, CRIT_TOWER_AMOUNT_MULT } from '../src/game/config'
import type { GameState, CellType, Facing } from '../src/game/types'

function place(state: GameState, x: number, y: number, type: CellType, level: number, facing?: Facing) {
  const i = cellIndex(x, y, state.width)
  state.cells[i].type = type
  state.cells[i].level = level
  if (facing) state.cells[i].facing = facing
}

// Forces every crit roll to miss (rng() = 1 is never < any chance in [0,1)) -
// used throughout for tests that aren't about crit itself, so their expected
// values stay exact instead of occasionally getting a random boost.
const NEVER_CRIT = () => 1
// Forces every roll to hit (rng() = 0 is always < any positive chance).
const ALWAYS_CRIT = () => 0

describe('engine', () => {
  it('1. single basic, level 0, value 1, empty board -> production 1', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'basic', 0)
    const result = recalculate(state)
    expect(result.production.toNumber()).toBe(1)
  })

  it('2. the three-leech grid: bases 2/2/2, finals 4/6/4, total 20, stable after 100 ticks', () => {
    const state = makeGameState(3, 3)
    // row 0: basics
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'basic', 0)
    place(state, 2, 0, 'basic', 0)
    // row 1: level-0 leeches (orthogonal range)
    place(state, 0, 1, 'leech', 0)
    place(state, 1, 1, 'leech', 0)
    place(state, 2, 1, 'leech', 0)
    // row 2: basics
    place(state, 0, 2, 'basic', 0)
    place(state, 1, 2, 'basic', 0)
    place(state, 2, 2, 'basic', 0)

    const result = recalculate(state)
    const leechBases = [0, 1, 2].map((x) => result.base[cellIndex(x, 1, 3)].toNumber())
    expect(leechBases).toEqual([2, 2, 2])

    const leechFinals = [0, 1, 2].map((x) => result.final[cellIndex(x, 1, 3)].toNumber())
    expect(leechFinals).toEqual([4, 6, 4])

    expect(result.production.toNumber()).toBe(20)

    // Regression test: production must stay exactly 20, tick after tick, with
    // no drift or blowup - buffs no longer accumulate over time at all
    // (Alpha 0.31), so there's nothing left that could even drift here, but
    // this is still a cheap, valuable stability check. Crits forced off so
    // this stays exact rather than occasionally jumping.
    for (let i = 0; i < 100; i++) {
      const r = tick(state, NEVER_CRIT)
      expect(r.production.toNumber()).toBe(20)
    }
    expect(state.currency.toNumber()).toBe(2000) // 100 ticks * 20
  })

  it('3. level 2 leech (whole board) on a filled board matches the naive whole-board sum', () => {
    const state = makeGameState(4, 4)
    // Fill the board with a mix of basics, buffs, and one level-2 (whole-board) leech.
    let n = 0
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = cellIndex(x, y, 4)
        if (x === 3 && y === 3) {
          state.cells[i].type = 'leech'
          state.cells[i].level = 2
        } else if ((x + y) % 2 === 0) {
          state.cells[i].type = 'basic'
          state.cells[i].level = n % 11 // 0-10
          n++
        } else {
          state.cells[i].type = 'buff'
          state.cells[i].level = n % 10 // 0-9
          n++
        }
      }
    }

    const result = recalculate(state)
    const buffMult = resolveBuffMultipliers(state)

    // Naive whole-board sum: every non-leech cell's own FINAL output - a
    // Leech steals a share of what a cell actually produces (level
    // multiplier and any Buff on it included), not the pre-multiplier base
    // (confirmed with the user: "leech should leech the output value not
    // the base value"). Cross-checks the engine's own O(1) whole-board
    // running-sum path (nonLeechFinalSum) against summing every cell by
    // hand, using the same BASIC_MULT/resolveBuffMultipliers the engine
    // itself uses.
    let naiveSum = new Decimal(0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = cellIndex(x, y, 4)
        if (state.cells[i].type === 'basic') {
          naiveSum = naiveSum.plus(new Decimal(1).times(BASIC_MULT[state.cells[i].level]).times(buffMult[i]))
        }
      }
    }

    const leechIdx = cellIndex(3, 3, 4)
    expect(result.base[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
    // Only one leech on the board, so final == base (no other leeches to add).
    expect(result.final[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
  })

  it("4. a leveled-up basic's own output is multiplied, and a Leech steals that fully-multiplied output", () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 3) // base = 1 (level doesn't grow it); own output = 1 * BASIC_MULT[3]
    place(state, 1, 0, 'leech', 0)

    const result = recalculate(state)
    const basicIdx = cellIndex(0, 0, 3)
    const leechIdx = cellIndex(1, 0, 3)

    expect(result.base[basicIdx].toNumber()).toBe(1) // pre-multiplier: a display/diagnostic figure only
    expect(result.final[basicIdx].toNumber()).toBe(1 * BASIC_MULT[3]) // own output: multiplied
    expect(result.base[leechIdx].toNumber()).toBe(1 * BASIC_MULT[3]) // Leech's own collection = the basic's full final output
    expect(result.final[leechIdx].toNumber()).toBe(1 * BASIC_MULT[3]) // no other leeches on this board
  })

  it('5. a forced crit multiplier boosts a basic base and is visible to a neighbouring Leech (one roll, shared)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    const n = state.width * state.height
    const critMultipliers = new Array(n).fill(1)
    critMultipliers[cellIndex(0, 0, 3)] = 2 // force a x2 crit on the basic only

    const result = recalculate(state, critMultipliers)
    const basicIdx = cellIndex(0, 0, 3)
    const leechIdx = cellIndex(1, 0, 3)

    expect(result.base[basicIdx].toNumber()).toBe(2) // 1 (raw) * 2 (crit)
    expect(result.crits[basicIdx]).toBe(true)
    expect(result.base[leechIdx].toNumber()).toBe(2) // Leech inherits the already-critted base, no roll of its own
  })

  it('6. rollCrits only rolls for Basic-family cells, and rng threshold decides hit vs miss', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    place(state, 2, 0, 'buff', 0)

    const hit = rollCrits(state, ALWAYS_CRIT)
    expect(hit[cellIndex(0, 0, 3)]).toBe(critAmountFor(state, false))
    expect(hit[cellIndex(1, 0, 3)]).toBe(1) // leech never rolls its own crit
    expect(hit[cellIndex(2, 0, 3)]).toBe(1) // buffs never crit

    const miss = rollCrits(state, NEVER_CRIT)
    expect(miss[cellIndex(0, 0, 3)]).toBe(1)
  })

  it('7. expectedCritMultipliers is 1 + chance * (amount - 1) for a Basic-family cell, and exactly 1 elsewhere', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 3)
    place(state, 1, 0, 'leech', 0)

    const expected = expectedCritMultipliers(state)
    const chance = critChanceFor(state, false)
    const amount = critAmountFor(state, false)
    expect(expected[cellIndex(0, 0, 2)]).toBeCloseTo(1 + chance * (amount - 1), 12)
    expect(expected[cellIndex(1, 0, 2)]).toBe(1)
  })

  it('8. tick() with rng forced to always hit produces a crit-boosted production', () => {
    const critState = makeGameState(2, 1)
    place(critState, 0, 0, 'basic', 0)
    const noCritState = makeGameState(2, 1)
    place(noCritState, 0, 0, 'basic', 0)

    const critResult = tick(critState, ALWAYS_CRIT)
    const noCritResult = tick(noCritState, NEVER_CRIT)

    expect(critResult.crits[cellIndex(0, 0, 2)]).toBe(true)
    expect(critResult.production.toNumber()).toBeGreaterThan(noCritResult.production.toNumber())
    expect(critResult.production.toNumber()).toBeCloseTo(critAmountFor(critState, false), 9)
  })

  it('9. Crit Tower (basicCrit): +CRIT_TOWER_CHANCE_BONUS additive to chance, xCRIT_TOWER_AMOUNT_MULT multiplicative on amount', () => {
    const state = makeGameState(1, 1)
    const plainChance = critChanceFor(state, false)
    const plainAmount = critAmountFor(state, false)

    expect(critChanceFor(state, true)).toBeCloseTo(plainChance + CRIT_TOWER_CHANCE_BONUS, 12)
    expect(critAmountFor(state, true)).toBeCloseTo(plainAmount * CRIT_TOWER_AMOUNT_MULT, 9)

    // rollCrits/expectedCritMultipliers actually use it for a basicCrit cell.
    place(state, 0, 0, 'basicCrit', 10)
    const hit = rollCrits(state, ALWAYS_CRIT)
    expect(hit[cellIndex(0, 0, 1)]).toBeCloseTo(plainAmount * CRIT_TOWER_AMOUNT_MULT, 9)
  })

  it('10. Basic Steady (basicSteady): STEADY_TOWER_MULT on top of the same level multiplier every Basic-family cell uses', () => {
    const state = makeGameState(1, 1)
    place(state, 0, 0, 'basicSteady', 10) // must be maxed (level 10) to have evolved in the first place
    const result = recalculate(state, undefined)
    const expectedOwnMult = BASIC_MULT[10] * STEADY_TOWER_MULT
    expect(result.final[cellIndex(0, 0, 1)].toNumber()).toBeCloseTo(1 * expectedOwnMult, 9) // base 1, no crit forced off by default (undefined multipliers)
  })

  it('11. nextFacing cycles all 4 sides regardless of level (Alpha 0.31: level no longer buys coverage)', () => {
    expect(nextFacing('up')).toBe('right')
    expect(nextFacing('right')).toBe('down')
    expect(nextFacing('down')).toBe('left')
    expect(nextFacing('left')).toBe('up')
  })

  it('12. rotateBuffFacing works on buff and buffStacker, no-op on everything else', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'buff', 0, 'up')

    const seen: Facing[] = [state.cells[cellIndex(1, 1, 3)].facing]
    for (let i = 0; i < 4; i++) {
      rotateBuffFacing(state, 1, 1)
      seen.push(state.cells[cellIndex(1, 1, 3)].facing)
    }
    expect(seen).toEqual(['up', 'right', 'down', 'left', 'up']) // full rotation, back to start

    place(state, 0, 0, 'buffStacker', 0, 'up')
    expect(rotateBuffFacing(state, 0, 0)).toBe(true)
    expect(state.cells[cellIndex(0, 0, 3)].facing).toBe('right')

    place(state, 0, 1, 'basic', 0)
    expect(rotateBuffFacing(state, 0, 1)).toBe(false) // not directional

    place(state, 0, 2, 'buffAll', 0)
    expect(rotateBuffFacing(state, 0, 2)).toBe(false) // buffAll has no facing at all
  })

  it('13. a buff facing off the board targets nothing (no crash, no effect)', () => {
    const state = makeGameState(2, 2)
    place(state, 0, 0, 'buff', 9, 'up') // (0,-1) is off-board
    place(state, 1, 0, 'basic', 0)

    expect(facingTargetIndex(0, 0, 'up', 2, 2)).toBeNull()

    const result = recalculate(state)
    expect(result.final[cellIndex(1, 0, 2)].toNumber()).toBe(1) // unaffected - the buff points off-board, not at it
  })

  it('14. defaultFacingFor prefers an adjacent producer (Basic-family, Leech, or Power Core Generator) over an arbitrary direction', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 2, 'leech', 0) // below (1,1)
    expect(defaultFacingFor(state, 1, 1)).toBe('down')

    const empty = makeGameState(3, 3)
    expect(['up', 'right', 'down', 'left']).toContain(defaultFacingFor(empty, 1, 1)) // no producer nearby - just picks an in-bounds direction
  })

  it("15. a plain Buff boosts its target's own final output by 1 + its level's percentage, never touching base", () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'buff', 1, 'left') // level 1 = 20%, facing the basic

    const result = recalculate(state)
    const basicIdx = cellIndex(0, 0, 2)
    expect(result.base[basicIdx].toNumber()).toBe(1) // base unaffected - what a Leech would read
    expect(result.final[basicIdx].toNumber()).toBeCloseTo(1 * (1 + BUFF_PCT_PER_LEVEL[1]), 9) // 1 * 1.2
  })

  it('16. a Buff on a Leech boosts the Leech\'s own final output (both energy and power cores) - the exact worked example from the design doc: 3/tick -> 3.6/tick at a 20% buff', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 0, 'basic', 0) // up
    place(state, 0, 1, 'basic', 0) // left
    place(state, 2, 1, 'basic', 0) // right
    place(state, 1, 1, 'leech', 0) // orthogonal range - reads all 3 basics, base = 3
    place(state, 1, 2, 'buff', 1, 'up') // 20%, facing the leech

    const result = recalculate(state)
    const leechIdx = cellIndex(1, 1, 3)
    expect(result.base[leechIdx].toNumber()).toBe(3) // base unaffected by the buff
    expect(result.final[leechIdx].toNumber()).toBeCloseTo(3.6, 9)
  })

  it('17. Buff Stacker pointed at a non-buff target behaves exactly like an ordinary Buff', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'buffStacker', 9, 'left') // level 9 = 100%, facing the basic directly

    const result = recalculate(state)
    expect(result.final[cellIndex(0, 0, 2)].toNumber()).toBeCloseTo(1 * (1 + BUFF_PCT_PER_LEVEL[9]), 9) // 1 * 2, ordinary buff math
  })

  it('18. Buff Stacker -> Buff: the exact worked example from the design doc (1.1 x 2 = 2.2, i.e. the buff\'s target ends up boosted by +120% instead of +10%)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0) // G1
    place(state, 1, 0, 'buff', 0, 'left') // B1: 10%, facing G1
    place(state, 2, 0, 'buffStacker', 9, 'left') // B2: maxed (100%), facing B1

    const multipliers = resolveBuffMultipliers(state)
    expect(multipliers[cellIndex(0, 0, 3)]).toBeCloseTo(2.2, 9)

    const result = recalculate(state)
    expect(result.final[cellIndex(0, 0, 3)].toNumber()).toBeCloseTo(1 * 2.2, 9)
  })

  it('19. Buff Stacker chains to arbitrary depth: Stacker -> Stacker -> Buff -> target multiplies all three factors together', () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'basic', 0) // G
    place(state, 1, 0, 'buff', 0, 'left') // B1: 10%, facing G
    place(state, 2, 0, 'buffStacker', 0, 'left') // S2: 10%, facing B1
    place(state, 3, 0, 'buffStacker', 0, 'left') // S3: 10%, facing S2

    const result = recalculate(state)
    const expectedMult = 1.1 * 1.1 * 1.1
    expect(result.final[cellIndex(0, 0, 4)].toNumber()).toBeCloseTo(1 * expectedMult, 9)
  })

  it('20. Buff All alone boosts every producer on the board by 1 + its level\'s percentage', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    place(state, 2, 0, 'buffAll', 4) // level 4 = 50%

    const result = recalculate(state)
    expect(result.final[cellIndex(0, 0, 3)].toNumber()).toBeCloseTo(1 * 1.5, 9)
    // The Leech's own collection is the basic's FULL final output (1 * 1.5,
    // Buff All already included - it steals output, not base), and its own
    // final then gets Buff All's board-wide boost applied a second time on
    // top of that, since Buff All independently boosts every cell's own
    // final, Leech included: 1.5 (stolen, already-boosted) * 1.5 (Leech's
    // own boost) = 2.25.
    expect(result.final[cellIndex(1, 0, 3)].toNumber()).toBeCloseTo(1 * 1.5 * 1.5, 9)
  })

  it('21. a Buff Stacker can target a Buff All, boosting its board-wide effect for everyone (confirmed intentional and strong)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'buffAll', 0, undefined) // 10%, no facing needed
    place(state, 2, 0, 'buffStacker', 9, 'left') // maxed 100%, facing the Buff All

    const multipliers = resolveBuffMultipliers(state)
    const expectedBuffAllMult = 1.1 * 2 // buffAll's own 10% x Stacker's 100% factor of 2
    expect(multipliers[cellIndex(0, 0, 3)]).toBeCloseTo(expectedBuffAllMult, 9)
  })

  it('22. a cycle (two Stackers facing each other) resolves without hanging and stays bounded - not a designed combo, just has to be safe', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'buffStacker', 9, 'right') // faces (1,0)
    place(state, 1, 0, 'buffStacker', 9, 'left') // faces (0,0) - a 2-cycle

    const multipliers = resolveBuffMultipliers(state) // must return, not hang
    expect(Number.isFinite(multipliers[cellIndex(0, 0, 2)])).toBe(true)
    expect(Number.isFinite(multipliers[cellIndex(1, 0, 2)])).toBe(true)
    // Bounded: neither cell's contribution can exceed what an acyclic chain of the same two 100%-level Stackers could produce.
    const effective = resolveBuffMultipliers(state)
    expect(effective[cellIndex(0, 0, 2)]).toBeLessThanOrEqual(4 + 1e-9) // <= 2 * 2, generous bound
    expect(effective[cellIndex(1, 0, 2)]).toBeLessThanOrEqual(4 + 1e-9)
  })

  it('23. multiple buffs on the same producer multiply together, not just the strongest one applying', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'basic', 0)
    place(state, 1, 0, 'buff', 0, 'down') // 10%, facing the basic
    place(state, 0, 1, 'buff', 1, 'right') // 20%, facing the basic
    place(state, 2, 2, 'buffAll', 2) // 30%, board-wide

    const result = recalculate(state)
    const expected = 1 * 1.1 * 1.2 * 1.3
    expect(result.final[cellIndex(1, 1, 3)].toNumber()).toBeCloseTo(expected, 9)
  })

  it("24. a Power Core Generator's own output is boosted by a Buff targeting it, and a Leech steals that fully-boosted output too", () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 1, 0, 'buff', 4, 'left') // 50%, facing the generator at (0,0)
    place(state, 2, 0, 'leech', 0) // orthogonal range - out of range of the generator (2 cells away), never mind
    place(state, 3, 0, 'leech', 2) // whole board - definitely reads the generator regardless of distance

    const n = state.width * state.height
    const genAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    genAmounts[cellIndex(0, 0, 4)] = new Decimal(5)

    const result = recalculate(state, undefined, genAmounts)
    expect(result.basePowerCores[cellIndex(0, 0, 4)].toNumber()).toBe(5) // raw proc, unbuffed - a display/diagnostic figure only now
    expect(result.finalPowerCores[cellIndex(0, 0, 4)].toNumber()).toBeCloseTo(5 * 1.5, 9) // generator's own output, buffed
    expect(result.finalPowerCores[cellIndex(3, 0, 4)].toNumber()).toBeCloseTo(5 * 1.5, 9) // the whole-board Leech steals the buffed (real) amount, not the raw proc
  })

  it('25. powerCoreGeneratorPeriod: 5 ticks at level 0, down to 1 at level 4', () => {
    expect(powerCoreGeneratorPeriod(0)).toBe(5)
    expect(powerCoreGeneratorPeriod(1)).toBe(4)
    expect(powerCoreGeneratorPeriod(4)).toBe(1)
  })

  it('26. firePowerCoreGenerators produces nothing until the period elapses, then wraps coreProgress - always exactly 1 core per proc', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0) // period 5
    const idx = cellIndex(0, 0, 2)
    for (let i = 0; i < 4; i++) {
      const amounts = firePowerCoreGenerators(state)
      expect(amounts[idx].toNumber()).toBe(0)
    }
    expect(state.cells[idx].coreProgress).toBe(4)
    const amounts = firePowerCoreGenerators(state) // 5th call crosses the boundary
    expect(amounts[idx].toNumber()).toBe(1)
    expect(state.cells[idx].coreProgress).toBe(0) // wrapped
  })

  it('27. a forced generator proc is visible to a nearby Leech (steals power cores, mirroring how energy is stolen from a Basic)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 1, 0, 'leech', 0) // orthogonal range
    const n = state.width * state.height
    const genAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    genAmounts[cellIndex(0, 0, 3)] = new Decimal(5) // force a proc worth 5

    const result = recalculate(state, undefined, genAmounts)
    expect(result.basePowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(5)
    expect(result.finalPowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(5) // own output - no buff here, no private multiplier either
    expect(result.finalPowerCores[cellIndex(1, 0, 3)].toNumber()).toBe(5) // Leech steals it
    expect(result.powerCoreProduction.toNumber()).toBe(10) // generator's own + Leech's steal, both counted (stealing doesn't remove from the source)
  })

  it('28. a whole-board (level 2) Leech reads every generator via the O(1) running sum', () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 3, 0, 'leech', 2) // whole board
    const n = state.width * state.height
    const genAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    genAmounts[cellIndex(0, 0, 4)] = new Decimal(7)

    const result = recalculate(state, undefined, genAmounts)
    expect(result.finalPowerCores[cellIndex(3, 0, 4)].toNumber()).toBe(7)
  })

  it('29. Basic-family cells never produce power cores directly (Power Core Chance is gone) - only a Power Core Generator does', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    const result = tick(state, ALWAYS_CRIT)
    expect(result.powerCoreProduction.toNumber()).toBe(0)
  })
})
