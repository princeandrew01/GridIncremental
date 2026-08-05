import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { placementCost, canAffordPlacement, upgradeCost, canUpgrade, isMaxLevel, removeRefund } from '../game/economy'
import type { BuildableType } from '../game/economy'
import { MAX_LEVEL, LEECH_RANGE_LABEL, BUFF_V1_POWER, BUFF_V2_POWER } from '../game/config'
import { critChanceFor, critAmountFor } from '../game/upgrades'
import type { GridSelection } from './grid'
import { TYPE_GLYPH, TYPE_LABEL } from './grid'

// Generators produce currency directly; Buffers boost a Generator's output
// and produce none themselves. Visual grouping only for now (see the Build
// tab's two labelled rows below) - not yet a first-class concept elsewhere.
const GENERATOR_TYPES: BuildableType[] = ['basic', 'leech']
const BUFFER_TYPES: BuildableType[] = ['buffV1', 'buffV2']

const FACING_LABEL: Record<string, string> = {
  up: 'Up',
  right: 'Right',
  down: 'Down',
  left: 'Left',
}

// Buff V1's levels buy coverage, not power - see config.ts.
const BUFF_V1_COVERAGE_LABEL = ['1 side', '2 sides (opposite pair)', 'All 4 sides']

export interface PanelHandle {
  update(
    state: GameState,
    result: TickResult,
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
    result: TickResult,
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
      for (const [type, btn] of buttonByType) {
        const cost = placementCost(state, type)
        const affordable = canAffordPlacement(state, type)
        costByType.get(type)!.textContent = format(cost, formatMode)
        btn.classList.toggle('build-button-active', type === buildType)
        btn.disabled = !affordable
        btn.title = affordable ? '' : 'Not enough currency'
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
    const rows: string[] = [`<div>Type: ${TYPE_LABEL[cell.type]}</div>`, `<div>Level: ${level} / ${MAX_LEVEL[cell.type]}</div>`]
    let nextLevelText = ''

    if (cell.type === 'basic') {
      // Base is what Leeches read (crit included); the level multiplier
      // applies only to this cell's own output (see engine.ts recalculate()).
      const base = result.base[i]
      const chance = critChanceFor(state, level)
      const amount = critAmountFor(state, level)
      rows.push(`<div>Base (what Leeches read): ${format(base, formatMode)}</div>`)
      rows.push(`<div>Output (this cell, per tick): ${format(result.final[i], formatMode)}</div>`)
      rows.push(`<div>Crit chance: ${(chance * 100).toFixed(1)}%</div>`)
      rows.push(`<div>Crit amount: ${amount.toFixed(2)}x</div>`)
      if (!maxed) {
        const nextChance = critChanceFor(state, level + 1)
        const nextAmount = critAmountFor(state, level + 1)
        nextLevelText =
          `Next level: crit chance ${(chance * 100).toFixed(1)}% → ${(nextChance * 100).toFixed(1)}%, ` +
          `crit amount ${amount.toFixed(2)}x → ${nextAmount.toFixed(2)}x`
      }
    } else if (cell.type === 'leech') {
      rows.push(`<div>Range: ${LEECH_RANGE_LABEL[level]}</div>`)
      rows.push(`<div>Value: ${format(result.final[i], formatMode)} / tick</div>`)
      if (!maxed) {
        nextLevelText = `Next level: range ${LEECH_RANGE_LABEL[level]} → ${LEECH_RANGE_LABEL[level + 1]}`
      }
    } else if (cell.type === 'buffV1') {
      rows.push(`<div>Coverage: ${BUFF_V1_COVERAGE_LABEL[level]}</div>`)
      rows.push(`<div>Power per side: ${BUFF_V1_POWER}</div>`)
      if (level < 2) rows.push(`<div>Facing: ${FACING_LABEL[cell.facing]}</div>`)
      rows.push(`<div>Output: 0 / tick (Buffs don't produce currency)</div>`)
      if (!maxed) {
        nextLevelText = `Next level: coverage ${BUFF_V1_COVERAGE_LABEL[level]} → ${BUFF_V1_COVERAGE_LABEL[level + 1]}`
      }
    } else {
      // buffV2
      rows.push(`<div>Coverage: Whole board</div>`)
      rows.push(`<div>Power: ${BUFF_V2_POWER[level]}</div>`)
      rows.push(`<div>Output: 0 / tick (Buffs don't produce currency)</div>`)
      if (!maxed) {
        nextLevelText = `Next level: power ${BUFF_V2_POWER[level]} → ${BUFF_V2_POWER[level + 1]}`
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
