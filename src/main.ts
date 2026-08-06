import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from './game/types'
import type { GameState, TickResult, UpgradeId, PowerCoreUpgradeId } from './game/types'
import { recalculate, tick, rotateBuffFacing, expectedCritMultipliers } from './game/engine'
import { GRID_W, GRID_H, MAX_CATCHUP_TICKS, STARTING_CURRENCY } from './game/config'
import { placeCell, upgradeCell, removeCell, canAffordPlacement, healGridSize, evolveCell, updateDiscoveredTypes, type PlaceableType, type EvolutionType } from './game/economy'
import { buyUpgrade, effectiveTickMs } from './game/upgrades'
import { buyPowerCoreUpgrade } from './game/powerCoreUpgrades'
import { saveToLocalStorage, loadFromLocalStorage } from './game/save'
import { computeOfflineTicks, applyOfflineProgress } from './game/offline'
import { format } from './game/format'
import { loadSettings, saveSettings, applyTheme, type Settings } from './game/settings'
import { updateHighestValues, checkAchievements } from './game/stats'
import { createGrid, type GridHandle, type GridSelection } from './ui/grid'
import { createAppHeader } from './ui/appHeader'
import { createCurrencyHeader } from './ui/currencyHeader'
import { createTabShell } from './ui/tabShell'
import { createPanel } from './ui/panel'
import { createUpgradesPanel } from './ui/upgradesPanel'
import { createPowerCoreUpgradesPanel } from './ui/powerCoreUpgradesPanel'
import { createStatsPanel } from './ui/statsPanel'
import { createAchievementsPanel } from './ui/achievementsPanel'
import { createPlaceholderPanel } from './ui/placeholderPanel'
import { createSavePanel } from './ui/savePanel'
import { createSettingsPanel } from './ui/settingsPanel'
import { createAboutSection } from './ui/aboutSection'
import { showOfflineBanner } from './ui/offlineBanner'
import './style.css'

const AUTOSAVE_INTERVAL_MS = 10_000

// No type armed for placement by default; the player picks one from the
// build panel. Deselectable three ways: click the active build button again,
// right-click, or click anywhere outside the grid and build buttons.
let buildType: PlaceableType | null = null
let selected: GridSelection | null = null
let state: GameState
let lastResult: TickResult
let gridHandle: GridHandle

// Device preference, not game progress - its own localStorage key (see
// game/settings.ts), loaded once at startup and updated live from the
// settings popover.
let settings: Settings = loadSettings()
applyTheme(settings.theme)

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = ''
app.classList.add('app')

const appHeaderContainer = document.createElement('div')
app.appendChild(appHeaderContainer)
createAppHeader(appHeaderContainer)

const gridContainer = document.createElement('div')
const panelContainer = document.createElement('div')
app.append(gridContainer, panelContainer)
panelContainer.classList.add('panel')

// panelContainer's fixed internal layout: a bordered box (matching the debug
// panel's own dashed-border treatment) holding a header row (currency/
// production on the left, the settings gear inline on the right - always
// visible) -> tab strip -> active tab's content. Save controls live inside
// the settings popover (see below), reachable from the same gear icon.
const boundedShell = document.createElement('div')
boundedShell.className = 'panel-bordered'
const headerRow = document.createElement('div')
headerRow.className = 'panel-header-row'
const currencyHeaderContainer = document.createElement('div')
const settingsContainer = document.createElement('div')
headerRow.append(currencyHeaderContainer, settingsContainer)

const tabShellContainer = document.createElement('div')
boundedShell.append(headerRow, tabShellContainer)
panelContainer.append(boundedShell)

const currencyHeaderHandle = createCurrencyHeader(currencyHeaderContainer)

const tabShellHandle = createTabShell(
  tabShellContainer,
  [
    { id: 'build', label: 'Build' },
    { id: 'upgrades', label: 'Upgrades' },
    { id: 'powerCores', label: 'Power Cores' },
    { id: 'prestige', label: 'Prestige' },
    { id: 'achievements', label: 'Achievements' },
    { id: 'stats', label: 'Stats' },
  ],
  (id) => {
    // Bug fix: switching to any tab other than Build deselects whatever's
    // selected on the grid and disarms any build type - both are
    // Build-tab-specific concepts that would otherwise sit stale/hidden on
    // a different tab. Also fires on the initial construction-time
    // activation (always 'build', the default tab) and on
    // handleCellClick's own programmatic switch *to* 'build' below - both
    // are no-ops here since neither ever needs anything cleared.
    if (id !== 'build' && (buildType !== null || selected !== null)) {
      buildType = null
      selected = null
      render()
    }
  },
)

function render(): void {
  const canPlaceCurrent = buildType !== null && canAffordPlacement(state, buildType)
  // Two stable (non-random) snapshots, recomputed fresh every render instead
  // of reused from the live per-tick `lastResult` - crit is a coin flip each
  // tick, so a per-cell display sourced straight from `lastResult` visibly
  // jumps around every time one fires then falls back the next tick. Neither
  // of these carries that: `displayNoCrit` is the honest baseline (no crit
  // at all - recalculate()'s default), `displayWithCrit` bakes in crit's
  // long-run EXPECTED contribution (expectedCritMultipliers - a constant
  // scalar per Basic, not a roll) instead of one tick's real outcome. Cheap
  // even at 60fps: two more two-pass board evaluations, same cost class as
  // the recalculate() calls already sprinkled through the click handlers
  // below for "refresh immediately, don't wait for next tick".
  const displayNoCrit = recalculate(state)
  const displayWithCrit = recalculate(state, expectedCritMultipliers(state))
  updateDiscoveredTypes(state) // one-time "???" reveal per placeable type - cheap, same call-every-render pattern as the checks below
  gridHandle.update(state, lastResult, displayNoCrit, selected, canPlaceCurrent, settings.numberFormat)
  currencyHeaderHandle.update(state, lastResult, settings.numberFormat)
  panelHandle.update(state, displayNoCrit, displayWithCrit, buildType, selected, settings.numberFormat, settings.showBuildDescriptions)
  upgradesPanelHandle.update(state, settings.numberFormat)
  powerCoreUpgradesPanelHandle.update(state, settings.numberFormat)
  statsPanelHandle.update(state, lastResult, settings.numberFormat)
  achievementsPanelHandle.update(state, settings.numberFormat)
  savePanelHandle.update(state)
}

// Deselects the armed build type and the inspected grid cell in one go, for
// the "away" gestures (right-click, click off the grid) - a single render
// either way, not one per field.
function deselectAll(): void {
  let changed = false
  if (buildType !== null) {
    buildType = null
    changed = true
  }
  if (selected !== null) {
    selected = null
    changed = true
  }
  if (changed) render()
}

function handleCellClick(x: number, y: number): void {
  const i = cellIndex(x, y, state.width)
  const cell = state.cells[i]
  if (cell.type === 'empty') {
    if (buildType && placeCell(state, x, y, buildType)) {
      lastResult = recalculate(state) // refresh values immediately, don't wait for next tick
    }
  } else if (cell.type === 'buff' || cell.type === 'buffStacker') {
    const alreadySelected = selected !== null && selected.x === x && selected.y === y
    // Only rotate if this directional buff was already selected - the very
    // first click that selects it just selects (so the Upgrade menu is
    // reachable without immediately spinning the facing you hadn't even seen
    // yet). A second click while already selected rotates - can't use "click
    // again to deselect" for buffs, that click is already spoken for (see
    // engine.ts nextFacing). Right-click / click off the grid still deselects.
    if (alreadySelected) rotateBuffFacing(state, x, y)
    selected = { x, y }
    buildType = null // inspecting a cell exits placement mode - can't have both armed at once
    tabShellHandle.activateTab('build') // selecting a generator always brings its detail/upgrade view into view
  } else if (selected && selected.x === x && selected.y === y) {
    selected = null // click the already-selected cell again to deselect it
  } else {
    selected = { x, y }
    buildType = null // inspecting a cell exits placement mode - can't have both armed at once
    tabShellHandle.activateTab('build') // selecting a generator always brings its detail/upgrade view into view
  }
  render()
}

function handleUpgrade(): void {
  if (!selected) return
  if (upgradeCell(state, selected.x, selected.y)) {
    lastResult = recalculate(state)
  }
  render()
}

function handleRemove(): void {
  if (!selected) return
  if (removeCell(state, selected.x, selected.y)) {
    lastResult = recalculate(state)
    selected = null // the cell it pointed at is empty now, nothing left to inspect
  }
  render()
}

function handleEvolve(evolutionType: EvolutionType): void {
  if (!selected) return
  if (evolveCell(state, selected.x, selected.y, evolutionType)) {
    lastResult = recalculate(state)
  }
  render()
}

function handleBuyUpgrade(id: UpgradeId, count: number): void {
  const widthBefore = state.width
  const heightBefore = state.height
  if (buyUpgrade(state, id, count)) {
    lastResult = recalculate(state) // refresh previews immediately, don't wait for next tick
    // Grid Size (the one upgrade with a side effect beyond its own level -
    // see upgrades.ts buyUpgrade()) may have just grown the board.
    // gridHandle bakes its dimensions in at construction time, so it has to
    // be rebuilt to pick up the new size - same as useGameState() does for
    // a freshly loaded/started game.
    if (state.width !== widthBefore || state.height !== heightBefore) {
      gridHandle = createGrid(gridContainer, state.width, state.height, handleCellClick)
    }
  }
  render()
}

function handleBuyPowerCoreUpgrade(id: PowerCoreUpgradeId, count: number): void {
  const widthBefore = state.width
  const heightBefore = state.height
  if (buyPowerCoreUpgrade(state, id, count)) {
    lastResult = recalculate(state)
    // Power Core's own Grid Size upgrade can also trigger a resize (see
    // powerCoreUpgrades.ts buyPowerCoreUpgrade - same side effect as
    // energy's, just against the combined total) - same rebuild as above.
    if (state.width !== widthBefore || state.height !== heightBefore) {
      gridHandle = createGrid(gridContainer, state.width, state.height, handleCellClick)
    }
  }
  render()
}

// Swaps in a fully-formed GameState (fresh or loaded) and rebuilds whatever
// UI depends on its dimensions. The one place that "starts" or "replaces"
// the game. Also the one place that keeps highestValue/highestBuffLevel,
// unlockedAchievements, and power core exponent awards self-consistent with
// the board/stats it's handed - cheap for a fresh board, and what makes a
// migrated save's backfilled values heal immediately instead of sitting
// wrong until the next board change.
function useGameState(newState: GameState): void {
  state = newState
  buildType = null
  selected = null
  healGridSize(state) // self-heal for the Grid Size rebalance - see economy.ts; a no-op for an already-compliant board
  lastResult = recalculate(state)
  updateHighestValues(state, lastResult)
  checkAchievements(state)

  gridHandle = createGrid(gridContainer, state.width, state.height, handleCellClick) // clears/rebuilds gridContainer itself
  render()
}

// (Re)starts a fresh game at the given board size. Only used at startup when
// no save exists - growing an existing board is resizeGrid()'s job (see the
// Grid Size upgrade in upgrades.ts), which preserves what's already there;
// this always starts completely empty.
function initGame(width: number, height: number): void {
  const fresh = makeGameState(width, height)
  fresh.currency = new Decimal(STARTING_CURRENCY) // see config.ts: bootstrap for a fresh game
  useGameState(fresh)
}

// Closed-form catch-up (spec §6) for a state that was actually *loaded*
// (startup from localStorage, or Import) - never for a freshly-created
// board, which has nothing to catch up on. Mutates `loaded` in place, then
// re-saves so lastSaved is stamped to now: otherwise closing the tab again
// within the next autosave window would compute the same elapsed time twice.
// Uses the state's OWN effective tick length (Tick Speed upgrade included) -
// both how many ticks elapsed and how many ticks 24h caps out at have to
// agree with what the player actually had equipped while away.
function applyOfflineCatchUp(loaded: GameState): GameState {
  const tickMs = effectiveTickMs(loaded)
  const ticks = computeOfflineTicks(loaded.lastSaved, tickMs)
  if (ticks > 0) {
    const result = applyOfflineProgress(loaded, ticks)
    if (result.currencyGained.gt(0) || result.powerCoresGained.gt(0)) {
      const energyPart = `${format(result.currencyGained, settings.numberFormat)} energy`
      const powerCorePart = result.powerCoresGained.gt(0) ? ` and ${format(result.powerCoresGained, settings.numberFormat)} power cores` : ''
      showOfflineBanner(`Welcome back! Earned ${energyPart}${powerCorePart} while away (${ticks} ticks).`)
    }
    saveToLocalStorage(loaded)
  }
  return loaded
}

const panelHandle = createPanel(
  tabShellHandle.contentContainer('build'),
  (type) => {
    buildType = buildType === type ? null : type // click the active type again to deselect
    selected = null // arming a build type exits inspect mode - can't have both armed at once
    render()
  },
  handleUpgrade,
  handleRemove,
  handleEvolve,
)
const upgradesPanelHandle = createUpgradesPanel(tabShellHandle.contentContainer('upgrades'), handleBuyUpgrade)
const powerCoreUpgradesPanelHandle = createPowerCoreUpgradesPanel(tabShellHandle.contentContainer('powerCores'), handleBuyPowerCoreUpgrade)
createPlaceholderPanel(tabShellHandle.contentContainer('prestige'), 'Prestige')
const statsPanelHandle = createStatsPanel(tabShellHandle.contentContainer('stats'))
const achievementsPanelHandle = createAchievementsPanel(tabShellHandle.contentContainer('achievements'))

const settingsPanelHandle = createSettingsPanel(settingsContainer, settings, (newSettings) => {
  settings = newSettings
  saveSettings(settings)
  applyTheme(settings.theme)
  render()
})

// Save controls live inside the settings popover, below the format/volume/
// theme controls - not buried behind a game-content tab since saving
// shouldn't require navigating away from wherever you are, but also not
// competing for space with Build/Stats/etc.
const saveContainer = document.createElement('div')
saveContainer.className = 'settings-save-section'
settingsPanelHandle.contentContainer.appendChild(saveContainer)
const savePanelHandle = createSavePanel(
  saveContainer,
  (imported) => {
    useGameState(applyOfflineCatchUp(imported))
  },
  () => {
    initGame(GRID_W, GRID_H) // fresh board, currency, stats, achievements, upgrades - everything
    saveToLocalStorage(state) // persist the wipe immediately, don't wait for the next autosave
  },
)

// About (inspired-by credit, author, version) at the very bottom of the popover.
const aboutContainer = document.createElement('div')
settingsPanelHandle.contentContainer.appendChild(aboutContainer)
createAboutSection(aboutContainer)

// Try to resume a save; only start fresh if there isn't one.
const loadedAtStartup = loadFromLocalStorage()

if (loadedAtStartup) {
  useGameState(applyOfflineCatchUp(loadedAtStartup))
} else {
  initGame(GRID_W, GRID_H)
}

// Right-click anywhere in the app deselects the armed build type and the
// inspected cell instead of opening a menu.
app.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  deselectAll()
})

// Clicking anywhere outside the grid and the side panel deselects too.
// (Clicks on the grid are handled by their own listener above, which sets
// buildType/selected deliberately - don't fight it. The *entire* side panel
// is excluded, not just the build buttons: it holds a lot of legitimate
// controls - Upgrade, tabs, Stats, Save, Settings - and none of them should
// accidentally wipe the current selection just because they aren't the
// grid. That's what caused clicking Upgrade to immediately deselect the
// cell it had just acted on.)
//
// Uses composedPath() rather than e.target.closest(): a click on an occupied
// cell hits an inner <span>, and handleCellClick's render() call replaces
// that cell's innerHTML (destroying the span that was e.target) before this
// listener runs in the bubble phase. closest() on a since-detached node
// fails silently, which made every cell selection immediately undo itself.
// composedPath() is captured at dispatch time and isn't affected by that.
document.addEventListener('click', (e) => {
  const excluded = e.composedPath().some((el) => {
    if (!(el instanceof Element)) return false
    return el.classList.contains('grid') || el.classList.contains('panel')
  })
  if (excluded) return
  deselectAll()
})

// Autosave every 10s and on visibilitychange (spec §8), wrapped in try/catch
// inside save.ts since localStorage throws in private browsing / is blocked
// in some iframes.
setInterval(() => saveToLocalStorage(state), AUTOSAVE_INTERVAL_MS)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveToLocalStorage(state)
})

// Fixed-timestep game loop, decoupled from frame rate (spec §5 "Timing").
let acc = 0
let lastFrameTime = performance.now()

// Active-tab-time checkpoint for state.activePlayMs (powers the playtime
// achievements - deliberately *not* wall-clock time, so it excludes both
// backgrounded-tab time and offline time). null means "not currently
// accumulating" (tab hidden, or haven't started a visible stretch yet).
// Reset to null on hidden so the first frame after becoming visible again
// just re-anchors the checkpoint instead of counting the gap.
let activeCheckpoint: number | null = null

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') activeCheckpoint = null
})

function frame(now: number): void {
  const dt = now - lastFrameTime
  lastFrameTime = now
  acc += dt

  if (document.visibilityState === 'visible') {
    if (activeCheckpoint !== null) state.activePlayMs += now - activeCheckpoint
    activeCheckpoint = now
  } else {
    activeCheckpoint = null
  }

  const effectiveMs = effectiveTickMs(state)
  let iterations = 0
  while (acc >= effectiveMs && iterations < MAX_CATCHUP_TICKS) {
    acc -= effectiveMs
    lastResult = tick(state)
    iterations++
  }
  if (iterations > 0) {
    updateHighestValues(state, lastResult)
    checkAchievements(state)
  }

  render()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
