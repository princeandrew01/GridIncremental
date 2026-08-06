// Throwaway balance simulation - not committed, deleted after use.
// Layout: Leech at center, 8 Basics in the Moore ring around it, 12 Buffs
// on the surrounding 5x5 border (facing inward at the nearest Basic), and a
// Power Core Generator in one corner. Greedy "cheapest affordable action
// first" auto-buyer, run tick by tick using the real engine.

import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from './src/game/types'
import type { GameState, UpgradeId } from './src/game/types'
import { tick } from './src/game/engine'
import {
  placeCell,
  upgradeCell,
  canUpgrade,
  isMaxLevel,
  canAffordPlacement,
  isBuildable,
  upgradeCost,
  placementCost,
} from './src/game/economy'
import type { PlaceableType } from './src/game/economy'
import { buyUpgrade, effectiveTickMs, maxLevelFor, bulkUpgradeCost } from './src/game/upgrades'
import { buyPowerCoreUpgrade, pcMaxLevelFor, pcBulkUpgradeCost } from './src/game/powerCoreUpgrades'
import { STARTING_CURRENCY } from './src/game/config'
import type { PowerCoreUpgradeId } from './src/game/types'

const LEECH = { x: 2, y: 2 }
const BASICS = [
  [1, 1], [2, 1], [3, 1],
  [1, 2],         [3, 2],
  [1, 3], [2, 3], [3, 3],
]
const BUFFS = [
  [1, 0], [2, 0], [3, 0],
  [0, 1],                 [4, 1],
  [0, 2],                 [4, 2],
  [0, 3],                 [4, 3],
  [1, 4], [2, 4], [3, 4],
]
const POWER_CORE_GEN = { x: 0, y: 0 }

const ENERGY_UPGRADE_IDS: UpgradeId[] = [
  'tickSpeed', 'basicValue', 'generatorValuePct', 'critChance', 'critAmount', 'removalRefund', 'gridSize', 'powerGeneratorCount',
]
const POWER_CORE_UPGRADE_IDS: PowerCoreUpgradeId[] = ['gridSize', 'critTowerSlots', 'basicSteadySlots', 'buffStackerSlots', 'buffAllSlots']

function fmt(d: Decimal): string {
  const n = d.toNumber()
  if (!isFinite(n)) return d.toExponential(3)
  if (Math.abs(n) < 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return d.toExponential(3)
}

function fmtDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = s / 60
  if (m < 60) return `${m.toFixed(1)}m`
  const h = m / 60
  if (h < 48) return `${h.toFixed(2)}h`
  const d = h / 24
  return `${d.toFixed(2)}d`
}

function run(): void {
  const state = makeGameState(4, 4)
  state.currency = new Decimal(STARTING_CURRENCY)

  const buildQueue: { x: number; y: number; type: PlaceableType }[] = []
  for (const [x, y] of BASICS) buildQueue.push({ x, y, type: 'basic' })
  buildQueue.push({ x: LEECH.x, y: LEECH.y, type: 'leech' })
  for (const [x, y] of BUFFS) buildQueue.push({ x, y, type: 'buff' })
  buildQueue.push({ x: POWER_CORE_GEN.x, y: POWER_CORE_GEN.y, type: 'powerCoreGenerator' })

  let placed = 0
  let realMs = 0

  const milestones: { name: string; tick: number; ms: number }[] = []
  const reached = new Set<string>()
  function mark(name: string): void {
    if (reached.has(name)) return
    reached.add(name)
    milestones.push({ name, tick: state.tickCount, ms: realMs })
  }

  const nextProductionThreshold = { i: 0 }
  const PRODUCTION_THRESHOLDS = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24, 1e30]

  const MAX_TICKS = 4_000_000
  const wallClockStart = Date.now()
  const WALL_CLOCK_BUDGET_MS = 90_000

  let energyUpgradeMaxed: Record<UpgradeId, boolean> = {
    tickSpeed: false, basicValue: false, generatorValuePct: false, critChance: false,
    critAmount: false, removalRefund: false, gridSize: false, powerGeneratorCount: false,
  }
  let powerCoreUpgradeMaxed: Record<PowerCoreUpgradeId, boolean> = {
    gridSize: false, critTowerSlots: false, basicSteadySlots: false, buffStackerSlots: false, buffAllSlots: false,
  }

  for (let t = 0; t < MAX_TICKS; t++) {
    realMs += effectiveTickMs(state)
    const result = tick(state)

    if (result.production.toNumber() > 0) {
      while (
        nextProductionThreshold.i < PRODUCTION_THRESHOLDS.length &&
        result.production.gte(PRODUCTION_THRESHOLDS[nextProductionThreshold.i])
      ) {
        mark(`production_${PRODUCTION_THRESHOLDS[nextProductionThreshold.i]}`)
        nextProductionThreshold.i++
      }
    }

    // --- Energy shopping pass: cheapest affordable action, repeat until nothing's left. ---
    let boughtSomething = true
    while (boughtSomething) {
      boughtSomething = false
      let bestCost: Decimal | null = null
      let bestAction: (() => void) | null = null

      // Next queued placement (only the head - fixed build order). Free
      // (powerCoreGenerator) placements are always taken immediately since
      // there's no cost to compare; Energy-priced ones (basic/leech/buff)
      // compete on cost like everything else.
      const next = buildQueue[placed]
      if (next && next.x < state.width && next.y < state.height && isBuildable(state, next.type) && canAffordPlacement(state, next.type)) {
        const cost = next.type === 'powerCoreGenerator' ? new Decimal(0) : placementCost(state, next.type)
        if (bestCost === null || cost.lt(bestCost)) {
          bestCost = cost
          const placingType = next.type
          const px = next.x
          const py = next.y
          bestAction = () => {
            placeCell(state, px, py, placingType)
            placed++
            mark(`placed_${placingType}_${placed}`)
          }
        }
      }

      // Cell upgrades - cheapest across the whole board.
      for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
          const cell = state.cells[cellIndex(x, y, state.width)]
          if (cell.type === 'empty' || cell.type === 'basicCrit' || cell.type === 'basicSteady' || cell.type === 'buffStacker' || cell.type === 'buffAll') continue
          if (isMaxLevel(cell.type, cell.level)) continue
          if (!canUpgrade(state, x, y)) continue
          const cost = upgradeCost(cell.type as PlaceableType, cell.level)
          if (cost.gte(state.currency)) continue // afford-check, currency-denominated only (powerCoreGenerator upgrades are power-core priced, handled in the other loop)
          if (cell.type === 'powerCoreGenerator') continue // that one's Power-Core priced, not Energy - handled below
          if (bestCost === null || cost.lt(bestCost)) {
            bestCost = cost
            const cx = x, cy = y
            bestAction = () => {
              upgradeCell(state, cx, cy)
            }
          }
        }
      }

      // Account-wide Energy upgrades.
      for (const id of ENERGY_UPGRADE_IDS) {
        if (energyUpgradeMaxed[id]) continue
        const current = state.upgrades[id]
        if (current >= maxLevelFor(id)) {
          energyUpgradeMaxed[id] = true
          mark(`energy_upgrade_maxed_${id}`)
          continue
        }
        const cost = bulkUpgradeCost(id, current, 1)
        if (cost.gte(state.currency)) continue
        if (bestCost === null || cost.lt(bestCost)) {
          bestCost = cost
          bestAction = () => {
            const before = state.width
            buyUpgrade(state, id, 1)
            mark(`energy_upgrade_bought_${id}_${state.upgrades[id]}`)
            if (id === 'gridSize' && state.width !== before) mark('grid_5x5')
          }
        }
      }

      if (bestAction) {
        bestAction()
        boughtSomething = true
      }
    }

    // --- Power Core shopping pass: separate currency, its own cheapest-first loop. ---
    if (state.powerCores.gt(0)) {
      let boughtPc = true
      while (boughtPc) {
        boughtPc = false
        let bestCost: Decimal | null = null
        let bestAction: (() => void) | null = null

        // Power Core Generator's own per-cell level (Power-Core priced).
        for (let y = 0; y < state.height; y++) {
          for (let x = 0; x < state.width; x++) {
            const cell = state.cells[cellIndex(x, y, state.width)]
            if (cell.type !== 'powerCoreGenerator') continue
            if (isMaxLevel(cell.type, cell.level)) continue
            const cost = upgradeCost('powerCoreGenerator', cell.level)
            if (cost.gte(state.powerCores)) continue
            if (bestCost === null || cost.lt(bestCost)) {
              bestCost = cost
              const cx = x, cy = y
              bestAction = () => {
                upgradeCell(state, cx, cy)
                mark(`power_core_generator_level_${state.cells[cellIndex(cx, cy, state.width)].level}`)
              }
            }
          }
        }

        for (const id of POWER_CORE_UPGRADE_IDS) {
          if (powerCoreUpgradeMaxed[id]) continue
          const current = state.powerCoreUpgrades[id]
          if (current >= pcMaxLevelFor(id)) {
            powerCoreUpgradeMaxed[id] = true
            mark(`pc_upgrade_maxed_${id}`)
            continue
          }
          const cost = pcBulkUpgradeCost(id, current, 1)
          if (cost.gte(state.powerCores)) continue
          if (bestCost === null || cost.lt(bestCost)) {
            bestCost = cost
            bestAction = () => {
              buyPowerCoreUpgrade(state, id, 1)
              mark(`pc_upgrade_bought_${id}_${state.powerCoreUpgrades[id]}`)
            }
          }
        }

        if (bestAction) {
          bestAction()
          boughtPc = true
        }
      }
    }

    if (Date.now() - wallClockStart > WALL_CLOCK_BUDGET_MS) {
      console.log(`\n[stopped early: wall-clock budget of ${WALL_CLOCK_BUDGET_MS}ms hit at tick ${t}]`)
      break
    }
  }

  console.log('=== Leech-center / Basic-ring / Buff-border / corner Power Core Generator ===\n')
  console.log(`Simulated ${state.tickCount.toLocaleString()} ticks (${fmtDuration(realMs)} of real play time at the tick speed bought along the way)\n`)

  console.log('--- Milestones (in order reached) ---')
  for (const m of milestones) {
    console.log(`${fmtDuration(m.ms).padStart(9)}  (tick ${m.tick.toLocaleString().padStart(9)})  ${m.name}`)
  }

  console.log('\n--- Final snapshot ---')
  console.log(`Energy: ${fmt(state.currency)} (lifetime earned: ${fmt(state.lifetimeCurrencyEarned)})`)
  console.log(`Power Cores: ${fmt(state.powerCores)}`)
  console.log(`Board: ${state.width}x${state.height}`)
  console.log(`Energy upgrades:`, Object.fromEntries(ENERGY_UPGRADE_IDS.map((id) => [id, state.upgrades[id]])))
  console.log(`Power Core upgrades:`, Object.fromEntries(POWER_CORE_UPGRADE_IDS.map((id) => [id, state.powerCoreUpgrades[id]])))
  const cellSummary: Record<string, { count: number; levels: number[] }> = {}
  for (const cell of state.cells) {
    if (cell.type === 'empty') continue
    if (!cellSummary[cell.type]) cellSummary[cell.type] = { count: 0, levels: [] }
    cellSummary[cell.type].count++
    cellSummary[cell.type].levels.push(cell.level)
  }
  console.log('Cells:', cellSummary)
}

run()
