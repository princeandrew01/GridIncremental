import Decimal from 'break_infinity.js'
import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { placementCost, canAffordPlacement, upgradeCost, canUpgrade, isMaxLevel, removeRefund, currencyFor } from '../game/economy'
import type { BuildableType } from '../game/economy'
import {
  MAX_LEVEL,
  LEECH_RANGE_LABEL,
  BUFF_TICK_INTERVAL,
  MIN_BUFF_POWER_PER_FIRING,
  BUFF_V1_PCT_PER_FIRING,
  BUFF_V2_PCT_PER_FIRING,
} from '../game/config'
import { critChanceFor, critAmountFor, isPowerCoreGeneratorUnlocked, powerCoreAmountFor } from '../game/upgrades'
import {
  powerCoreGeneratorPeriod,
  buffV1PowerPerFiring,
  buffV2PowerPerFiring,
  expectedPowerCoreProduction,
} from '../game/engine'
import type { GridSelection } from './grid'
import { TYPE_GLYPH, TYPE_LABEL } from './grid'

// Generators produce currency directly; Buffers boost a Generator's output
// and produce none themselves. Visual grouping only for now (see the Build
// tab's two labelled rows below) - not yet a first-class concept elsewhere.
// powerCoreGenerator's button exists in the DOM from the start but stays
// hidden until unlockPowerCoreGenerator is bought - see update() below.
const GENERATOR_TYPES: BuildableType[] = ['basic', 'leech', 'powerCoreGenerator']
const BUFFER_TYPES: BuildableType[] = ['buffV1', 'buffV2']

const FACING_LABEL: Record<string, string> = {
  up: 'Up',
  right: 'Right',
  down: 'Down',
  left: 'Left',
}

// Buff V1's levels buy coverage, not power - see config.ts.
const BUFF_V1_COVERAGE_LABEL = ['1 side', '2 sides (opposite pair)', 'All 4 sides']

// One-line explanation shown at the top of a selected cell's detail view (and
// as a build-button tooltip) - added so the mechanics behind each type aren't
// only discoverable by reading raw numbers (spec: "more descriptions around
// so users aren't too confused").
const TYPE_DESCRIPTION: Record<BuildableType, string> = {
  basic: "Produces energy every tick. Base value comes from the Basic Generator Value upgrades (both tracks) and Buffers; this cell's own level boosts crit chance/amount and its own output multiplier.",
  leech: "Produces no energy of its own - instead steals a share of every non-Leech generator's output within range (energy and power cores both). Range grows with level, up to the whole board.",
  buffV1: "Boosts the Basic cell(s) it faces - adds to their buffAccum, which feeds into their base value before a Leech reads it. Level buys more targeted sides, not more power per side.",
  buffV2: "Boosts every Basic on the board at once, every firing. Level raises the % rate.",
  powerCoreGenerator: 'Produces power cores on a delay instead of every tick - one proc every few ticks, faster at higher levels. Buffers have no effect on it.',
}

export interface PanelHandle {
  // No live per-tick TickResult here on purpose - every number this panel
  // shows is sourced from displayNoCrit/displayWithCrit (stable, recomputed
  // fresh each render, never a live crit/proc roll) so nothing in the
  // detail view visibly bounces around while a cell's selected. See
  // main.ts render() for how those two are built.
  update(
    state: GameState,
    displayNoCrit: TickResult,
    displayWithCrit: TickResult,
    buildType: BuildableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
  ): void
}

function buildButtonGroup(
  container: HTMLElement,
  label: string,
  types: BuildableType[],
  onSelectBuildType: (type: BuildableType) => void,
  buttonByType: Map<BuildableType, HTMLButtonElement>,
  costByType: Map<BuildableType, HTMLSpanElement>,
): void {
  const groupHeading = document.createElement('h3')
  groupHeading.className = 'build-group-heading'
  groupHeading.textContent = label
  const buttons = document.createElement('div')
  buttons.className = 'build-buttons'

  for (const type of types) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'build-button'
    btn.title = TYPE_DESCRIPTION[type]
    btn.addEventListener('click', () => onSelectBuildType(type))

    const icon = document.createElement('span')
    icon.className = `build-icon cell-${type}`
    icon.textContent = TYPE_GLYPH[type]
    icon.setAttribute('aria-hidden', 'true')

    const name = document.createElement('span')
    name.className = 'build-name'
    name.textContent = TYPE_LABEL[type]

    const cost = document.createElement('span')
    cost.className = 'build-cost'

    btn.append(icon, name, cost)
    buttons.appendChild(btn)
    buttonByType.set(type, btn)
    costByType.set(type, cost)
  }

  container.append(groupHeading, buttons)
}

/**
 * The Build tab. Shows one of two mutually-exclusive views, never both at
 * once: the build-buttons picker when nothing's selected, or the selected
 * cell's detail/Upgrade/Remove UI when something is. They used to stack
 * (build buttons always visible, detail block appended below), which pushed
 * the tab's content well past the grid's own height and looked unfinished;
 * a separate panel elsewhere was tried next, but that broke the flow -
 * eyes had to jump away from where the build buttons already were. Swapping
 * in place keeps everything in the one spot the player's already looking at.
 */
export function createPanel(
  container: HTMLElement,
  onSelectBuildType: (type: BuildableType) => void,
  onUpgrade: () => void,
  onRemove: () => void,
): PanelHandle {
  container.innerHTML = ''
  container.classList.add('build-tab')

  const buildSection = document.createElement('div')
  buildSection.className = 'panel-section'
  const buildHeading = document.createElement('h2')
  buildHeading.textContent = 'Build'

  const buttonByType = new Map<BuildableType, HTMLButtonElement>()
  const costByType = new Map<BuildableType, HTMLSpanElement>()
  buildSection.appendChild(buildHeading)
  buildButtonGroup(buildSection, 'Generators', GENERATOR_TYPES, onSelectBuildType, buttonByType, costByType)
  buildButtonGroup(buildSection, 'Buffers', BUFFER_TYPES, onSelectBuildType, buttonByType, costByType)

  const hint = document.createElement('p')
  hint.className = 'panel-hint'
  hint.textContent =
    'Click an empty cell to place the selected type. Click a filled cell to inspect it, or click it again to deselect - ' +
    'click a Buff V1 again to rotate what it targets instead. ' +
    'Right-click, or click anywhere off the grid, deselects both the build type and the inspected cell.'

  const detailSection = document.createElement('div')
  detailSection.className = 'panel-section'
  detailSection.hidden = true
  const detailHeading = document.createElement('h2')
  detailHeading.textContent = 'Selected'
  const detailBody = document.createElement('div')
  detailBody.className = 'panel-detail'

  const detailActions = document.createElement('div')
  detailActions.className = 'detail-actions'
  const upgradeButton = document.createElement('button')
  upgradeButton.type = 'button'
  upgradeButton.className = 'upgrade-button'
  upgradeButton.addEventListener('click', onUpgrade)
  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.className = 'remove-button'
  removeButton.addEventListener('click', onRemove)
  detailActions.append(upgradeButton, removeButton)

  detailSection.append(detailHeading, detailBody, detailActions)

  container.append(buildSection, hint, detailSection)

  function update(
    state: GameState,
    displayNoCrit: TickResult,
    displayWithCrit: TickResult,
    buildType: BuildableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
  ): void {
    // Selecting a cell replaces the build picker entirely rather than
    // stacking below it - see the function-level comment above.
    const showingDetail = selected !== null && state.cells[cellIndex(selected.x, selected.y, state.width)].type !== 'empty'
    buildSection.hidden = showingDetail
    hint.hidden = showingDetail
    detailSection.hidden = !showingDetail

    if (!showingDetail) {
      const unlocked = isPowerCoreGeneratorUnlocked(state)
      for (const [type, btn] of buttonByType) {
        if (type === 'powerCoreGenerator') btn.hidden = !unlocked
        const cost = placementCost(state, type)
        const affordable = canAffordPlacement(state, type)
        costByType.get(type)!.textContent = format(cost, formatMode)
        btn.classList.toggle('build-button-active', type === buildType)
        btn.disabled = !affordable
        const currencyLabel = currencyFor(type) === 'powerCores' ? 'power cores' : 'energy'
        btn.title = affordable ? TYPE_DESCRIPTION[type] : `${TYPE_DESCRIPTION[type]} (Not enough ${currencyLabel})`
      }
      return
    }

    // selected is non-null and non-empty here (showingDetail guarantees both);
    // the explicit guard just narrows CellType -> BuildableType for TS below.
    const i = cellIndex(selected!.x, selected!.y, state.width)
    const cell = state.cells[i]
    if (cell.type === 'empty') return
    const level = cell.level
    const maxed = isMaxLevel(cell.type, level)
    const rows: string[] = [
      `<div>Type: ${TYPE_LABEL[cell.type]}</div>`,
      `<div class="panel-type-desc">${TYPE_DESCRIPTION[cell.type]}</div>`,
      `<div>Level: ${level} / ${MAX_LEVEL[cell.type]}</div>`,
    ]
    let nextLevelText = ''
    // Only Basic/Leech need this (see below) - computed once here rather
    // than per-branch, and only a plain accessor call either way (cheap).
    const expectedPowerCores = expectedPowerCoreProduction(state)

    if (cell.type === 'basic') {
      // Base is what Leeches read; the level multiplier (BASIC_MULT) applies
      // only to this cell's own output (see engine.ts recalculate()). Shown
      // without crit first (the honest, unchanging floor), then crit
      // chance/amount, then the same two figures again WITH crit folded in -
      // but as the long-run EXPECTED contribution (displayWithCrit), not a
      // live per-tick roll, so neither pair visibly bounces around from tick
      // to tick the way reading straight off a real tick result would.
      rows.push(`<div>Base (no crit): ${format(displayNoCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (no crit): ${format(displayNoCrit.final[i], formatMode)}</div>`)
      const chance = critChanceFor(state, level)
      const amount = critAmountFor(state, level)
      rows.push(`<div>Crit chance: ${(chance * 100).toFixed(1)}%</div>`)
      rows.push(`<div>Crit amount: ${amount.toFixed(2)}x</div>`)
      rows.push(`<div>Base (with crit, expected): ${format(displayWithCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (with crit, expected): ${format(displayWithCrit.final[i], formatMode)}</div>`)
      rows.push(`<div>Power cores: ${format(expectedPowerCores[i], formatMode)} / tick (expected)</div>`)
      if (!maxed) {
        const nextChance = critChanceFor(state, level + 1)
        const nextAmount = critAmountFor(state, level + 1)
        nextLevelText =
          `Next level: crit chance ${(chance * 100).toFixed(1)}% → ${(nextChance * 100).toFixed(1)}%, ` +
          `crit amount ${amount.toFixed(2)}x → ${nextAmount.toFixed(2)}x`
      }
    } else if (cell.type === 'leech') {
      // Same no-crit / with-crit(expected) pairing as Basic above - a Leech
      // has no crit chance of its own, but its value still swings with
      // whatever nearby Basics crit, so it bounces just as much without this.
      // Leech also has a meaningful `base` (what OTHER Leeches read from it),
      // same as Basic's - see engine.ts recalculate()'s leech.final pass.
      rows.push(`<div>Range: ${LEECH_RANGE_LABEL[level]}</div>`)
      rows.push(`<div>Base (no crit): ${format(displayNoCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (no crit): ${format(displayNoCrit.final[i], formatMode)}</div>`)
      rows.push(`<div>Base (with crit, expected): ${format(displayWithCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (with crit, expected): ${format(displayWithCrit.final[i], formatMode)}</div>`)
      rows.push(`<div>Power cores: ${format(expectedPowerCores[i], formatMode)} / tick (expected)</div>`)
      if (!maxed) {
        nextLevelText = `Next level: range ${LEECH_RANGE_LABEL[level]} → ${LEECH_RANGE_LABEL[level + 1]}`
      }
    } else if (cell.type === 'buffV1') {
      const pct = BUFF_V1_PCT_PER_FIRING
      const power = buffV1PowerPerFiring(state)
      const floored = power <= MIN_BUFF_POWER_PER_FIRING
      rows.push(`<div>Coverage: ${BUFF_V1_COVERAGE_LABEL[level]}</div>`)
      rows.push(`<div>Fires every ${BUFF_TICK_INTERVAL} ticks</div>`)
      rows.push(`<div>Currently buffing: ${(pct * 100).toFixed(2)}% of a Basic's base value, per side, per firing</div>`)
      rows.push(`<div>= +${format(new Decimal(power), formatMode)} per side, per firing${floored ? ' (floor - base value too small for the % to matter yet)' : ''}</div>`)
      if (level < 2) rows.push(`<div>Facing: ${FACING_LABEL[cell.facing]}</div>`)
      rows.push(`<div>Note: Buffs don't generate energy.</div>`)
      if (!maxed) {
        nextLevelText = `Next level: coverage ${BUFF_V1_COVERAGE_LABEL[level]} → ${BUFF_V1_COVERAGE_LABEL[level + 1]}`
      }
    } else if (cell.type === 'buffV2') {
      const pct = BUFF_V2_PCT_PER_FIRING[level]
      const power = buffV2PowerPerFiring(state, level)
      const floored = power <= MIN_BUFF_POWER_PER_FIRING
      rows.push(`<div>Coverage: Whole board</div>`)
      rows.push(`<div>Fires every ${BUFF_TICK_INTERVAL} ticks</div>`)
      rows.push(`<div>Currently buffing: ${(pct * 100).toFixed(2)}% of a Basic's base value, per Basic, per firing</div>`)
      rows.push(`<div>= +${format(new Decimal(power), formatMode)} per Basic, per firing${floored ? ' (floor - base value too small for the % to matter yet)' : ''}</div>`)
      rows.push(`<div>Note: Buffs don't generate energy.</div>`)
      if (!maxed) {
        const nextPct = BUFF_V2_PCT_PER_FIRING[level + 1]
        nextLevelText = `Next level: rate ${(pct * 100).toFixed(2)}% → ${(nextPct * 100).toFixed(2)}%`
      }
    } else {
      // powerCoreGenerator - production is discrete (a proc every `period`
      // ticks, not a per-tick trickle), so the detail shows ticks-until-next
      // instead of a per-tick rate. Its own level only sets the period -
      // the AMOUNT per proc is the shared Power Core Amount upgrade,
      // identical for every generator regardless of level.
      const period = powerCoreGeneratorPeriod(level)
      const ticksLeft = period - cell.coreProgress
      rows.push(`<div>Ticks until next core: ${ticksLeft} / ${period}</div>`)
      rows.push(`<div>Cores per proc: ${format(new Decimal(powerCoreAmountFor(state)), formatMode)}</div>`)
      rows.push(`<div>Note: Buffers don't affect this generator.</div>`)
      if (!maxed) {
        const nextPeriod = powerCoreGeneratorPeriod(level + 1)
        nextLevelText = `Next level: ${period} ticks/core → ${nextPeriod} ticks/core`
      }
    }

    const previewRow = nextLevelText ? `<div class="panel-next-level">${nextLevelText}</div>` : ''
    detailBody.innerHTML = rows.join('') + previewRow

    if (maxed) {
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Max level'
    } else {
      const cost = upgradeCost(cell.type, level)
      upgradeButton.disabled = !canUpgrade(state, selected!.x, selected!.y)
      upgradeButton.textContent = `Upgrade (${format(cost, formatMode)})`
    }

    // Always available regardless of level - refunds a fraction of what was
    // actually paid to place this cell, not what's been spent upgrading it.
    removeButton.disabled = false
    removeButton.textContent = `Remove (+${format(removeRefund(state, selected!.x, selected!.y), formatMode)})`
  }

  return { update }
}
