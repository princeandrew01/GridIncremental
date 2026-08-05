import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { placementCost, canAffordPlacement, upgradeCost, canUpgrade, isMaxLevel, removeRefund } from '../game/economy'
import type { BuildableType } from '../game/economy'
import { BASIC_MULT, BUFF_POWER, LEECH_RANGE_LABEL } from '../game/config'
import type { GridSelection } from './grid'
import { TYPE_GLYPH, TYPE_LABEL } from './grid'

const BUILDABLE_TYPES: BuildableType[] = ['basic', 'leech', 'buff']

const FACING_LABEL: Record<string, string> = {
  up: 'Up',
  right: 'Right',
  down: 'Down',
  left: 'Left',
}

export interface PanelHandle {
  update(
    state: GameState,
    result: TickResult,
    buildType: BuildableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
  ): void
}

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
  const buildButtons = document.createElement('div')
  buildButtons.className = 'build-buttons'

  const buttonByType = new Map<BuildableType, HTMLButtonElement>()
  const costByType = new Map<BuildableType, HTMLSpanElement>()
  for (const type of BUILDABLE_TYPES) {
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
    buildButtons.appendChild(btn)
    buttonByType.set(type, btn)
    costByType.set(type, cost)
  }
  buildSection.append(buildHeading, buildButtons)

  const hint = document.createElement('p')
  hint.className = 'panel-hint'
  hint.textContent =
    'Click an empty cell to place the selected type. Click a filled cell to inspect it, or click it again to deselect - ' +
    'click a Buff again to rotate which cell it targets instead. ' +
    'Right-click, or click anywhere off the grid, deselects both the build type and the inspected cell.'

  const detailSection = document.createElement('div')
  detailSection.className = 'panel-section'
  const detailHeading = document.createElement('h2')
  detailHeading.textContent = 'Selected cell'
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
    for (const [type, btn] of buttonByType) {
      const cost = placementCost(state, type)
      const affordable = canAffordPlacement(state, type)
      costByType.get(type)!.textContent = format(cost, formatMode)
      btn.classList.toggle('build-button-active', type === buildType)
      btn.disabled = !affordable
      btn.title = affordable ? '' : 'Not enough currency'
    }

    if (!selected) {
      detailBody.textContent = 'Nothing selected.'
      upgradeButton.hidden = true
      removeButton.hidden = true
      return
    }
    const i = cellIndex(selected.x, selected.y, state.width)
    const cell = state.cells[i]
    if (cell.type === 'empty') {
      detailBody.textContent = `Empty cell (${selected.x}, ${selected.y}).`
      upgradeButton.hidden = true
      removeButton.hidden = true
      return
    }

    const level = cell.level
    const maxed = isMaxLevel(cell.type, level)
    const rows: string[] = [`<div>Type: ${TYPE_LABEL[cell.type]}</div>`, `<div>Level: ${level}</div>`]
    let nextLevelText = ''

    if (cell.type === 'basic') {
      // Base is what Leeches read; the multiplier applies only to this
      // cell's own output (see engine.ts recalculate()).
      const base = result.base[i]
      rows.push(`<div>Base (what Leeches read): ${format(base, formatMode)}</div>`)
      rows.push(`<div>Output (this cell, per tick): ${format(result.final[i], formatMode)}</div>`)
      if (!maxed) {
        const nextBase = base.plus(1)
        const nextOutput = nextBase.times(BASIC_MULT[level + 1])
        nextLevelText = `Next level: base ${format(base, formatMode)} → ${format(nextBase, formatMode)}, output ${format(result.final[i], formatMode)} → ${format(nextOutput, formatMode)}`
      }
    } else if (cell.type === 'leech') {
      rows.push(`<div>Range: ${LEECH_RANGE_LABEL[level]}</div>`)
      rows.push(`<div>Value: ${format(result.final[i], formatMode)} / tick</div>`)
      if (!maxed) {
        nextLevelText = `Next level: range ${LEECH_RANGE_LABEL[level]} → ${LEECH_RANGE_LABEL[level + 1]}`
      }
    } else {
      // buff
      rows.push(`<div>Power: ${BUFF_POWER[level]}</div>`)
      rows.push(`<div>Facing: ${FACING_LABEL[cell.facing]}</div>`)
      rows.push(`<div>Output: 0 / tick (Buffs don't produce currency)</div>`)
      if (!maxed) {
        nextLevelText = `Next level: power ${BUFF_POWER[level]} → ${BUFF_POWER[level + 1]}`
      }
    }

    const previewRow = nextLevelText ? `<div class="panel-next-level">${nextLevelText}</div>` : ''
    detailBody.innerHTML = rows.join('') + previewRow

    if (maxed) {
      upgradeButton.hidden = false
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Max level'
    } else {
      const cost = upgradeCost(cell.type, level)
      upgradeButton.hidden = false
      upgradeButton.disabled = !canUpgrade(state, selected.x, selected.y)
      upgradeButton.textContent = `Upgrade (${format(cost, formatMode)})`
    }

    // Always available regardless of level - refunds a fraction of what was
    // actually paid to place this cell, not what's been spent upgrading it.
    removeButton.hidden = false
    removeButton.textContent = `Remove (+${format(removeRefund(state, selected.x, selected.y), formatMode)})`
  }

  return { update }
}
