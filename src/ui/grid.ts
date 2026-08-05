import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'

export interface GridSelection {
  x: number
  y: number
}

export interface GridHandle {
  update(
    state: GameState,
    result: TickResult,
    selected: GridSelection | null,
    canPlaceCurrent: boolean,
    formatMode: NumberFormatMode,
  ): void
}

export const TYPE_GLYPH: Record<string, string> = {
  empty: '',
  basic: 'B',
  leech: 'L',
  buff: 'F',
}

export const TYPE_LABEL: Record<string, string> = {
  empty: 'Empty',
  basic: 'Basic',
  leech: 'Leech',
  buff: 'Buff',
}

export function createGrid(
  container: HTMLElement,
  width: number,
  height: number,
  onCellClick: (x: number, y: number) => void,
): GridHandle {
  container.innerHTML = ''
  container.classList.add('grid')
  container.style.setProperty('--grid-w', String(width))
  container.style.setProperty('--grid-h', String(height))

  const buttons: HTMLButtonElement[] = new Array(width * height)
  // What was actually rendered into each cell last time, so update() can
  // skip the DOM write when nothing changed - see the comment in update()
  // for why this isn't just an optimisation.
  const lastSignature: (string | null)[] = new Array(width * height).fill(null)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cell cell-empty'
      btn.addEventListener('click', () => onCellClick(x, y))
      container.appendChild(btn)
      buttons[cellIndex(x, y, width)] = btn
    }
  }

  function update(
    state: GameState,
    result: TickResult,
    selected: GridSelection | null,
    canPlaceCurrent: boolean,
    formatMode: NumberFormatMode,
  ): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = cellIndex(x, y, width)
        const cell = state.cells[i]
        const btn = buttons[i]
        const isSelected = selected !== null && selected.x === x && selected.y === y
        const value = cell.type === 'empty' || cell.type === 'buff' ? '' : format(result.final[i], formatMode)

        // Everything that affects this cell's rendered output, as one
        // comparable string. render() runs on every animation frame
        // (~60/s) regardless of whether a game tick happened, and
        // unconditionally rewriting innerHTML that often was silently
        // swallowing real clicks: if a re-render landed between a player's
        // mousedown and mouseup, replacing the element under the pointer,
        // the browser drops the click rather than firing it. That's why a
        // freshly-placed cell sometimes took several clicks before it
        // "took" - not a logic bug in the click handler, a DOM-churn race.
        const signature = `${cell.type}|${cell.level}|${cell.facing}|${value}|${isSelected}|${canPlaceCurrent}`
        if (lastSignature[i] === signature) continue
        lastSignature[i] = signature

        let className = `cell cell-${cell.type}`
        if (isSelected) className += ' cell-selected'
        if (cell.type === 'empty' && !canPlaceCurrent) className += ' cell-unaffordable'
        btn.className = className

        if (cell.type === 'empty') {
          btn.innerHTML = ''
          btn.setAttribute(
            'aria-label',
            canPlaceCurrent
              ? `Empty cell, column ${x + 1}, row ${y + 1}`
              : `Empty cell, column ${x + 1}, row ${y + 1}, not enough currency to build here`,
          )
        } else if (cell.type === 'buff') {
          // Buffs produce no currency; the facing is shown as a little
          // triangle tab attached to the edge it points at, rather than a
          // value. It moves to a different edge when the buff is rotated.
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>` +
            `<span class="cell-facing-arrow facing-${cell.facing}" aria-hidden="true"></span>`
          btn.setAttribute(
            'aria-label',
            `Buff level ${cell.level}, column ${x + 1}, row ${y + 1}, facing ${cell.facing}. Click to rotate.`,
          )
        } else {
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>` +
            `<span class="cell-value">${value}</span>`
          btn.setAttribute(
            'aria-label',
            `${TYPE_LABEL[cell.type]} level ${cell.level}, column ${x + 1}, row ${y + 1}, value ${value} per tick`,
          )
        }
      }
    }
  }

  return { update }
}
