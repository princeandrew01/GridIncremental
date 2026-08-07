import type { GameState } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { recalculate, expectedCritMultipliers, expectedPowerCoreProductionPerTick } from '../game/engine'
import { effectiveTickMs } from '../game/upgrades'

export interface CurrencyHeaderHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

interface ResourceBlockEls {
  amount: HTMLElement
  rate: HTMLElement
}

function makeResourceBlock(container: HTMLElement, icon: string, label: string): ResourceBlockEls {
  const block = document.createElement('div')
  block.className = 'resource-block'
  block.setAttribute('aria-label', label)

  const amountRow = document.createElement('div')
  amountRow.className = 'resource-amount'
  const iconEl = document.createElement('span')
  iconEl.className = 'resource-icon'
  iconEl.textContent = icon
  iconEl.setAttribute('aria-hidden', 'true')
  const amount = document.createElement('span')
  amountRow.append(iconEl, amount)

  const rate = document.createElement('div')
  rate.className = 'resource-rate'

  block.append(amountRow, rate)
  container.appendChild(block)
  return { amount, rate }
}

/**
 * The resources row: Energy and Power Cores, each with an icon, current
 * amount, and an expected rate underneath - always visible above the grid,
 * regardless of which right-zone panel is open. Its own full-width row now
 * (see main.ts), no longer nested inside the right zone.
 *
 * The rate is the EXPECTED (stable) per-second figure, not a live per-tick
 * roll - a real crit/proc is a coin flip, so reading straight off the last
 * actual tick made this number visibly jump around. Same fix already
 * applied to the selected-cell detail panel's numbers (see panel.ts) -
 * expectedCritMultipliers on the Energy side, the new
 * expectedPowerCoreProductionPerTick on the Power Cores side (which has had
 * no equivalent since Power Core Chance was removed - output is purely
 * discrete per-generator now).
 */
export function createCurrencyHeader(container: HTMLElement): CurrencyHeaderHandle {
  container.classList.add('resources-row')

  const energy = makeResourceBlock(container, '⚡', 'Energy')
  const powerCores = makeResourceBlock(container, '🔵', 'Power Cores')

  function update(state: GameState, formatMode: NumberFormatMode): void {
    // Ticks-per-second, not a fixed 1 - Tick Speed shortens the real tick
    // length, so the same per-tick figure means a higher per-second rate
    // once it's bought.
    const ticksPerSecond = 1000 / effectiveTickMs(state)

    energy.amount.textContent = `Energy: ${format(state.currency, formatMode)}`
    const expectedEnergyPerTick = recalculate(state, expectedCritMultipliers(state)).production
    energy.rate.textContent = `~${format(expectedEnergyPerTick.times(ticksPerSecond), formatMode)} / s`

    powerCores.amount.textContent = `Power Cores: ${format(state.powerCores, formatMode)}`
    const expectedPowerCoresPerTick = expectedPowerCoreProductionPerTick(state)
    powerCores.rate.textContent = `~${format(expectedPowerCoresPerTick.times(ticksPerSecond), formatMode)} / s`
  }

  return { update }
}
