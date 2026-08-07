import type { GameState, TickResult } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { countOfType } from '../game/economy'
import { critChanceFor, critAmountFor, refundFraction } from '../game/upgrades'
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
    globalCritChance: makeRow(rows, 'Global crit chance'),
    globalCritAmount: makeRow(rows, 'Global crit amount'),
    generatorsOnBoard: makeRow(rows, 'Generators on board'),
    generatorsBuiltAllTime: makeRow(rows, 'Generators built (all-time)'),
    totalUpgrades: makeRow(rows, 'Times leveled (all-time)'),
    currencyCurrent: makeRow(rows, 'Energy (current)'),
    currencyLifetime: makeRow(rows, 'Energy (lifetime earned)'),
    currentRunEnergy: makeRow(rows, 'Energy earned (current run)'),
    bestRunEnergy: makeRow(rows, 'Energy earned (best run)'),
    powerCores: makeRow(rows, 'Power cores'),
    removalRefundPct: makeRow(rows, 'Removal refund (cost to sell)'),
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

    // "Global" = the account-wide component from upgrades alone, with no
    // Crit Generator bonus mixed in (isCritTower: false) - a plain Basic or
    // Basic Steady's own tooltip (see grid.ts) shows exactly this; a Crit
    // Generator's shows its own boosted figure instead.
    v.globalCritChance.textContent = `${(critChanceFor(state, false) * 100).toFixed(1)}%`
    v.globalCritAmount.textContent = `${critAmountFor(state, false).toFixed(2)}x`

    const onBoard = (
      ['basic', 'leech', 'buff', 'buffStacker', 'buffAll', 'basicCrit', 'basicSteady', 'powerCoreGenerator'] as const
    ).reduce((sum, type) => sum + countOfType(state, type), 0)
    v.generatorsOnBoard.textContent = String(onBoard)
    v.generatorsBuiltAllTime.textContent = String(state.totalGeneratorsBuilt)
    v.totalUpgrades.textContent = String(state.totalUpgrades)

    v.currencyCurrent.textContent = format(state.currency, formatMode)
    v.currencyLifetime.textContent = format(state.lifetimeCurrencyEarned, formatMode)
    v.currentRunEnergy.textContent = format(state.currentRunEnergyEarned, formatMode)
    v.bestRunEnergy.textContent = format(state.bestRunEnergyEarned, formatMode)

    v.powerCores.textContent = format(state.powerCores, formatMode)
    v.removalRefundPct.textContent = `${(refundFraction(state) * 100).toFixed(0)}%`

    v.highestBasic.textContent = format(state.highestValue.basic, formatMode)
    v.highestLeech.textContent = format(state.highestValue.leech, formatMode)
    v.highestBuffLevel.textContent = String(state.highestBuffLevel)
  }

  return { update }
}
