import { describe, it, expect } from 'vitest'
import { makeGameState, cellIndex, resizeGrid } from '../src/game/types'

describe('resizeGrid', () => {
  it('grows the board, preserving every existing cell at its exact (x, y) position and contents', () => {
    const state = makeGameState(2, 2)
    state.cells[cellIndex(0, 0, 2)].type = 'basic'
    state.cells[cellIndex(0, 0, 2)].level = 3
    state.cells[cellIndex(1, 1, 2)].type = 'leech'
    state.cells[cellIndex(1, 1, 2)].level = 1

    resizeGrid(state, 4, 3)

    expect(state.width).toBe(4)
    expect(state.height).toBe(3)
    expect(state.cells.length).toBe(12)
    expect(state.cells[cellIndex(0, 0, 4)].type).toBe('basic')
    expect(state.cells[cellIndex(0, 0, 4)].level).toBe(3)
    expect(state.cells[cellIndex(1, 1, 4)].type).toBe('leech')
    expect(state.cells[cellIndex(1, 1, 4)].level).toBe(1)
    // Everything beyond the old 2x2 bounds starts empty.
    expect(state.cells[cellIndex(3, 2, 4)].type).toBe('empty')
    expect(state.cells[cellIndex(2, 0, 4)].type).toBe('empty')
  })

  it('never shrinks: a smaller target than the current size is a no-op', () => {
    const state = makeGameState(5, 5)
    state.cells[cellIndex(4, 4, 5)].type = 'basic'
    resizeGrid(state, 3, 3)
    expect(state.width).toBe(5)
    expect(state.height).toBe(5)
    expect(state.cells[cellIndex(4, 4, 5)].type).toBe('basic') // nothing dropped
  })

  it('is a no-op when already exactly the target size', () => {
    const state = makeGameState(4, 4)
    const cellsBefore = state.cells
    resizeGrid(state, 4, 4)
    expect(state.cells).toBe(cellsBefore) // same array reference - no rebuild happened
  })

  it('growing width and height independently only adds cells on the relevant edges', () => {
    const state = makeGameState(2, 2)
    resizeGrid(state, 3, 2) // width only
    expect(state.width).toBe(3)
    expect(state.height).toBe(2)
    expect(state.cells.length).toBe(6)
  })
})
