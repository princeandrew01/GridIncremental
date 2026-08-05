import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { activeFacings, powerCoreGeneratorPeriod } from '../game/engine'
import { critChanceFor, critAmountFor } from '../game/upgrades'

export interface GridSelection {
  x: number
  y: number
}

export interface GridHandle {
  update(
    state: GameState,
    result: TickResult,
    displayResult: TickResult,
    selected: GridSelection | null,
    canPlaceCurrent: boolean,
    formatMode: NumberFormatMode,
  ): void
}

export const TYPE_GLYPH: Record<string, string> = {
  empty: '',
  basic: 'B',
  leech: 'L',
  buffV1: 'F',
  buffV2: 'G',
  powerCoreGenerator: 'C',
}

export const TYPE_LABEL: Record<string, string> = {
  empty: 'Empty',
  basic: 'Basic',
  leech: 'Leech',
  buffV1: 'Buff V1',
  buffV2: 'Buff V2',
  powerCoreGenerator: 'Power Core Generator',
}

// How long the crit badge (see cell-crit-badge below) stays on a cell after
// it actually crits. result.crits[i] is only true for the single tick it
// happened on (as little as 750ms apart at max Tick Speed) - nowhere near
// long enough to reliably notice, so this is tracked on a wall-clock timer
// instead of the raw per-tick flag.
const RECENT_CRIT_WINDOW_MS = 3000

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
  // Wall-clock timestamp (performance.now()) of each basic's last real crit -
  // see RECENT_CRIT_WINDOW_MS above.
  const lastCritAt: number[] = new Array(width * height).fill(-Infinity)

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
    displayResult: TickResult,
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
        const isBuff = cell.type === 'buffV1' || cell.type === 'buffV2'
        // A Basic/Leech's cell value comes from displayResult (a fresh,
        // un-critted recalculate() - see main.ts render()), not the live
        // per-tick `result` - `result.final[i]` bakes in that tick's real
        // crit roll, which made the number visibly jump around every time a
        // crit fired then fall back the next tick ("whiplash", per the
        // user). The crit BADGE below still reacts live; only the number
        // itself is held stable.
        const value =
          cell.type === 'empty' || isBuff || cell.type === 'powerCoreGenerator' ? '' : format(displayResult.final[i], formatMode)
        const crit = cell.type === 'basic' && result.crits[i]
        if (crit) lastCritAt[i] = performance.now()
        const recentlyCritted = performance.now() - lastCritAt[i] < RECENT_CRIT_WINDOW_MS
        const facings = cell.type === 'buffV1' ? activeFacings(cell.facing, cell.level) : []
        // Only basics need crit stats in their hover text, and those stats
        // depend on account-wide upgrades, not just this cell's own level -
        // buying a Crit Chance/Amount upgrade should refresh every basic's
        // tooltip even though nothing else about those cells changed.
        const critStats = cell.type === 'basic' ? `${state.upgrades.critChance},${state.upgrades.critAmount}` : ''

        // Everything that affects this cell's rendered output, as one
        // comparable string. render() runs on every animation frame
        // (~60/s) regardless of whether a game tick happened, and
        // unconditionally rewriting innerHTML that often was silently
        // swallowing real clicks: if a re-render landed between a player's
        // mousedown and mouseup, replacing the element under the pointer,
        // the browser drops the click rather than firing it. That's why a
        // freshly-placed cell sometimes took several clicks before it
        // "took" - not a logic bug in the click handler, a DOM-churn race.
        const signature = `${cell.type}|${cell.level}|${cell.coreProgress}|${facings.join(',')}|${value}|${isSelected}|${canPlaceCurrent}|${recentlyCritted}|${critStats}`
        if (lastSignature[i] === signature) continue
        lastSignature[i] = signature

        let className = `cell cell-${cell.type}`
        if (isSelected) className += ' cell-selected'
        if (cell.type === 'empty' && !canPlaceCurrent) className += ' cell-unaffordable'
        if (crit) className += ' cell-crit' // one-shot flash animation, plays once right on the tick itself
        btn.className = className

        if (cell.type === 'empty') {
          btn.innerHTML = ''
          btn.title = ''
          btn.setAttribute(
            'aria-label',
            canPlaceCurrent
              ? `Empty cell, column ${x + 1}, row ${y + 1}`
              : `Empty cell, column ${x + 1}, row ${y + 1}, not enough currency to build here`,
          )
        } else if (cell.type === 'buffV1') {
          // Facing is shown as little triangle tabs attached to whichever
          // edge(s) the buff currently targets - 1, 2, or 4 of them
          // depending on level (see activeFacings). They move/multiply when
          // the buff levels up or is rotated.
          const arrows = facings.map((f) => `<span class="cell-facing-arrow facing-${f}" aria-hidden="true"></span>`).join('')
          btn.innerHTML = `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>` + arrows
          btn.setAttribute(
            'aria-label',
            `Buff V1 level ${cell.level}, column ${x + 1}, row ${y + 1}, targeting ${facings.join(' and ')}. Click to rotate.`,
          )
          btn.title = `Buff V1 — Level ${cell.level}\nTargeting: ${facings.join(', ')}\nClick to rotate.`
        } else if (cell.type === 'buffV2') {
          btn.innerHTML = `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>`
          btn.setAttribute('aria-label', `Buff V2 level ${cell.level}, column ${x + 1}, row ${y + 1}, buffs the whole board.`)
          btn.title = `Buff V2 — Level ${cell.level}\nBuffs every Basic on the board.`
        } else if (cell.type === 'powerCoreGenerator') {
          // Production is discrete (a proc every `period` ticks), not a
          // per-tick trickle like Basic/Leech - shows a ticks-remaining
          // countdown instead of a per-tick value.
          const period = powerCoreGeneratorPeriod(cell.level)
          const ticksLeft = period - cell.coreProgress
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>` +
            `<span class="cell-value">${ticksLeft}</span>`
          btn.setAttribute(
            'aria-label',
            `Power Core Generator level ${cell.level}, column ${x + 1}, row ${y + 1}, ${ticksLeft} ticks until next core.`,
          )
          btn.title = `Power Core Generator — Level ${cell.level}\nNext core in ${ticksLeft} / ${period} ticks.`
        } else {
          // The crit badge is drawn directly on the cell, not left to a
          // hover tooltip: native tooltips take ~500ms-1s to appear after
          // the pointer stops, and won't refresh their text while already
          // showing without a genuine mouse-leave-then-enter - both make
          // them a bad fit for something this time-sensitive. This is
          // visible immediately, no hovering required.
          const critBadge =
            cell.type === 'basic' && recentlyCritted
              ? `<span class="cell-crit-badge">⚡×${critAmountFor(state, cell.level).toFixed(2)}</span>`
              : ''
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_GLYPH[cell.type]}${cell.level}</span>` +
            `<span class="cell-value">${value}</span>` +
            critBadge
          btn.setAttribute(
            'aria-label',
            `${TYPE_LABEL[cell.type]} level ${cell.level}, column ${x + 1}, row ${y + 1}, value ${value} per tick${recentlyCritted ? ', recently critted' : ''}`,
          )
          if (cell.type === 'basic') {
            const chance = critChanceFor(state, cell.level)
            const amount = critAmountFor(state, cell.level)
            btn.title =
              `Basic — Level ${cell.level}\n` +
              `Output: ${value} / tick\n` +
              `Crit chance: ${(chance * 100).toFixed(1)}% • Crit amount: ${amount.toFixed(2)}x`
          } else {
            btn.title = `Leech — Level ${cell.level}\nValue: ${value} / tick`
          }
        }
      }
    }
  }

  return { update }
}
