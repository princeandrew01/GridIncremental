import { describe, it, expect } from 'vitest'
import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from '../src/game/types'
import {
  recalculate,
  tick,
  rotateBuffFacing,
  facingTargetIndex,
  activeFacings,
  nextFacing,
  rollCrits,
  expectedCritMultipliers,
  powerCoreGeneratorPeriod,
  firePowerCoreGenerators,
  rollPowerCoreProcs,
  expectedPowerCoreProduction,
  buffV1PowerPerFiring,
  buffV2PowerPerFiring,
  FACING_ORDER,
} from '../src/game/engine'
import { critChanceFor, critAmountFor, powerCoreAmountFor, powerCoreChanceFor, buffScalingBaseValue } from '../src/game/upgrades'
import { BASIC_MULT, MIN_BUFF_POWER_PER_FIRING, BUFF_V1_PCT_PER_FIRING, BUFF_V2_PCT_PER_FIRING } from '../src/game/config'
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

    // Regression test for the feedback loop: production must stay exactly 20,
    // tick after tick, with no drift or blowup. Crits forced off so this
    // stays exact rather than occasionally jumping.
    for (let i = 0; i < 100; i++) {
      const r = tick(state, NEVER_CRIT)
      expect(r.production.toNumber()).toBe(20)
    }
    expect(state.currency.toNumber()).toBe(2000) // 100 ticks * 20
  })

  it('3. buff accumulation: basic base increases by 1 at tick 5, 10, 15, not between', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'buffV1', 0, 'left') // facing the basic at (0, 0)

    const baseAt = (t: number) => {
      const r = tick(state, NEVER_CRIT)
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

  it('4. level 2 leech (whole board) on a filled board matches the naive whole-board sum', () => {
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
          state.cells[i].level = n % 6 // 0-5
          n++
        } else {
          state.cells[i].type = 'buffV1'
          state.cells[i].level = n % 3 // 0-2
          n++
        }
      }
    }

    const result = recalculate(state)

    // Naive whole-board sum: every non-leech cell's base value. A Basic's
    // base no longer depends on its own level at all (that moved to the
    // account-wide Basic Generator Value upgrade) - just BASIC_BASE_VALUE (1)
    // plus buffAccum (0 here, nothing has ticked).
    let naiveSum = new Decimal(0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = cellIndex(x, y, 4)
        if (state.cells[i].type === 'basic') naiveSum = naiveSum.plus(1)
        // buffs contribute 0 to base, empty contribute 0
      }
    }

    const leechIdx = cellIndex(3, 3, 4)
    expect(result.base[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
    // Only one leech on the board, so final == base (no other leeches to add).
    expect(result.final[leechIdx].toNumber()).toBeCloseTo(naiveSum.toNumber(), 9)
  })

  it('5. buff before multiplier: a buff next to a level 5 basic gives more output than next to a level 0 basic', () => {
    const highState = makeGameState(2, 1)
    place(highState, 0, 0, 'basic', 5)
    place(highState, 1, 0, 'buffV1', 0, 'left') // facing the basic at (0, 0)

    const lowState = makeGameState(2, 1)
    place(lowState, 0, 0, 'basic', 0)
    place(lowState, 1, 0, 'buffV1', 0, 'left') // facing the basic at (0, 0)

    // Advance both boards to tick 5 so the buff has fired once.
    let highResult = recalculate(highState)
    let lowResult = recalculate(lowState)
    for (let i = 0; i < 5; i++) {
      highResult = tick(highState, NEVER_CRIT)
      lowResult = tick(lowState, NEVER_CRIT)
    }

    expect(highResult.production.toNumber()).toBeGreaterThan(lowResult.production.toNumber())
  })

  it('6. a level-0 buff V1 only buffs the single cell it faces, not other adjacent basics', () => {
    // Buff at (1,1) surrounded by 4 basics, facing only 'up'.
    const state = makeGameState(3, 3)
    place(state, 1, 0, 'basic', 0) // up
    place(state, 1, 2, 'basic', 0) // down
    place(state, 0, 1, 'basic', 0) // left
    place(state, 2, 1, 'basic', 0) // right
    place(state, 1, 1, 'buffV1', 0, 'up')

    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT)

    expect(state.cells[cellIndex(1, 0, 3)].buffAccum.toNumber()).toBe(1) // targeted: gained power
    expect(state.cells[cellIndex(1, 2, 3)].buffAccum.toNumber()).toBe(0) // not targeted
    expect(state.cells[cellIndex(0, 1, 3)].buffAccum.toNumber()).toBe(0) // not targeted
    expect(state.cells[cellIndex(2, 1, 3)].buffAccum.toNumber()).toBe(0) // not targeted
  })

  it('7. a level-1 buff V1 also buffs the opposite side, but not the perpendicular axis', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 0, 'basic', 0) // up
    place(state, 1, 2, 'basic', 0) // down
    place(state, 0, 1, 'basic', 0) // left
    place(state, 2, 1, 'basic', 0) // right
    place(state, 1, 1, 'buffV1', 1, 'up') // level 1: vertical axis (up + down)

    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT)

    expect(state.cells[cellIndex(1, 0, 3)].buffAccum.toNumber()).toBe(1) // up: targeted
    expect(state.cells[cellIndex(1, 2, 3)].buffAccum.toNumber()).toBe(1) // down: targeted (opposite side)
    expect(state.cells[cellIndex(0, 1, 3)].buffAccum.toNumber()).toBe(0) // left: not targeted
    expect(state.cells[cellIndex(2, 1, 3)].buffAccum.toNumber()).toBe(0) // right: not targeted
  })

  it('8. a level-2 buff V1 buffs all 4 sides', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 0, 'basic', 0)
    place(state, 1, 2, 'basic', 0)
    place(state, 0, 1, 'basic', 0)
    place(state, 2, 1, 'basic', 0)
    place(state, 1, 1, 'buffV1', 2, 'up')

    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT)

    for (const [x, y] of [[1, 0], [1, 2], [0, 1], [2, 1]]) {
      expect(state.cells[cellIndex(x, y, 3)].buffAccum.toNumber()).toBe(1)
    }
  })

  it('9. a buff V2 buffs every basic on the board regardless of position, scaled by its level, floored at MIN_BUFF_POWER_PER_FIRING on a fresh board', () => {
    const state = makeGameState(4, 4)
    place(state, 0, 0, 'basic', 0)
    place(state, 3, 3, 'basic', 0)
    place(state, 2, 1, 'buffV2', 2)
    // Fresh state: buffScalingBaseValue is just BASIC_BASE_VALUE (1), so even
    // level 2's 2% rate (0.02) is far under the floor - MIN_BUFF_POWER_PER_FIRING
    // (1) wins, same as the old flat-power behaviour looked like at small scale.
    const expectedPower = buffV2PowerPerFiring(state, 2)
    expect(expectedPower).toBe(MIN_BUFF_POWER_PER_FIRING)

    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT) // one firing (BUFF_TICK_INTERVAL = 5)

    expect(state.cells[cellIndex(0, 0, 4)].buffAccum.toNumber()).toBe(expectedPower)
    expect(state.cells[cellIndex(3, 3, 4)].buffAccum.toNumber()).toBe(expectedPower)
  })

  it("9b. buffScalingBaseValue is BASIC_BASE_VALUE plus Basic Generator Value bonus, times Generator Value % - the same for every Basic regardless of its own level", () => {
    const state = makeGameState(1, 1)
    state.upgrades.basicValue = 40 // both tracks' Basic Generator Value contribute additively
    state.powerCoreUpgrades.basicValue = 10
    state.upgrades.generatorValuePct = 5 // +25%

    const expected = (1 + 40 + 10) * (1 + 5 * 0.05)
    expect(buffScalingBaseValue(state)).toBeCloseTo(expected, 9)
  })

  it('9c. once buffScalingBaseValue is large enough, buff power actually scales by percentage instead of sitting at the floor', () => {
    const state = makeGameState(1, 1)
    state.upgrades.basicValue = 100_000 // pushes buffScalingBaseValue well past the floor threshold

    const scalingBase = buffScalingBaseValue(state)
    expect(buffV1PowerPerFiring(state)).toBeCloseTo(scalingBase * BUFF_V1_PCT_PER_FIRING, 6)
    expect(buffV1PowerPerFiring(state)).toBeGreaterThan(MIN_BUFF_POWER_PER_FIRING)

    for (let level = 0; level < BUFF_V2_PCT_PER_FIRING.length; level++) {
      expect(buffV2PowerPerFiring(state, level)).toBeCloseTo(scalingBase * BUFF_V2_PCT_PER_FIRING[level], 6)
    }
    // Higher V2 level means a higher % rate, so strictly more power per firing
    // once past the floor - confirms leveling V2 is meaningful at scale again.
    expect(buffV2PowerPerFiring(state, 4)).toBeGreaterThan(buffV2PowerPerFiring(state, 0))
  })

  it('10. nextFacing: level 0 cycles all 4 sides, level 1 toggles the two axes, level 2 is a no-op', () => {
    expect(nextFacing('up', 0)).toBe('right')
    expect(nextFacing('right', 0)).toBe('down')
    expect(nextFacing('down', 0)).toBe('left')
    expect(nextFacing('left', 0)).toBe('up')

    expect(nextFacing('up', 1)).toBe('right') // vertical -> horizontal representative
    expect(nextFacing('down', 1)).toBe('right')
    expect(nextFacing('right', 1)).toBe('up') // horizontal -> vertical representative
    expect(nextFacing('left', 1)).toBe('up')

    for (const f of FACING_ORDER) expect(nextFacing(f, 2)).toBe(f) // nothing left to rotate
  })

  it('11. activeFacings matches rotateBuffFacing/nextFacing behaviour and rotateBuffFacing is a no-op on non-buffV1 cells', () => {
    const state = makeGameState(3, 3)
    place(state, 1, 1, 'buffV1', 0, 'up')

    const seen: Facing[] = [state.cells[cellIndex(1, 1, 3)].facing]
    for (let i = 0; i < 4; i++) {
      rotateBuffFacing(state, 1, 1)
      seen.push(state.cells[cellIndex(1, 1, 3)].facing)
    }
    expect(seen).toEqual(['up', 'right', 'down', 'left', 'up']) // full rotation, back to start
    expect(activeFacings('up', 0)).toEqual(['up'])
    expect(activeFacings('up', 1).sort()).toEqual(['down', 'up'])
    expect(activeFacings('up', 2)).toEqual(FACING_ORDER)

    place(state, 0, 0, 'basic', 0)
    expect(rotateBuffFacing(state, 0, 0)).toBe(false) // not a buffV1, no-op

    place(state, 0, 1, 'buffV2', 0)
    expect(rotateBuffFacing(state, 0, 1)).toBe(false) // buffV2 never rotates
  })

  it('12. a buff V1 facing off the board targets nothing (no crash, no effect)', () => {
    const state = makeGameState(2, 2)
    place(state, 0, 0, 'buffV1', 0, 'up') // (0,-1) is off-board
    place(state, 1, 0, 'basic', 0)

    expect(facingTargetIndex(0, 0, 'up', 2, 2)).toBeNull()

    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT)
    expect(state.cells[cellIndex(1, 0, 2)].buffAccum.toNumber()).toBe(0)
  })

  it("13. a leveled-up basic's own output is multiplied, but a Leech only ever reads the pre-multiplier base", () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 3) // base = 1 (level no longer grows it); own output = 1 * BASIC_MULT[3]
    place(state, 1, 0, 'leech', 0)

    const result = recalculate(state)
    const basicIdx = cellIndex(0, 0, 3)
    const leechIdx = cellIndex(1, 0, 3)

    expect(result.base[basicIdx].toNumber()).toBe(1) // pre-multiplier: what the Leech reads
    expect(result.final[basicIdx].toNumber()).toBe(1 * BASIC_MULT[3]) // own output: multiplied
    expect(result.base[leechIdx].toNumber()).toBe(1) // Leech read the pre-multiplier base
    expect(result.final[leechIdx].toNumber()).toBe(1) // no other leeches on this board
  })

  it('14. a forced crit multiplier boosts a basic base and is visible to a neighbouring Leech (one roll, shared)', () => {
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

  it('15. rollCrits only rolls for basic cells, and rng threshold decides hit vs miss', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    place(state, 2, 0, 'buffV1', 0)

    const hit = rollCrits(state, ALWAYS_CRIT)
    expect(hit[cellIndex(0, 0, 3)]).toBe(critAmountFor(state, 0))
    expect(hit[cellIndex(1, 0, 3)]).toBe(1) // leech never rolls its own crit
    expect(hit[cellIndex(2, 0, 3)]).toBe(1) // buffs never crit

    const miss = rollCrits(state, NEVER_CRIT)
    expect(miss[cellIndex(0, 0, 3)]).toBe(1)
  })

  it('16. expectedCritMultipliers is 1 + chance * (amount - 1) for a basic, and exactly 1 elsewhere', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'basic', 3)
    place(state, 1, 0, 'leech', 0)

    const expected = expectedCritMultipliers(state)
    const chance = critChanceFor(state, 3)
    const amount = critAmountFor(state, 3)
    expect(expected[cellIndex(0, 0, 2)]).toBeCloseTo(1 + chance * (amount - 1), 12)
    expect(expected[cellIndex(1, 0, 2)]).toBe(1)
  })

  it('17. tick() with rng forced to always hit produces a crit-boosted production', () => {
    const critState = makeGameState(2, 1)
    place(critState, 0, 0, 'basic', 0)
    const noCritState = makeGameState(2, 1)
    place(noCritState, 0, 0, 'basic', 0)

    const critResult = tick(critState, ALWAYS_CRIT)
    const noCritResult = tick(noCritState, NEVER_CRIT)

    expect(critResult.crits[cellIndex(0, 0, 2)]).toBe(true)
    expect(critResult.production.toNumber()).toBeGreaterThan(noCritResult.production.toNumber())
    expect(critResult.production.toNumber()).toBeCloseTo(critAmountFor(critState, 0), 9)
  })

  it('18. powerCoreGeneratorPeriod: 10 ticks at level 0, down to 6 at level 4', () => {
    expect(powerCoreGeneratorPeriod(0)).toBe(10)
    expect(powerCoreGeneratorPeriod(1)).toBe(9)
    expect(powerCoreGeneratorPeriod(4)).toBe(6)
  })

  it('19. firePowerCoreGenerators produces nothing until the period elapses, then wraps coreProgress', () => {
    const state = makeGameState(2, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0) // period 10
    const idx = cellIndex(0, 0, 2)
    for (let i = 0; i < 9; i++) {
      const amounts = firePowerCoreGenerators(state)
      expect(amounts[idx].toNumber()).toBe(0)
    }
    expect(state.cells[idx].coreProgress).toBe(9)
    const amounts = firePowerCoreGenerators(state) // 10th call crosses the boundary
    expect(amounts[idx].toNumber()).toBe(powerCoreAmountFor(state))
    expect(state.cells[idx].coreProgress).toBe(0) // wrapped
  })

  it('20. a forced generator proc is visible to a nearby Leech (steals power cores, mirroring how energy is stolen from a Basic)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 1, 0, 'leech', 0) // orthogonal range
    const n = state.width * state.height
    const genAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    genAmounts[cellIndex(0, 0, 3)] = new Decimal(5) // force a proc worth 5

    const result = recalculate(state, undefined, genAmounts)
    expect(result.basePowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(5)
    expect(result.finalPowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(5) // own output - no private per-cell multiplier
    expect(result.finalPowerCores[cellIndex(1, 0, 3)].toNumber()).toBe(5) // Leech steals it
    expect(result.powerCoreProduction.toNumber()).toBe(10) // generator's own + Leech's steal, both counted (stealing doesn't remove from the source)
  })

  it('21. a whole-board (level 2) Leech reads every generator via the O(1) running sum', () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 3, 0, 'leech', 2) // whole board
    const n = state.width * state.height
    const genAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    genAmounts[cellIndex(0, 0, 4)] = new Decimal(7)

    const result = recalculate(state, undefined, genAmounts)
    expect(result.finalPowerCores[cellIndex(3, 0, 4)].toNumber()).toBe(7)
  })

  it('22. Power Core Chance procs are private to whichever Basic/Leech rolled them - never visible to a nearby Leech (unlike a Power Core Generator)', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    const n = state.width * state.height
    const chanceAmounts: Decimal[] = new Array(n).fill(new Decimal(0))
    chanceAmounts[cellIndex(0, 0, 3)] = new Decimal(3) // Basic privately procs 3 power cores

    const result = recalculate(state, undefined, undefined, chanceAmounts)
    expect(result.finalPowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(3) // Basic keeps it
    expect(result.finalPowerCores[cellIndex(1, 0, 3)].toNumber()).toBe(0) // Leech gets nothing - not stealable
    expect(result.basePowerCores[cellIndex(0, 0, 3)].toNumber()).toBe(0) // never entered the stealable array at all
  })

  it('23. rollPowerCoreProcs only rolls for Basic and Leech, each independently, respecting powerCoreChanceFor', () => {
    const state = makeGameState(4, 1)
    place(state, 0, 0, 'basic', 0)
    place(state, 1, 0, 'leech', 0)
    place(state, 2, 0, 'buffV1', 0)
    place(state, 3, 0, 'powerCoreGenerator', 0)
    state.powerCoreUpgrades.powerCoreChance = 10 // nonzero, so a forced-hit roll actually hits (base chance is 0%)

    const hit = rollPowerCoreProcs(state, ALWAYS_CRIT)
    expect(hit[cellIndex(0, 0, 4)].toNumber()).toBeGreaterThan(0)
    expect(hit[cellIndex(1, 0, 4)].toNumber()).toBeGreaterThan(0)
    expect(hit[cellIndex(2, 0, 4)].toNumber()).toBe(0)
    expect(hit[cellIndex(3, 0, 4)].toNumber()).toBe(0)

    const miss = rollPowerCoreProcs(state, NEVER_CRIT)
    expect(miss[cellIndex(0, 0, 4)].toNumber()).toBe(0)
  })

  it('24. Buffs do not affect a Power Core Generator - buffAccum stays 0 even when targeted, coreProgress only advances via real ticks', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0)
    place(state, 1, 0, 'buffV1', 2, 'left') // level 2: all 4 sides, would target (0,0) if this type could be buffed
    for (let i = 0; i < 5; i++) tick(state, NEVER_CRIT) // one buff firing (BUFF_TICK_INTERVAL = 5)
    expect(state.cells[cellIndex(0, 0, 3)].buffAccum.toNumber()).toBe(0) // buffs only ever target 'basic' cells
    expect(state.cells[cellIndex(0, 0, 3)].coreProgress).toBe(5) // only real ticks advance this
  })

  it('25. expectedPowerCoreProduction: a stable average, not a live 0-or-a-lump-sum snapshot - Basic/Leech chance rate plus a Leech\'s share of a nearby generator\'s duty-cycle rate', () => {
    const state = makeGameState(3, 1)
    place(state, 0, 0, 'powerCoreGenerator', 0) // period 10, amount 1 -> duty-cycle rate 0.1/tick
    place(state, 1, 0, 'basic', 0)
    place(state, 2, 0, 'leech', 0) // orthogonal - reads the basic (0 energy-side effect here) but NOT the generator (out of range)
    state.powerCoreUpgrades.powerCoreChance = 10 // nonzero, so the chance term isn't trivially 0 (2.5% * amount 1)

    const expected = expectedPowerCoreProduction(state)
    const chanceRate = powerCoreChanceFor(state) * powerCoreAmountFor(state)
    // The generator's own rate never depends on rng or its exact phase - amount / period, always.
    expect(expected[cellIndex(0, 0, 3)].toNumber()).toBeCloseTo(powerCoreAmountFor(state) / powerCoreGeneratorPeriod(0), 9)
    // The Basic is out of the generator's steal range from itself (Basics don't steal), so it only carries its own chance rate.
    expect(expected[cellIndex(1, 0, 3)].toNumber()).toBeCloseTo(chanceRate, 9)
    // The Leech is out of range of the generator (2 cells away, orthogonal range is 1) - only its own chance rate, nothing stolen.
    expect(expected[cellIndex(2, 0, 3)].toNumber()).toBeCloseTo(chanceRate, 9)

    // Move the Leech next to the generator instead - now it should also carry the generator's duty-cycle rate.
    const state2 = makeGameState(2, 1)
    place(state2, 0, 0, 'powerCoreGenerator', 0)
    place(state2, 1, 0, 'leech', 0)
    const expected2 = expectedPowerCoreProduction(state2)
    const generatorRate = powerCoreAmountFor(state2) / powerCoreGeneratorPeriod(0)
    expect(expected2[cellIndex(1, 0, 2)].toNumber()).toBeCloseTo(generatorRate + powerCoreChanceFor(state2) * powerCoreAmountFor(state2), 9)
  })
})
