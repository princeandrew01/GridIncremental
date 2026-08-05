import type { GameState, TickResult } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'

export interface CurrencyHeaderHandle {
  update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void
}

/** Currency + production, always visible above the tab strip regardless of which tab is active. */
export function createCurrencyHeader(container: HTMLElement): CurrencyHeaderHandle {
  container.classList.add('panel-stats')

  const currencyEl = document.createElement('div')
  currencyEl.className = 'panel-currency'
  const productionEl = document.createElement('div')
  productionEl.className = 'panel-production'
  container.append(currencyEl, productionEl)

  function update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void {
    currencyEl.textContent = `Currency: ${format(state.currency, formatMode)}`
    productionEl.textContent = `Production: ${format(result.production, formatMode)} / s`
  }

  return { update }
}
