import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { powerCoreGeneratorPeriod, resolveEffectiveBuffMultipliers } from '../game/engine'
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

// Full names (panel/tooltip use) and short in-cell names (the grid itself -
// cells are small, so names are abbreviated rather than truncated blindly).
// Alpha 0.31 replaced the old single-letter glyphs with these actual names,
// per the user's request.
export const TYPE_LABEL: Record<string, string> = {
  empty: 'Empty',
  basic: 'Basic',
  leech: 'Leech',
  buff: 'Buff',
  buffStacker: 'Buff Stacker',
  buffAll: 'Buff All',
  basicCrit: 'Crit Tower',
  basicSteady: 'Basic Steady Tower',
  powerCoreGenerator: 'Power Core Generator',
}

export const TYPE_ABBREV: Record<string, string> = {
  empty: '',
  basic: 'Basic',
  leech: 'Leech',
  buff: 'Buff',
  buffStacker: 'Stacker',
  buffAll: 'Buff All',
  basicCrit: 'Crit',
  basicSteady: 'Steady',
  powerCoreGenerator: 'Core Gen',
}

const isBasicFamily = (type: string) => type === 'basic' || type === 'basicCrit' || type === 'basicSteady'
const isBuffType = (type: string) => type === 'buff' || type === 'buffStacker' || type === 'buffAll'

/** "+120%" from an effective multiplier (e.g. 2.2 -> "+120%") - the number shown below a buff-type cell's name. `undefined` (no board-wide buff-type presence at all) falls back to "+0%" rather than blank. */
function pctLabel(effectiveMult: number | undefined): string {
  return `+${(((effectiveMult ?? 1) - 1) * 100).toFixed(0)}%`
}

// How long the floating crit number stays on screen (must match the
// cell-crit-float CSS animation duration in style.css - kept as a named
// constant here so the JS removal timer and the CSS timing can't drift
// apart silently).
const CRIT_FLOAT_MS = 900

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
  // Which real tick each cell's floating crit number was last spawned on -
  // result.crits[i] stays true across many render() frames within a single
  // tick (render runs at ~60fps, ticks happen far less often), so this is
  // what stops a single crit from spawning dozens of floats.
  const lastFloatTick: number[] = new Array(width * height).fill(-1)

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

  /** Appends a transient floating/fading crit-amount number to `btn`, self-removing after CRIT_FLOAT_MS - see the CSS keyframe for the actual motion. */
  function spawnCritFloat(btn: HTMLButtonElement, amount: number): void {
    const el = document.createElement('span')
    el.className = 'cell-crit-float'
    el.textContent = `×${amount.toFixed(amount >= 100 ? 0 : 1)}`
    el.setAttribute('aria-hidden', 'true')
    btn.appendChild(el)
    setTimeout(() => el.remove(), CRIT_FLOAT_MS)
  }

  function update(
    state: GameState,
    result: TickResult,
    displayResult: TickResult,
    selected: GridSelection | null,
    canPlaceCurrent: boolean,
    formatMode: NumberFormatMode,
  ): void {
    // Buff-type cells' own effective (Stacker-boosted) multiplier - only
    // computed when there's actually a buff-type cell on the board to show
    // it for; cheap either way (O(cells)), but no sense paying it on a
    // board with none.
    const hasBuffType = state.cells.some((c) => isBuffType(c.type))
    const effectiveBuffMult = hasBuffType ? resolveEffectiveBuffMultipliers(state) : null

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = cellIndex(x, y, width)
        const cell = state.cells[i]
        const btn = buttons[i]
        const isSelected = selected !== null && selected.x === x && selected.y === y
        const isBuff = isBuffType(cell.type)
        // A Basic/Leech's cell value comes from displayResult (a fresh,
        // un-critted recalculate() - see main.ts render()), not the live
        // per-tick `result` - `result.final[i]` bakes in that tick's real
        // crit roll, which made the number visibly jump around every time a
        // crit fired then fall back the next tick ("whiplash", per the
        // user). The floating crit number below still reacts live; only the
        // stable number itself is held steady.
        const value = isBasicFamily(cell.type) || cell.type === 'leech' ? format(displayResult.final[i], formatMode) : ''
        const crit = isBasicFamily(cell.type) && result.crits[i]

        if (crit && lastFloatTick[i] !== state.tickCount) {
          lastFloatTick[i] = state.tickCount
          const isCritTower = cell.type === 'basicCrit'
          spawnCritFloat(btn, critAmountFor(state, isCritTower))
        }

        // Only basic-family cells need crit stats in their signature - those
        // stats depend on account-wide upgrades, not just this cell's own
        // level - buying a Crit Chance/Amount upgrade should refresh every
        // basic-family tooltip even though nothing else about those cells
        // changed.
        const critStats = isBasicFamily(cell.type) ? `${state.upgrades.critChance},${state.upgrades.critAmount}` : ''
        const facing = isBuff && (cell.type === 'buff' || cell.type === 'buffStacker') ? cell.facing : ''
        const buffMultText = isBuff ? (effectiveBuffMult?.get(i)?.toFixed(3) ?? '') : ''

        // Everything that affects this cell's rendered output, as one
        // comparable string. render() runs on every animation frame
        // (~60/s) regardless of whether a game tick happened, and
        // unconditionally rewriting innerHTML that often was silently
        // swallowing real clicks: if a re-render landed between a player's
        // mousedown and mouseup, replacing the element under the pointer,
        // the browser drops the click rather than firing it. That's why a
        // freshly-placed cell sometimes took several clicks before it
        // "took" - not a logic bug in the click handler, a DOM-churn race.
        const signature = `${cell.type}|${cell.level}|${cell.coreProgress}|${facing}|${buffMultText}|${value}|${isSelected}|${canPlaceCurrent}|${critStats}`
        if (lastSignature[i] === signature) continue
        lastSignature[i] = signature

        let className = `cell cell-${cell.type}`
        if (isSelected) className += ' cell-selected'
        if (cell.type === 'empty' && !canPlaceCurrent) className += ' cell-unaffordable'
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
        } else if (cell.type === 'buff' || cell.type === 'buffStacker') {
          // Facing is shown as a little triangle tab attached to whichever
          // edge the buff currently targets - moves when the buff is
          // rotated. Alpha 0.31: always exactly 1 side now (levels no
          // longer buy coverage), so just one arrow, always.
          const arrow = `<span class="cell-facing-arrow facing-${cell.facing}" aria-hidden="true"></span>`
          // Effective %, not just the level's own - a Stacker chained onto
          // this one (or this one being a Stacker itself) can push it well
          // past its own level's base percentage, and that's the number
          // that actually matters at a glance.
          const pctText = pctLabel(effectiveBuffMult?.get(i))
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` +
            `<span class="cell-value">${pctText}</span>` +
            arrow
          btn.setAttribute(
            'aria-label',
            `${TYPE_LABEL[cell.type]} level ${cell.level}, column ${x + 1}, row ${y + 1}, targeting ${cell.facing}, boosting ${pctText}. Click to rotate.`,
          )
          btn.title = `${TYPE_LABEL[cell.type]} — Level ${cell.level}\nTargeting: ${cell.facing}\nBoosting: ${pctText}\nClick to rotate.`
        } else if (cell.type === 'buffAll') {
          const pctText = pctLabel(effectiveBuffMult?.get(i))
          btn.innerHTML = `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` + `<span class="cell-value">${pctText}</span>`
          btn.setAttribute(
            'aria-label',
            `Buff All level ${cell.level}, column ${x + 1}, row ${y + 1}, boosting ${pctText} board-wide.`,
          )
          btn.title = `Buff All — Level ${cell.level}\nBoosting: ${pctText} (every cell on the board)`
        } else if (cell.type === 'powerCoreGenerator') {
          // Production is discrete (a proc every `period` ticks), not a
          // per-tick trickle like Basic/Leech - shows a ticks-remaining
          // countdown instead of a per-tick value.
          const period = powerCoreGeneratorPeriod(cell.level)
          const ticksLeft = period - cell.coreProgress
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` + `<span class="cell-value">${ticksLeft}</span>`
          btn.setAttribute(
            'aria-label',
            `Power Core Generator level ${cell.level}, column ${x + 1}, row ${y + 1}, ${ticksLeft} ticks until next core.`,
          )
          btn.title = `Power Core Generator — Level ${cell.level}\nNext core in ${ticksLeft} / ${period} ticks.`
        } else {
          // basic, leech, basicCrit, basicSteady - the crit float (see
          // spawnCritFloat above) handles the "just critted" moment; this
          // just shows the stable expected value every render.
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` + `<span class="cell-value">${value}</span>`
          btn.setAttribute(
            'aria-label',
            `${TYPE_LABEL[cell.type]} level ${cell.level}, column ${x + 1}, row ${y + 1}, value ${value} per tick`,
          )
          if (isBasicFamily(cell.type)) {
            const isCritTower = cell.type === 'basicCrit'
            const chance = critChanceFor(state, isCritTower)
            const amount = critAmountFor(state, isCritTower)
            btn.title =
              `${TYPE_LABEL[cell.type]} — Level ${cell.level}\n` +
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
