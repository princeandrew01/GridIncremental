import Decimal from 'break_infinity.js'
import { makeGameState, cellIndex } from './game/types'
import type { GameState, TickResult } from './game/types'
import { recalculate, tick, rotateBuffFacing } from './game/engine'
import { TICK_MS, GRID_W, GRID_H, MAX_CATCHUP_TICKS, STARTING_CURRENCY } from './game/config'
import { placeCell, upgradeCell, removeCell, canAffordPlacement, type BuildableType } from './game/economy'
import { saveToLocalStorage, loadFromLocalStorage } from './game/save'
import { computeOfflineTicks, applyOfflineProgress } from './game/offline'
import { format } from './game/format'
import { loadSettings, saveSettings, applyTheme, type Settings } from './game/settings'
import { updateHighestValues, checkAchievements } from './game/stats'
import { createGrid, type GridHandle, type GridSelection } from './ui/grid'
import { createCurrencyHeader } from './ui/currencyHeader'
import { createTabShell } from './ui/tabShell'
import { createPanel } from './ui/panel'
import { createStatsPanel } from './ui/statsPanel'
import { createAchievementsPanel } from './ui/achievementsPanel'
import { createPlaceholderPanel } from './ui/placeholderPanel'
import { createSavePanel } from './ui/savePanel'
import { createDebugPanel } from './ui/debugPanel'
import { createSettingsPanel } from './ui/settingsPanel'
import { createAboutSection } from './ui/aboutSection'
import { showOfflineBanner } from './ui/offlineBanner'
import './style.css'

const AUTOSAVE_INTERVAL_MS = 10_000

// No type armed for placement by default; the player picks one from the
// build panel. Deselectable three ways: click the active build button again,
// right-click, or click anywhere outside the grid and build buttons.
let buildType: BuildableType | null = null
let selected: GridSelection | null = null
let state: GameState
let lastResult: TickResult
let gridHandle: GridHandle

// Device preference, not game progress - its own localStorage key (see
// game/settings.ts), loaded once at startup and updated live from the
// settings popover.
let settings: Settings = loadSettings()
applyTheme(settings.theme)

// Debug-only, not part of GameState and never saved: effective tick length
// is TICK_MS * tickSpeedMultiplier. 1 = normal speed, 0.1 = 10x faster.
let tickSpeedMultiplier = 1

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = ''
app.classList.add('app')

const gridContainer = document.createElement('div')
const panelContainer = document.createElement('div')
const debugContainer = document.createElement('div')
app.append(gridContainer, panelContainer, debugContainer)
panelContainer.classList.add('panel')

// panelContainer's fixed internal layout: a header row (currency/production
// on the left, the settings gear inline on the right - always visible) ->
// tab strip -> active tab's content. Save controls live inside the settings
// popover (see below), reachable from the same gear icon.
const headerRow = document.createElement('div')
headerRow.className = 'panel-header-row'
const currencyHeaderContainer = document.createElement('div')
const settingsContainer = document.createElement('div')
headerRow.append(currencyHeaderContainer, settingsContainer)

const tabShellContainer = document.createElement('div')
panelContainer.append(headerRow, tabShellContainer)

const currencyHeaderHandle = createCurrencyHeader(currencyHeaderContainer)

const tabShellHandle = createTabShell(tabShellContainer, [
  { id: 'build', label: 'Build' },
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'gems', label: 'Gems' },
  { id: 'prestige', label: 'Prestige' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'stats', label: 'Stats' },
])

function render(): void {
  const canPlaceCurrent = buildType !== null && canAffordPlacement(state, buildType)
  gridHandle.update(state, lastResult, selected, canPlaceCurrent, settings.numberFormat)
  currencyHeaderHandle.update(state, lastResult, settings.numberFormat)
  panelHandle.update(state, lastResult, buildType, selected, settings.numberFormat)
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
  } else if (cell.type === 'buff') {
    // Clicking a Buff always rotates which single neighbour it targets, one
    // step clockwise per click, in addition to (re)selecting it - so a Buff
    // can't use "click again to deselect" (that click is already spoken
    // for). Right-click / click off the grid still deselect it.
    rotateBuffFacing(state, x, y)
    selected = { x, y }
    buildType = null // inspecting a cell exits placement mode - can't have both armed at once
  } else if (selected && selected.x === x && selected.y === y) {
    selected = null // click the already-selected cell again to deselect it
  } else {
    selected = { x, y }
    buildType = null // inspecting a cell exits placement mode - can't have both armed at once
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

// Swaps in a fully-formed GameState (fresh or loaded) and rebuilds whatever
// UI depends on its dimensions. The one place that "starts" or "replaces"
// the game. Also the one place that keeps highestValue/highestBuffLevel and
// unlockedAchievements self-consistent with the board it's handed - cheap
// for a fresh board, and what makes a migrated save's backfilled '0's heal
// immediately instead of sitting wrong until the next board change.
function useGameState(newState: GameState): void {
  state = newState
  buildType = null
  selected = null
  lastResult = recalculate(state)
  updateHighestValues(state, lastResult)
  checkAchievements(state)

  gridHandle = createGrid(gridContainer, state.width, state.height, handleCellClick) // clears/rebuilds gridContainer itself
  render()
}

// (Re)starts a fresh game at the given board size. Used when no save exists,
// and by the debug grid-size selector (which always discards whatever was on
// the board - there's no way to resize-and-keep a layout).
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
function applyOfflineCatchUp(loaded: GameState): GameState {
  const ticks = computeOfflineTicks(loaded.lastSaved)
  if (ticks > 0) {
    const result = applyOfflineProgress(loaded, ticks)
    if (result.currencyGained.gt(0)) {
      showOfflineBanner(`Welcome back! Earned ${format(result.currencyGained, settings.numberFormat)} while away (${ticks} ticks).`)
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
)
createPlaceholderPanel(tabShellHandle.contentContainer('prestige'), 'Prestige')
const statsPanelHandle = createStatsPanel(tabShellHandle.contentContainer('stats'))
const achievementsPanelHandle = createAchievementsPanel(tabShellHandle.contentContainer('achievements'))
createPlaceholderPanel(tabShellHandle.contentContainer('gems'), 'Gems')
createPlaceholderPanel(tabShellHandle.contentContainer('upgrades'), 'Upgrades')

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
const savePanelHandle = createSavePanel(saveContainer, (imported) => {
  useGameState(applyOfflineCatchUp(imported))
})

// About (inspired-by credit, author, version) at the very bottom of the popover.
const aboutContainer = document.createElement('div')
settingsPanelHandle.contentContainer.appendChild(aboutContainer)
createAboutSection(aboutContainer)

// Try to resume a save; only start fresh if there isn't one. The debug
// panel's initial grid-size value should reflect whichever board actually
// loads, so it's created after we know that.
const loadedAtStartup = loadFromLocalStorage()
const startingSize = loadedAtStartup ? loadedAtStartup.width : GRID_W

createDebugPanel(
  debugContainer,
  tickSpeedMultiplier,
  startingSize,
  (multiplier) => {
    tickSpeedMultiplier = multiplier
  },
  (size) => {
    initGame(size, size)
  },
)

if (loadedAtStartup) {
  useGameState(applyOfflineCatchUp(loadedAtStartup))
} else {
  initGame(GRID_W, GRID_H)
}

// Right-click anywhere in the app (except the debug panel's own form
// controls, which should keep their normal browser context menu) deselects
// the armed build type and the inspected cell instead of opening a menu.
app.addEventListener('contextmenu', (e) => {
  const target = e.target
  if (target instanceof Element && target.closest('.debug-panel')) return
  e.preventDefault()
  deselectAll()
})

// Clicking anywhere outside the grid, the side panel, and the debug panel
// deselects too. (Clicks on the grid are handled by their own listener
// above, which sets buildType/selected deliberately - don't fight it. The
// *entire* side panel is excluded, not just the build buttons: it now holds
// a lot of legitimate controls - Upgrade, tabs, Stats, Save, Settings - and
// none of them should accidentally wipe the current selection just because
// they aren't the grid. That's what caused clicking Upgrade to immediately
// deselect the cell it had just acted on. The debug panel is its own tool,
// not a "click away" either.)
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
    return el.classList.contains('grid') || el.classList.contains('panel') || el.classList.contains('debug-panel')
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
// tickSpeedMultiplier scales the tick length for testing (debug panel only).
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

  const effectiveTickMs = TICK_MS * tickSpeedMultiplier
  let iterations = 0
  while (acc >= effectiveTickMs && iterations < MAX_CATCHUP_TICKS) {
    acc -= effectiveTickMs
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
