import type { GameState, TickResult } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { countOfType } from '../game/economy'
import { formatDuration } from './formatDuration'

export interface StatsPanelHandle {
  update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void
}

function makeRow(container: HTMLElement, label: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'stats-row'
  const labelEl = document.createElement('span')
  labelEl.className = 'stats-label'
  labelEl.textContent = label
  const valueEl = document.createElement('span')
  valueEl.className = 'stats-value'
  row.append(labelEl, valueEl)
  container.appendChild(row)
  return valueEl
}

export function createStatsPanel(container: HTMLElement): StatsPanelHandle {
  container.classList.add('panel-section', 'stats-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Stats'
  const rows = document.createElement('div')
  rows.className = 'stats-rows'
  container.append(heading, rows)

  const v = {
    timeSinceStart: makeRow(rows, 'Time since start'),
    timeInPrestige: makeRow(rows, 'Time in current prestige'),
    activePlayTime: makeRow(rows, 'Active play time'),
    ratePerHour: makeRow(rows, 'Current rate / hour'),
    generatorsOnBoard: makeRow(rows, 'Generators on board'),
    generatorsBuiltAllTime: makeRow(rows, 'Generators built (all-time)'),
    totalUpgrades: makeRow(rows, 'Times leveled (all-time)'),
    currencyCurrent: makeRow(rows, 'Currency (current)'),
    currencyLifetime: makeRow(rows, 'Currency (lifetime earned)'),
    highestBasic: makeRow(rows, 'Highest Basic value'),
    highestLeech: makeRow(rows, 'Highest Leech value'),
    highestBuffLevel: makeRow(rows, 'Highest Buff level'),
  }

  function update(state: GameState, result: TickResult, formatMode: NumberFormatMode): void {
    const now = Date.now()
    v.timeSinceStart.textContent = formatDuration(now - state.startedAt)
    v.timeInPrestige.textContent = formatDuration(now - state.prestigeStartedAt)
    v.activePlayTime.textContent = formatDuration(state.activePlayMs)
    // Deliberately based on canonical production, not the debug tick-speed
    // multiplier - that only changes real-time pacing, not what a tick produces.
    v.ratePerHour.textContent = `${format(result.production.times(3600), formatMode)} / hr`

    const onBoard = countOfType(state, 'basic') + countOfType(state, 'leech') + countOfType(state, 'buff')
    v.generatorsOnBoard.textContent = String(onBoard)
    v.generatorsBuiltAllTime.textContent = String(state.totalGeneratorsBuilt)
    v.totalUpgrades.textContent = String(state.totalUpgrades)

    v.currencyCurrent.textContent = format(state.currency, formatMode)
    v.currencyLifetime.textContent = format(state.lifetimeCurrencyEarned, formatMode)

    v.highestBasic.textContent = format(state.highestValue.basic, formatMode)
    v.highestLeech.textContent = format(state.highestValue.leech, formatMode)
    v.highestBuffLevel.textContent = String(state.highestBuffLevel)
  }

  return { update }
}
