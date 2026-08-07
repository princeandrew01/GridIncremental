import type { GameState } from '../game/types'
import type { PowerCoreUpgradeId } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { POWER_CORE_UPGRADE_IDS, POWER_CORE_UPGRADE_LABEL, pcMaxLevelFor, pcBulkUpgradeCost, pcMaxAffordableCount } from '../game/powerCoreUpgrades'

export interface PowerCoreUpgradesPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

// Same toolbar-driven quantity selection as ui/upgradesPanel.ts - see its
// BuyCount comment for why this replaced the old 4-buttons-per-row layout.
type BuyCount = 1 | 10 | 25 | 'max'
const BUY_COUNTS: BuyCount[] = [1, 10, 25, 'max']

interface RowEls {
  name: HTMLElement
  level: HTMLElement
  value: HTMLElement
  cost: HTMLElement
  buyButton: HTMLButtonElement
}

/** How many of `id` the player currently has, in plain English - "N slot(s) allowed" for the 4 evolution-slot upgrades, or the actual board size for Grid Size (same figure the Upgrades tab shows for its own Grid Size track, since the two combine - see upgrades.ts totalGridSizeLevel). */
function currentValueText(state: GameState, id: PowerCoreUpgradeId): string {
  if (id === 'gridSize') return `${state.width}×${state.height}`
  const level = state.powerCoreUpgrades[id]
  return `${level.toLocaleString()} slot${level === 1 ? '' : 's'} allowed`
}

/**
 * The Power Core Menu: same visual shape as ui/upgradesPanel.ts (reuses its
 * .upgrade-row/.upgrade-toolbar etc. CSS), but built against
 * powerCoreUpgrades.ts's functions instead of upgrades.ts's - not sharing
 * code directly, since the two currency tracks (energy vs power cores) and
 * their state fields are genuinely different, even though the cost-curve
 * shape happens to be the same now.
 */
export function createPowerCoreUpgradesPanel(
  container: HTMLElement,
  onBuy: (id: PowerCoreUpgradeId, count: number) => void,
): PowerCoreUpgradesPanelHandle {
  container.classList.add('panel-section', 'upgrades-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Power Cores'
  container.appendChild(heading)

  let latestState: GameState | null = null
  let latestFormatMode: NumberFormatMode = 'scientific'
  let selectedCount: BuyCount = 1

  /** Mirrors upgradesPanel.ts's resolveBuyCount - see its comment. */
  function resolveBuyCount(state: GameState, id: PowerCoreUpgradeId): number {
    const current = state.powerCoreUpgrades[id]
    const max = pcMaxLevelFor(id)
    if (current >= max) return 0
    if (selectedCount === 'max') return pcMaxAffordableCount(id, current, state.powerCores)
    return Math.min(selectedCount, max - current)
  }

  // Sticky toolbar - see upgradesPanel.ts's matching comment.
  const toolbar = document.createElement('div')
  toolbar.className = 'upgrade-toolbar'
  const toolbarButtons = new Map<BuyCount, HTMLButtonElement>()
  for (const count of BUY_COUNTS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'upgrade-toolbar-button'
    btn.textContent = count === 'max' ? 'Max' : `x${count}`
    btn.addEventListener('click', () => {
      selectedCount = count
      for (const [c, b] of toolbarButtons) b.classList.toggle('upgrade-toolbar-button-active', c === count)
      if (latestState) update(latestState, latestFormatMode)
    })
    toolbar.appendChild(btn)
    toolbarButtons.set(count, btn)
  }
  toolbarButtons.get(1)!.classList.add('upgrade-toolbar-button-active')
  container.appendChild(toolbar)

  const rows = new Map<PowerCoreUpgradeId, RowEls>()

  for (const id of POWER_CORE_UPGRADE_IDS) {
    const row = document.createElement('div')
    row.className = 'upgrade-row'

    const info = document.createElement('div')
    info.className = 'upgrade-info'
    const name = document.createElement('div')
    name.className = 'upgrade-name'
    const level = document.createElement('div')
    level.className = 'upgrade-level'
    const value = document.createElement('div')
    value.className = 'upgrade-current-value'
    info.append(name, level, value)

    const cost = document.createElement('div')
    cost.className = 'upgrade-cost'

    const buyButton = document.createElement('button')
    buyButton.type = 'button'
    buyButton.className = 'upgrade-buy-button'
    buyButton.addEventListener('click', () => {
      if (!latestState) return
      const count = resolveBuyCount(latestState, id)
      if (count > 0) onBuy(id, count)
    })

    row.append(info, cost, buyButton)
    container.appendChild(row)
    rows.set(id, { name, level, value, cost, buyButton })
  }

  function update(state: GameState, formatMode: NumberFormatMode): void {
    latestState = state
    latestFormatMode = formatMode
    for (const id of POWER_CORE_UPGRADE_IDS) {
      const els = rows.get(id)!
      const current = state.powerCoreUpgrades[id]
      const max = pcMaxLevelFor(id)
      const maxed = current >= max
      els.name.textContent = POWER_CORE_UPGRADE_LABEL[id]
      els.level.textContent = `Level ${current.toLocaleString()} / ${max.toLocaleString()}`
      const valueText = currentValueText(state, id)
      els.value.textContent = valueText ? `Current: ${valueText}` : ''

      if (maxed) {
        els.cost.textContent = 'Maxed'
        els.buyButton.disabled = true
        els.buyButton.textContent = 'Maxed'
        continue
      }

      const count = resolveBuyCount(state, id)
      if (count <= 0) {
        els.cost.textContent = 'Not enough power cores'
        els.buyButton.disabled = true
        els.buyButton.textContent = 'Buy'
      } else {
        const cost = pcBulkUpgradeCost(id, current, count)
        const affordable = state.powerCores.gte(cost)
        els.cost.textContent = `Cost: 🔵 ${format(cost, formatMode)}`
        els.buyButton.disabled = !affordable
        els.buyButton.textContent = `Buy x${count.toLocaleString()}`
      }
    }
  }

  return { update }
}
