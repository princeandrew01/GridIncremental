import type { GameState, TickResult } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'

export interface CurrencyHeaderHandle {
  update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void
}

/** Energy + production + Power Cores, always visible above the tab strip regardless of which tab is active. */
export function createCurrencyHeader(container: HTMLElement): CurrencyHeaderHandle {
  container.classList.add('panel-stats')

  const currencyEl = document.createElement('div')
  currencyEl.className = 'panel-currency'
  const productionEl = document.createElement('div')
  productionEl.className = 'panel-production'
  const powerCoresEl = document.createElement('div')
  powerCoresEl.className = 'panel-power-cores'
  container.append(currencyEl, productionEl, powerCoresEl)

  function update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void {
    currencyEl.textContent = `Energy: ${format(state.currency, formatMode)}`
    productionEl.textContent = `Production: ${format(result.production, formatMode)} / s`
    powerCoresEl.textContent = `Power Cores: ${format(state.powerCores, formatMode)}`
  }

  return { update }
}
