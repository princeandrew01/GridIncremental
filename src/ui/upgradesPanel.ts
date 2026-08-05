import type { GameState } from '../game/types'
import type { UpgradeId } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { UPGRADE_IDS, UPGRADE_LABEL, UPGRADE_DESCRIPTION, maxLevelFor, upgradeCostAt, bulkUpgradeCost, maxAffordableCount } from '../game/upgrades'

export interface UpgradesPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

const BUY_COUNTS = [1, 10, 100]

interface RowEls {
  level: HTMLElement
  cost: HTMLElement
  fixedButtons: Map<number, HTMLButtonElement>
  maxButton: HTMLButtonElement
}

/** Real Upgrades tab: one row per account-wide upgrade (see game/upgrades.ts) - level, next cost, and x1/x10/x100/Max buy buttons. */
export function createUpgradesPanel(container: HTMLElement, onBuy: (id: UpgradeId, count: number) => void): UpgradesPanelHandle {
  container.classList.add('panel-section', 'upgrades-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Upgrades'
  container.appendChild(heading)

  // Buy buttons read `latestState` at click time rather than capturing a
  // fixed count/cost up front - needed for Max, whose affordable count
  // changes with currency every frame, but used uniformly for all four
  // buttons for consistency.
  let latestState: GameState | null = null

  const rows = new Map<UpgradeId, RowEls>()

  for (const id of UPGRADE_IDS) {
    const row = document.createElement('div')
    row.className = 'upgrade-row'

    const info = document.createElement('div')
    info.className = 'upgrade-info'
    const name = document.createElement('div')
    name.className = 'upgrade-name'
    name.textContent = UPGRADE_LABEL[id]
    const desc = document.createElement('div')
    desc.className = 'upgrade-description'
    desc.textContent = UPGRADE_DESCRIPTION[id]
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
      const current = latestState.upgrades[id]
      const n = maxAffordableCount(id, current, latestState.currency)
      if (n > 0) onBuy(id, n)
    })
    buyRow.appendChild(maxButton)

    row.append(info, cost, buyRow)
    container.appendChild(row)
    rows.set(id, { level, cost, fixedButtons, maxButton })
  }

  function update(state: GameState, formatMode: NumberFormatMode): void {
    latestState = state
    for (const id of UPGRADE_IDS) {
      const els = rows.get(id)!
      const current = state.upgrades[id]
      const max = maxLevelFor(id)
      const maxed = current >= max
      els.level.textContent = `Level ${current.toLocaleString()} / ${max.toLocaleString()}`
      els.cost.textContent = maxed ? 'Maxed' : `Next: ${format(upgradeCostAt(id, current), formatMode)}`

      for (const [count, btn] of els.fixedButtons) {
        const withinCap = current + count <= max
        btn.disabled = !withinCap || state.currency.lt(bulkUpgradeCost(id, current, count))
      }

      const maxAffordable = maxAffordableCount(id, current, state.currency)
      els.maxButton.disabled = maxAffordable <= 0
      els.maxButton.textContent = maxAffordable > 0 ? `Max (+${maxAffordable.toLocaleString()})` : 'Max'
    }
  }

  return { update }
}
