import type { GameState } from '../game/types'
import type { UpgradeId } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import {
  UPGRADE_IDS,
  UPGRADE_LABEL,
  maxLevelFor,
  bulkUpgradeCost,
  maxAffordableCount,
  basicValueBonus,
  generatorValueMultiplier,
  critChanceFor,
  critAmountFor,
  refundFraction,
  effectiveTickMs,
  powerCoreGeneratorCap,
} from '../game/upgrades'

export interface UpgradesPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

// Buy-quantity presets, picked once via the toolbar at the top of the tab
// (see createUpgradesPanel) rather than as 4 separate buttons repeated on
// every row - the user asked for this after finding the old per-row x1/x10/
// x100 strip repetitive. 'max' buys as many as currently affordable, same
// meaning as before.
type BuyCount = 1 | 10 | 25 | 'max'
const BUY_COUNTS: BuyCount[] = [1, 10, 25, 'max']

interface RowEls {
  level: HTMLElement
  value: HTMLElement
  cost: HTMLElement
  buyButton: HTMLButtonElement
}

/**
 * One line describing the account-wide EFFECT this upgrade actually has
 * right now, at its current level - not just the level number, which on
 * its own doesn't say what e.g. "Level 7" of Tick Speed means. UI-only
 * presentation logic; every formula it reads already lives in upgrades.ts.
 */
function currentValueText(state: GameState, id: UpgradeId): string {
  switch (id) {
    case 'tickSpeed':
      return `${effectiveTickMs(state).toFixed(0)}ms / tick`
    case 'basicValue':
      return `+${basicValueBonus(state).toLocaleString()} flat`
    case 'generatorValuePct':
      return `+${((generatorValueMultiplier(state) - 1) * 100).toFixed(0)}%`
    case 'critChance':
      return `${(critChanceFor(state, false) * 100).toFixed(1)}%`
    case 'critAmount':
      return `${critAmountFor(state, false).toFixed(2)}x`
    case 'removalRefund':
      return `${(refundFraction(state) * 100).toFixed(0)}%`
    case 'gridSize':
      return `${state.width}×${state.height}`
    case 'powerGeneratorCount': {
      const cap = powerCoreGeneratorCap(state)
      return `${cap.toLocaleString()} generator${cap === 1 ? '' : 's'} allowed`
    }
  }
}

/** Real Upgrades tab: one row per account-wide upgrade (see game/upgrades.ts) - level, current effect, next cost, and a single Buy button using whatever quantity is selected in the sticky toolbar above. */
export function createUpgradesPanel(container: HTMLElement, onBuy: (id: UpgradeId, count: number) => void): UpgradesPanelHandle {
  container.classList.add('panel-section', 'upgrades-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Energy'
  container.appendChild(heading)

  // Buy buttons read `latestState`/`latestFormatMode` at click/toolbar-toggle
  // time rather than capturing them up front - needed for Max, whose
  // affordable count changes with currency every frame.
  let latestState: GameState | null = null
  let latestFormatMode: NumberFormatMode = 'scientific'
  let selectedCount: BuyCount = 1

  /** How many levels a Buy click on `id` would actually purchase right now, given the toolbar's selected quantity - 0 if already maxed, clamped to the level cap for a fixed quantity, or the real affordable count for 'max'. Shared by both the display (update) and the click handler, so they can never disagree. */
  function resolveBuyCount(state: GameState, id: UpgradeId): number {
    const current = state.upgrades[id]
    const max = maxLevelFor(id)
    if (current >= max) return 0
    if (selectedCount === 'max') return maxAffordableCount(id, current, state.currency)
    return Math.min(selectedCount, max - current)
  }

  // Sticky toolbar: pinned to the top of the tab's own scroll area (see
  // .tab-content-area/.upgrade-toolbar in style.css) while the rows below
  // scroll underneath it - pick a quantity once instead of hunting for the
  // right one of 4 buttons on every single row.
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

  const rows = new Map<UpgradeId, RowEls>()

  for (const id of UPGRADE_IDS) {
    const row = document.createElement('div')
    row.className = 'upgrade-row'

    const info = document.createElement('div')
    info.className = 'upgrade-info'
    const name = document.createElement('div')
    name.className = 'upgrade-name'
    name.textContent = UPGRADE_LABEL[id]
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
    rows.set(id, { level, value, cost, buyButton })
  }

  function update(state: GameState, formatMode: NumberFormatMode): void {
    latestState = state
    latestFormatMode = formatMode
    for (const id of UPGRADE_IDS) {
      const els = rows.get(id)!
      const current = state.upgrades[id]
      const max = maxLevelFor(id)
      const maxed = current >= max
      els.level.textContent = `Level ${current.toLocaleString()} / ${max.toLocaleString()}`
      els.value.textContent = `Current: ${currentValueText(state, id)}`

      if (maxed) {
        els.cost.textContent = 'Maxed'
        els.buyButton.disabled = true
        els.buyButton.textContent = 'Maxed'
        continue
      }

      const count = resolveBuyCount(state, id)
      if (count <= 0) {
        // Only reachable in 'max' mode - a fixed quantity always resolves to
        // at least 1 level while not maxed, affordable or not.
        els.cost.textContent = 'Not enough energy'
        els.buyButton.disabled = true
        els.buyButton.textContent = 'Buy'
      } else {
        const cost = bulkUpgradeCost(id, current, count)
        const affordable = state.currency.gte(cost)
        els.cost.textContent = `Cost: ⚡ ${format(cost, formatMode)}`
        els.buyButton.disabled = !affordable
        els.buyButton.textContent = `Buy x${count.toLocaleString()}`
      }
    }
  }

  return { update }
}
