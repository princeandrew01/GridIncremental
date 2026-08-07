import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import {
  powerCoreGeneratorPeriod,
  powerCoreGeneratorAmount,
  resolveEffectiveBuffMultipliers,
  resolveBuffMultipliers,
  expectedPowerCoreResult,
} from '../game/engine'
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
  basicCrit: 'Crit Generator',
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

// A colour-coded square per type, roughly matching each type's own cell-
// <type> colour (see style.css) - used as the "selected cell" rail tab's
// icon (see main.ts), so the tab reads as "this specific tower" at a glance
// rather than a generic glyph.
export const TYPE_ICON: Record<string, string> = {
  empty: '⬜',
  basic: '🟩',
  leech: '🟥',
  buff: '🟨',
  buffStacker: '🟪',
  buffAll: '🟫',
  basicCrit: '🟧',
  basicSteady: '🟦',
  powerCoreGenerator: '🔵',
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
    // Expected (stable, not a live roll) power-core figures - only computed
    // when there's actually a Power Core Generator on the board to steal
    // from; used below so a Leech's own cell shows what it's expected to
    // steal in Power Cores too, not just Energy (a real display gap - the
    // "display" recalculate() calls this file otherwise relies on never
    // simulate a generator proc, so finalPowerCores was always 0 on those).
    const hasPowerCoreGenerator = state.cells.some((c) => c.type === 'powerCoreGenerator')
    const expectedPowerCores = hasPowerCoreGenerator ? expectedPowerCoreResult(state) : null
    // Per-producer multiplier (what a Buff facing a Basic/Leech/Power Core
    // Generator actually does to ITS OWN output) - separate from
    // effectiveBuffMult above, which is only about a buff-type cell's own
    // value. Needed so the Power Core Generator's on-cell rate reflects a
    // Buff targeting it instead of always showing the raw unbuffed amount
    // (a real display gap the user caught - the mechanic itself already
    // worked, see engine.ts recalculate(), this was purely cosmetic).
    const producerBuffMult = hasBuffType ? resolveBuffMultipliers(state) : null

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
        // A Leech steals Power Cores too, whenever a Power Core Generator is
        // anywhere in its range - shown as a second line, only when it's
        // actually expecting to collect any (most Leeches never will).
        const powerCoreValue =
          cell.type === 'leech' && expectedPowerCores && expectedPowerCores.finalPowerCores[i].gt(0)
            ? format(expectedPowerCores.finalPowerCores[i], formatMode)
            : ''
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
        // Buff-type cells show their own effective value; a Power Core
        // Generator's displayed rate depends on the producer-side multiplier
        // instead (see producerBuffMult above) - either way, this has to be
        // part of the signature or a buff strength change wouldn't trigger
        // a re-render for a cell whose own level/coreProgress didn't change.
        const buffMultText = isBuff
          ? (effectiveBuffMult?.get(i)?.toFixed(3) ?? '')
          : cell.type === 'powerCoreGenerator' && producerBuffMult
            ? producerBuffMult[i].toFixed(3)
            : ''

        // Everything that affects this cell's rendered output, as one
        // comparable string. render() runs on every animation frame
        // (~60/s) regardless of whether a game tick happened, and
        // unconditionally rewriting innerHTML that often was silently
        // swallowing real clicks: if a re-render landed between a player's
        // mousedown and mouseup, replacing the element under the pointer,
        // the browser drops the click rather than firing it. That's why a
        // freshly-placed cell sometimes took several clicks before it
        // "took" - not a logic bug in the click handler, a DOM-churn race.
        const signature = `${cell.type}|${cell.level}|${cell.coreProgress}|${facing}|${buffMultText}|${value}|${powerCoreValue}|${isSelected}|${canPlaceCurrent}|${critStats}`
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
          // per-tick trickle like Basic/Leech. Shows the steady RATE in
          // plain English ("3 per 8 ticks" / "10 per tick" at max level)
          // rather than a live ticks-remaining countdown - players found the
          // countdown confusing (it doesn't say what it's counting down TO
          // without hovering). Both period AND amount scale with level now
          // (the user's own redesign - a maxed generator is both faster and
          // worth more per proc). The rate only changes when the cell levels
          // up, so it reads as a stable fact about the cell instead of
          // something visibly ticking away every second. The countdown
          // itself moves to the tooltip, for anyone who does want it.
          const period = powerCoreGeneratorPeriod(cell.level)
          const rawAmount = powerCoreGeneratorAmount(cell.level)
          const buffMult = producerBuffMult ? producerBuffMult[i] : 1
          // A Buff facing this generator multiplies its own output, same as
          // any other producer - show the boosted number, not the raw one,
          // or a buff aimed at a generator would look like it's doing
          // nothing on the board itself (it wasn't the mechanic that was
          // broken, just this display - see engine.ts recalculate()).
          const amount = buffMult === 1 ? rawAmount : Number((rawAmount * buffMult).toFixed(2))
          const ticksLeft = period - cell.coreProgress
          const rateText = period === 1 ? `${amount} per tick` : `${amount} per ${period} ticks`
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` + `<span class="cell-value">${rateText}</span>`
          btn.setAttribute(
            'aria-label',
            `Power Core Generator level ${cell.level}, column ${x + 1}, row ${y + 1}, producing ${amount} power core${amount === 1 ? '' : 's'} every ${period} ticks, next in ${ticksLeft}.`,
          )
          btn.title =
            `Power Core Generator — Level ${cell.level}\n` +
            `Rate: ${amount} core${amount === 1 ? '' : 's'}${buffMult !== 1 ? ` (${rawAmount} × ${buffMult.toFixed(3)} Buff)` : ''} / ${period} ticks\n` +
            `Next core in ${ticksLeft} tick${ticksLeft === 1 ? '' : 's'}.`
        } else {
          // basic, leech, basicCrit, basicSteady - the crit float (see
          // spawnCritFloat above) handles the "just critted" moment; this
          // just shows the stable expected value every render. A Leech gets
          // a second value line for Power Cores whenever it's expecting to
          // steal any (see powerCoreValue above) - it steals both resources
          // at once from anything in range, not just Energy.
          const powerCoreLine = powerCoreValue ? `<span class="cell-value cell-value-power-cores">🔵 ${powerCoreValue}</span>` : ''
          btn.innerHTML =
            `<span class="cell-glyph">${TYPE_ABBREV[cell.type]}</span>` + `<span class="cell-value">${value}</span>` + powerCoreLine
          btn.setAttribute(
            'aria-label',
            `${TYPE_LABEL[cell.type]} level ${cell.level}, column ${x + 1}, row ${y + 1}, value ${value} per tick` +
              (powerCoreValue ? `, plus ${powerCoreValue} power cores per tick` : ''),
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
            btn.title =
              `Leech — Level ${cell.level}\nEnergy: ${value} / tick` + (powerCoreValue ? `\nPower Cores: ${powerCoreValue} / tick (expected)` : '')
          }
        }
      }
    }
  }

  return { update }
}
