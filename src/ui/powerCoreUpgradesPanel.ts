import type { GameState } from '../game/types'
import type { PowerCoreUpgradeId } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import {
  POWER_CORE_UPGRADE_IDS,
  POWER_CORE_UPGRADE_LABEL,
  POWER_CORE_UPGRADE_DESCRIPTION,
  pcMaxLevelFor,
  pcUpgradeCostAt,
  pcBulkUpgradeCost,
  pcMaxAffordableCount,
} from '../game/powerCoreUpgrades'

export interface PowerCoreUpgradesPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

const BUY_COUNTS = [1, 10, 100]

interface RowEls {
  level: HTMLElement
  cost: HTMLElement
  fixedButtons: Map<number, HTMLButtonElement>
  maxButton: HTMLButtonElement
}

/**
 * The Power Core Menu: same visual shape as ui/upgradesPanel.ts (reuses its
 * .upgrade-row etc. CSS), but built against powerCoreUpgrades.ts's simpler
 * flat-cost functions instead - not sharing code with upgradesPanel.ts,
 * since every power-core upgrade is flat-priced (no exponential/quadratic
 * curve to switch on), a genuinely simpler cost model than energy's.
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

  const rows = new Map<PowerCoreUpgradeId, RowEls>()

  for (const id of POWER_CORE_UPGRADE_IDS) {
    const row = document.createElement('div')
    row.className = 'upgrade-row'

    const info = document.createElement('div')
    info.className = 'upgrade-info'
    const name = document.createElement('div')
    name.className = 'upgrade-name'
    name.textContent = POWER_CORE_UPGRADE_LABEL[id]
    const desc = document.createElement('div')
    desc.className = 'upgrade-description'
    desc.textContent = POWER_CORE_UPGRADE_DESCRIPTION[id]
    const level = document.createElement('div')
    level.className = 'upgrade-level'
    info.append(name, desc, level)

    const cost = document.createElement('div')
    cost.className = 'upgrade-cost'

    const buyRow = document.createElement('div')
    buyRow.className = 'upgrade-buy-row'

    const fixedButtons = new Map<number, HTMLButtonElement>()
    for (const count of BUY_COUNTS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'upgrade-buy-button'
      btn.textContent = `x${count}`
      btn.addEventListener('click', () => onBuy(id, count))
      buyRow.appendChild(btn)
      fixedButtons.set(count, btn)
    }

    const maxButton = document.createElement('button')
    maxButton.type = 'button'
    maxButton.className = 'upgrade-buy-button'
    maxButton.textContent = 'Max'
    maxButton.addEventListener('click', () => {
      if (!latestState) return
      const current = latestState.powerCoreUpgrades[id]
      const n = pcMaxAffordableCount(id, current, latestState.powerCores)
      if (n > 0) onBuy(id, n)
    })
    buyRow.appendChild(maxButton)

    row.append(info, cost, buyRow)
    container.appendChild(row)
    rows.set(id, { level, cost, fixedButtons, maxButton })
  }

  function update(state: GameState, formatMode: NumberFormatMode): void {
    latestState = state
    for (const id of POWER_CORE_UPGRADE_IDS) {
      const els = rows.get(id)!
      const current = state.powerCoreUpgrades[id]
      const max = pcMaxLevelFor(id)
      const maxed = current >= max
      els.level.textContent = `Level ${current.toLocaleString()} / ${max.toLocaleString()}`
      els.cost.textContent = maxed ? 'Maxed' : `Next: ${format(pcUpgradeCostAt(id, current), formatMode)}`

      for (const [count, btn] of els.fixedButtons) {
        const withinCap = current + count <= max
        btn.disabled = !withinCap || state.powerCores.lt(pcBulkUpgradeCost(id, current, count))
      }

      const maxAffordable = pcMaxAffordableCount(id, current, state.powerCores)
      els.maxButton.disabled = maxAffordable <= 0
      els.maxButton.textContent = maxAffordable > 0 ? `Max (+${maxAffordable.toLocaleString()})` : 'Max'
    }
  }

  return { update }
}
