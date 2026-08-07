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
import { createGrid, type GridHandle, type GridSelection, TYPE_LABEL, TYPE_ICON } from './ui/grid'
import { createAppHeader } from './ui/appHeader'
import { createDevLogPanel } from './ui/devLogPanel'
import { createHelpPanel } from './ui/helpPanel'
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

// --- Top bar: title (left) + Dev Log/Help/Settings icon toggles (right,
// via appHeaderHandle.iconGroup). ---
const appHeaderContainer = document.createElement('div')
app.appendChild(appHeaderContainer)
const appHeaderHandle = createAppHeader(appHeaderContainer)

const devLogContainer = document.createElement('div')
appHeaderHandle.iconGroup.appendChild(devLogContainer)
createDevLogPanel(devLogContainer)

const helpContainer = document.createElement('div')
appHeaderHandle.iconGroup.appendChild(helpContainer)
createHelpPanel(helpContainer)

const settingsContainer = document.createElement('div')
appHeaderHandle.iconGroup.appendChild(settingsContainer)

// --- Resources row: Energy + Power Cores, each with an expected rate
// underneath - its own full-width row now, no longer nested inside the
// right zone's bordered box (see style.css .resources-row). ---
const resourcesContainer = document.createElement('div')
app.appendChild(resourcesContainer)
const currencyHeaderHandle = createCurrencyHeader(resourcesContainer)

// --- Grid (left) + right zone (icon rail + the open panel's content, see
// ui/tabShell.ts). The right zone's bordered box now wraps just the rail +
// content - currency/settings used to live in a header row inside it, both
// moved up to the rows above. ---
const gridContainer = document.createElement('div')
const panelContainer = document.createElement('div')
app.append(gridContainer, panelContainer)
panelContainer.classList.add('panel')

const boundedShell = document.createElement('div')
boundedShell.className = 'panel-bordered'
const tabShellContainer = document.createElement('div')
boundedShell.append(tabShellContainer)
panelContainer.append(boundedShell)

const tabShellHandle = createTabShell(
  tabShellContainer,
  [
    { id: 'build', label: 'Build', icon: '🔨' },
    { id: 'upgrades', label: 'Energy', icon: '⚡' },
    { id: 'powerCores', label: 'Power Cores', icon: '🔵' },
    { id: 'prestige', label: 'Prestige', icon: '⭐' },
    { id: 'achievements', label: 'Achievements', icon: '🏆' },
    { id: 'stats', label: 'Stats', icon: '📊' },
    // Last in the rail (bottom, since .tab-strip stacks top-to-bottom in
    // DOM order) - hidden until something's selected, see
    // syncCellDetailTab() below, which also sets its real icon/label to
    // match whatever's selected.
    { id: 'cellDetail', label: 'Selected', icon: '🔍' },
  ],
  (id) => {
    // Each of buildType/selected only makes sense on its own one tab
    // (buildType: 'build', selected: 'cellDetail') - never both non-null at
    // once (arming a build type clears any selection and vice versa) - so
    // navigating to any OTHER tab clears whichever one applies. Clicking
    // 'build' while a cell is selected still deselects the cell (per the
    // user: "when you click another menu item, automatically deselect the
    // generator") - but clicking 'build' does NOT clear buildType itself,
    // so re-clicking the tab you're already placing from doesn't cancel
    // your own armed selection. Also fires on the initial construction-time
    // activation (always 'build') and on handleCellClick's own programmatic
    // switch *to* 'cellDetail' below - both no-ops, neither ever clears
    // anything relevant to itself.
    let changed = false
    if (id !== 'build' && buildType !== null) {
      buildType = null
      changed = true
    }
    if (id !== 'cellDetail' && selected !== null) {
      selected = null
      changed = true
    }
    if (changed) render()
  },
)
tabShellHandle.setTabHidden('cellDetail', true)

// Shows/hides the "selected cell" rail tab and keeps its icon/label in sync
// with whatever's actually selected - called every render() (cheap, and
// selection can change from several different code paths, so this is
// simpler than threading an explicit sync call through each of them).
function syncCellDetailTab(): void {
  const cell = selected ? state.cells[cellIndex(selected.x, selected.y, state.width)] : null
  const hasDetail = cell !== null && cell.type !== 'empty'
  tabShellHandle.setTabHidden('cellDetail', !hasDetail)
  if (hasDetail) tabShellHandle.setTabIcon('cellDetail', TYPE_ICON[cell!.type], TYPE_LABEL[cell!.type])
}

function render(): void {
  syncCellDetailTab()
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
  currencyHeaderHandle.update(state, settings.numberFormat)
  panelHandle.update(state, displayNoCrit, displayWithCrit, buildType, selected, settings.numberFormat)
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
    tabShellHandle.activateTab('build') // the selected-cell tab is about to hide (see syncCellDetailTab) - don't leave it "active" but invisible
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
    tabShellHandle.activateTab('cellDetail') // selecting a generator always brings its own tab into view
  } else if (selected && selected.x === x && selected.y === y) {
    selected = null // click the already-selected cell again to deselect it
    tabShellHandle.activateTab('build') // the selected-cell tab is about to hide (see syncCellDetailTab) - don't leave it "active" but invisible
  } else {
    selected = { x, y }
    buildType = null // inspecting a cell exits placement mode - can't have both armed at once
    tabShellHandle.activateTab('cellDetail') // selecting a generator always brings its own tab into view
  }
  render()
}

function handleUpgrade(count: number): void {
  if (!selected) return
  if (upgradeCell(state, selected.x, selected.y, count)) {
    lastResult = recalculate(state)
  }
  render()
}

function handleRemove(): void {
  if (!selected) return
  if (removeCell(state, selected.x, selected.y)) {
    lastResult = recalculate(state)
    selected = null // the cell it pointed at is empty now, nothing left to inspect
    tabShellHandle.activateTab('build') // the selected-cell tab is about to hide (see syncCellDetailTab) - don't leave it "active" but invisible
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
  tabShellHandle.contentContainer('cellDetail'),
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
