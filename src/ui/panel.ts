import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import {
  placementCost,
  canAffordPlacement,
  isBuildable,
  isMaxLevel,
  removeRefund,
  countOfType,
  canEvolve,
  evolutionConversionCost,
  evolutionSlotCap,
  currencyFor,
  cellBulkUpgradeCost,
  cellMaxAffordableUpgradeCount,
} from '../game/economy'
import type { PlaceableType, EvolutionType } from '../game/economy'
import { MAX_LEVEL, LEECH_RANGE_LABEL, BUFF_PCT_PER_LEVEL, CRIT_TOWER_CHANCE_BONUS, CRIT_TOWER_AMOUNT_MULT, STEADY_TOWER_MULT, BASIC_MULT } from '../game/config'
import { critChanceFor, critAmountFor, powerCoreGeneratorCap } from '../game/upgrades'
import { powerCoreGeneratorPeriod, powerCoreGeneratorAmount, facingTargetIndex, resolveBuffMultipliers, resolveEffectiveBuffMultipliers } from '../game/engine'
import type { GridSelection } from './grid'
import { TYPE_LABEL } from './grid'

// Generators produce currency directly; Buffers boost a producer's own
// output and produce none themselves. Visual grouping only for now (see the
// Build tab's two labelled rows below) - not yet a first-class concept
// elsewhere. The 4 evolved types (basicCrit/basicSteady/buffStacker/
// buffAll) never appear here - they're never placed empty-handed, only
// reached by evolving a maxed Basic/Buff (see the Evolve section below).
const GENERATOR_TYPES: PlaceableType[] = ['basic', 'leech', 'powerCoreGenerator']
const BUFFER_TYPES: PlaceableType[] = ['buff']

const FACING_LABEL: Record<string, string> = {
  up: 'Up',
  right: 'Right',
  down: 'Down',
  left: 'Left',
}

// Same icons as the resources header (see ui/currencyHeader.ts) - shown
// next to a cost so which currency it's denominated in is obvious at a
// glance, since leveling a placed cell isn't always Energy (the Power Core
// Generator's own level-up cost is Power Cores, everything else is Energy -
// easy to lose track of without a visual cue, per the user).
const RESOURCE_ICON: Record<'energy' | 'powerCores', string> = { energy: '⚡', powerCores: '🔵' }

// One-line explanation shown at the top of a selected cell's detail view
// (and as a build-button tooltip, once discovered - see "???" handling
// below) - so the mechanics behind each type aren't only discoverable by
// reading raw numbers.
export const TYPE_DESCRIPTION: Record<string, string> = {
  basic:
    "Produces energy every tick. This cell's own level (up to 10) and any Buff facing it are both private multipliers on its own output - and a nearby Leech steals a share of that FULL realized output, level/Buff included, not just the account-wide raw value. Maxed, it can evolve into a Crit Generator or a Basic Steady Tower.",
  leech:
    "Produces no energy or power cores of its own - instead steals a share of every nearby non-Leech cell's actual output (energy and power cores both - crit, level/evolution multiplier, and any Buff on that cell all included). Range grows with level, up to the whole board.",
  buff:
    "Boosts the one cell it faces - that cell's own final output. A nearby Leech steals a share of that boosted output too (it reads a cell's actual output, not some pre-Buff number). Level raises the %, up to 100%. Maxed, it can evolve into a Buff Stacker or a Buff All.",
  buffStacker:
    'Evolved from a maxed Buff. Pointed at an ordinary producer, boosts it like a normal Buff. Pointed at another Buff or Buff All instead, it multiplies THAT cell\'s own effective boost - chains to any depth.',
  buffAll:
    "Evolved from a maxed Buff. Boosts every cell on the board at once by its own %, no facing needed - a nearby Leech steals a share of everyone's now-boosted output too. Can itself be targeted by a Buff Stacker for an even bigger board-wide effect.",
  basicCrit:
    'Evolved from a maxed Basic. Adds +30 percentage points to crit chance and multiplies crit amount by x100, both private to this cell. No further leveling (for now).',
  basicSteady:
    "Evolved from a maxed Basic. Multiplies this cell's own output by a flat x10 on top of its level multiplier. No further leveling (for now).",
  powerCoreGenerator:
    'Produces power cores on a delay instead of every tick - both how often it procs and how many cores each proc is worth scale with level (1 core / 10 ticks at level 0, up to 10 cores / 1 tick maxed). A Buff facing it boosts its output like any other producer.',
}

const EVOLUTION_LABEL: Record<EvolutionType, string> = {
  basicCrit: 'Crit Generator',
  basicSteady: 'Basic Steady Tower',
  buffStacker: 'Buff Stacker',
  buffAll: 'Buff All',
}

// Which evolutions a maxed cell of this source type can choose between.
const EVOLUTION_OPTIONS: Record<'basic' | 'buff', EvolutionType[]> = {
  basic: ['basicCrit', 'basicSteady'],
  buff: ['buffStacker', 'buffAll'],
}

export interface PanelHandle {
  // No live per-tick TickResult here on purpose - every number this panel
  // shows is sourced from displayNoCrit/displayWithCrit (stable, recomputed
  // fresh each render, never a live crit/proc roll) so nothing in the
  // detail view visibly bounces around while a cell's selected. See
  // main.ts render() for how those two are built.
  update(
    state: GameState,
    displayNoCrit: TickResult,
    displayWithCrit: TickResult,
    buildType: PlaceableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
  ): void
}

function buildButtonGroup(
  container: HTMLElement,
  label: string,
  types: PlaceableType[],
  onSelectBuildType: (type: PlaceableType) => void,
  buttonByType: Map<PlaceableType, HTMLButtonElement>,
  nameByType: Map<PlaceableType, HTMLSpanElement>,
  costByType: Map<PlaceableType, HTMLSpanElement>,
): void {
  const groupHeading = document.createElement('h3')
  groupHeading.className = 'build-group-heading'
  groupHeading.textContent = label
  // One row per type, same list shape as the Upgrades tab (.upgrade-row) -
  // replaces the old flex-wrap grid of standalone card buttons.
  const buttons = document.createElement('div')
  buttons.className = 'build-buttons'

  for (const type of types) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'build-button'
    btn.addEventListener('click', () => onSelectBuildType(type))

    // Colour swatch reusing the same cell-<type> background class the grid
    // itself uses, so the build picker still visually matches the board -
    // lost when the old letter-glyph icon box was dropped in favour of the
    // actual name text; restored here as a plain swatch, no glyph.
    const swatch = document.createElement('span')
    swatch.className = `build-swatch cell-${type}`
    swatch.setAttribute('aria-hidden', 'true')

    const name = document.createElement('span')
    name.className = 'build-name'

    const cost = document.createElement('span')
    cost.className = 'build-cost'

    btn.append(swatch, name, cost)
    buttons.appendChild(btn)
    buttonByType.set(type, btn)
    nameByType.set(type, name)
    costByType.set(type, cost)
  }

  container.append(groupHeading, buttons)
}

/**
 * The Build tab (always the picker, nothing else) plus the selected cell's
 * own detail/Upgrade/Remove/Evolve UI, which lives in its OWN rail tab now -
 * main.ts adds/shows a dedicated "selected cell" icon on the rail the
 * moment something's selected (see tabShellHandle.setTabIcon/setTabHidden),
 * and this renders into that tab's own content area, not the Build tab's.
 *
 * This is the THIRD layout for this view in one session: it started as
 * in-place swapping over the Build picker (confusing - "reads as if a
 * completely different tab had opened"), became a small centered modal
 * (which then broke rotating a Buff's facing - the modal's full-viewport
 * backdrop, even fully transparent, still intercepted the SECOND click on
 * the grid cell meant to rotate it, before it could ever reach the cell),
 * and is now its own rail tab - the user's own proposal, and simpler than
 * either of the first two: no overlay, no backdrop-click wiring, no
 * z-index/click-interception concerns, and the Build picker never has to
 * hide for it either.
 */
export function createPanel(
  buildContainer: HTMLElement,
  detailContainer: HTMLElement,
  onSelectBuildType: (type: PlaceableType) => void,
  onUpgrade: (count: number) => void,
  onRemove: () => void,
  onEvolve: (evolutionType: EvolutionType) => void,
): PanelHandle {
  buildContainer.innerHTML = ''
  buildContainer.classList.add('build-tab')
  detailContainer.innerHTML = ''
  detailContainer.classList.add('panel-section')

  const buildSection = document.createElement('div')
  buildSection.className = 'panel-section'
  const buildHeading = document.createElement('h2')
  buildHeading.textContent = 'Build'

  const buttonByType = new Map<PlaceableType, HTMLButtonElement>()
  const nameByType = new Map<PlaceableType, HTMLSpanElement>()
  const costByType = new Map<PlaceableType, HTMLSpanElement>()
  buildSection.appendChild(buildHeading)
  buildButtonGroup(buildSection, 'Generators', GENERATOR_TYPES, onSelectBuildType, buttonByType, nameByType, costByType)
  buildButtonGroup(buildSection, 'Buffers', BUFFER_TYPES, onSelectBuildType, buttonByType, nameByType, costByType)

  // The "how to use this" hint used to live here as a paragraph under the
  // build buttons - moved into the Help menu (see helpPanel.ts's Controls
  // section) along with every other piece of instructional text in the game.
  buildContainer.append(buildSection)

  const detailName = document.createElement('h2')

  // update()'s own args, cached so the bulk-quantity toolbar below can
  // re-render immediately on click instead of waiting for the next
  // ~16ms animation-frame tick (main.ts's render() loop would pick the
  // change up on its own regardless, this is just snappier - same pattern
  // upgradesPanel.ts/powerCoreUpgradesPanel.ts already use for their own
  // toolbars).
  let latestUpdateArgs: Parameters<typeof update> | null = null

  // Bulk-quantity toolbar for the Upgrade button (1x/5x/10x/Max) - a much
  // smaller quantity set than the Upgrades/Power Cores tabs' own toolbar
  // (1x/10x/25x/Max), since a single cell's level range tops out at 10, not
  // in the hundreds of thousands. Hidden whenever the Upgrade button itself
  // has nothing to buy (evolved/maxed - see update() below).
  type UpgradeBuyCount = 1 | 5 | 10 | 'max'
  const UPGRADE_BUY_COUNTS: UpgradeBuyCount[] = [1, 5, 10, 'max']
  let selectedUpgradeCount: UpgradeBuyCount = 1
  const upgradeToolbar = document.createElement('div')
  upgradeToolbar.className = 'upgrade-toolbar cell-upgrade-toolbar'
  const upgradeToolbarButtons = new Map<UpgradeBuyCount, HTMLButtonElement>()
  for (const count of UPGRADE_BUY_COUNTS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'upgrade-toolbar-button'
    btn.textContent = count === 'max' ? 'Max' : `x${count}`
    btn.addEventListener('click', () => {
      selectedUpgradeCount = count
      for (const [c, b] of upgradeToolbarButtons) b.classList.toggle('upgrade-toolbar-button-active', c === count)
      if (latestUpdateArgs) update(...latestUpdateArgs)
    })
    upgradeToolbar.appendChild(btn)
    upgradeToolbarButtons.set(count, btn)
  }
  upgradeToolbarButtons.get(1)!.classList.add('upgrade-toolbar-button-active')

  /** How many levels an Upgrade click would actually buy right now, given the toolbar's selected quantity - mirrors upgradesPanel.ts's resolveBuyCount. Shared by the display (update) and the click handler below, so they can never disagree. */
  function resolveUpgradeCount(state: GameState, x: number, y: number): number {
    const cell = state.cells[cellIndex(x, y, state.width)]
    if (cell.type === 'empty') return 0
    const max = MAX_LEVEL[cell.type]
    if (cell.level >= max) return 0
    if (selectedUpgradeCount === 'max') return cellMaxAffordableUpgradeCount(state, x, y)
    return Math.min(selectedUpgradeCount, max - cell.level)
  }

  const detailActions = document.createElement('div')
  detailActions.className = 'detail-actions'
  const upgradeButton = document.createElement('button')
  upgradeButton.type = 'button'
  upgradeButton.className = 'upgrade-button'
  upgradeButton.addEventListener('click', () => {
    if (!latestUpdateArgs) return
    const [state, , , , selected] = latestUpdateArgs
    if (!selected) return
    const count = resolveUpgradeCount(state, selected.x, selected.y)
    if (count > 0) onUpgrade(count)
  })
  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.className = 'remove-button'
  removeButton.addEventListener('click', onRemove)
  detailActions.append(upgradeButton, removeButton)

  const evolveSection = document.createElement('div')
  evolveSection.className = 'evolve-section'
  evolveSection.hidden = true
  const evolveHeading = document.createElement('h3')
  evolveHeading.textContent = 'Evolve'
  const evolveButtons = document.createElement('div')
  evolveButtons.className = 'evolve-buttons'
  evolveSection.append(evolveHeading, evolveButtons)
  const evolveButtonByType = new Map<EvolutionType, HTMLButtonElement>()
  for (const evolutionType of ['basicCrit', 'basicSteady', 'buffStacker', 'buffAll'] as EvolutionType[]) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'evolve-button'
    btn.addEventListener('click', () => onEvolve(evolutionType))
    evolveButtons.appendChild(btn)
    evolveButtonByType.set(evolutionType, btn)
  }

  const statsHeading = document.createElement('h3')
  statsHeading.className = 'panel-stats-heading'
  statsHeading.textContent = 'Stats'
  const detailBody = document.createElement('div')
  detailBody.className = 'panel-detail'

  detailContainer.append(detailName, upgradeToolbar, detailActions, evolveSection, statsHeading, detailBody)

  function update(
    state: GameState,
    displayNoCrit: TickResult,
    displayWithCrit: TickResult,
    buildType: PlaceableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
  ): void {
    latestUpdateArgs = [state, displayNoCrit, displayWithCrit, buildType, selected, formatMode]
    // The build picker is always visible now (its own rail tab); the
    // selected cell's own detail lives in a separate rail tab entirely -
    // see the function-level comment above. showingDetail just guards
    // whether there's anything valid to render into detailContainer this
    // call; main.ts owns whether that tab is actually visible/active.
    const showingDetail = selected !== null && state.cells[cellIndex(selected.x, selected.y, state.width)].type !== 'empty'

    for (const [type, btn] of buttonByType) {
      const nameEl = nameByType.get(type)!
      const costEl = costByType.get(type)!
      btn.classList.toggle('build-button-active', type === buildType)

      // The Power Core Generator is never hidden from the list, even when
      // it currently can't be placed - it stays visible with "Locked" (no
      // Power Generator Count level bought at all yet - name stays hidden,
      // matching the Power Cores tab's own "Locked" slot-upgrade treatment)
      // or "Max" (a level IS bought, but every generator it currently
      // allows is already on the board - buying another Power Generator
      // Count level raises the cap again).
      if (type === 'powerCoreGenerator' && powerCoreGeneratorCap(state) === 0) {
        nameEl.textContent = 'Locked'
        costEl.textContent = ''
        btn.disabled = true
        btn.title = 'Buy a level of Power Generator Count in the Upgrades tab to unlock this.'
        continue
      }
      if (type === 'powerCoreGenerator' && !isBuildable(state, type)) {
        const discovered = !!state.discoveredTypes[type]
        nameEl.textContent = discovered ? TYPE_LABEL[type] : '???'
        costEl.textContent = 'Max'
        btn.disabled = true
        btn.title = discovered
          ? 'At your current Power Generator Count cap - buy another level in the Upgrades tab to allow more.'
          : 'Discovered once you can afford one.'
        continue
      }

      const discovered = !!state.discoveredTypes[type]
      // Placement is always Energy-priced now, every PlaceableType alike
      // (including the Power Core Generator, which used to be free here -
      // reverted per the user).
      const cost = placementCost(state, type)
      const affordable = canAffordPlacement(state, type)
      nameEl.textContent = discovered ? TYPE_LABEL[type] : '???'
      costEl.textContent = format(cost, formatMode)
      btn.disabled = !affordable
      if (!discovered) {
        btn.title = 'Discovered once you can afford one.'
      } else {
        btn.title = affordable ? '' : 'Not enough energy'
      }
    }

    if (!showingDetail) return

    // selected is non-null and non-empty here (showingDetail guarantees both).
    const i = cellIndex(selected!.x, selected!.y, state.width)
    const cell = state.cells[i]
    if (cell.type === 'empty') return
    const level = cell.level
    const maxed = isMaxLevel(cell.type, level)

    detailName.textContent = TYPE_LABEL[cell.type]

    // Evolved types (MAX_LEVEL 0) inherit whatever level their source cell
    // had when they evolved (always that source type's own max - see
    // economy.ts evolveCell) but never level any further themselves, so
    // "Level: 9 / 0" read as broken rather than as "maxed". Show a plain
    // "Max level reached" line instead for those.
    const levelText = MAX_LEVEL[cell.type] === 0 ? 'Level: Max level reached (evolved)' : `Level: ${level} / ${MAX_LEVEL[cell.type]}`
    const rows: string[] = [`<div>${levelText}</div>`]
    let nextLevelText = ''
    const buffMultipliers = resolveBuffMultipliers(state)
    const buffMult = buffMultipliers[i]

    if (cell.type === 'basic' || cell.type === 'basicCrit' || cell.type === 'basicSteady') {
      const isCritTower = cell.type === 'basicCrit'
      const ownMult = cell.type === 'basicSteady' ? BASIC_MULT[level] * STEADY_TOWER_MULT : BASIC_MULT[level]
      rows.push(`<div>Base (no crit): ${format(displayNoCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (no crit): ${format(displayNoCrit.final[i], formatMode)}</div>`)
      const chance = critChanceFor(state, isCritTower)
      const amount = critAmountFor(state, isCritTower)
      rows.push(`<div>Crit chance: ${(chance * 100).toFixed(1)}%${isCritTower ? ` (includes +${CRIT_TOWER_CHANCE_BONUS * 100}pp Crit Generator bonus)` : ''}</div>`)
      rows.push(`<div>Crit amount: ${amount.toFixed(2)}x${isCritTower ? ` (includes x${CRIT_TOWER_AMOUNT_MULT} Crit Generator bonus)` : ''}</div>`)
      rows.push(`<div>Base (with crit, expected): ${format(displayWithCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (with crit, expected): ${format(displayWithCrit.final[i], formatMode)}</div>`)
      rows.push(`<div>Own output multiplier: ${ownMult.toLocaleString()}x${cell.type === 'basicSteady' ? ` (${BASIC_MULT[level]}x level × ${STEADY_TOWER_MULT}x Basic Steady)` : ' (level only - a nearby Leech steals a share of the output this produces too)'}</div>`)
      if (buffMult !== 1) rows.push(`<div>Buff multiplier currently applied: ${buffMult.toFixed(3)}x</div>`)
      if (!maxed) {
        nextLevelText = `Next level: output multiplier ${ownMult.toLocaleString()}x → ${BASIC_MULT[level + 1].toLocaleString()}x (crit chance/amount unaffected by level)`
      }
    } else if (cell.type === 'leech') {
      rows.push(`<div>Range: ${LEECH_RANGE_LABEL[level]}</div>`)
      rows.push(`<div>Base (no crit): ${format(displayNoCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (no crit): ${format(displayNoCrit.final[i], formatMode)}</div>`)
      rows.push(`<div>Base (with crit, expected): ${format(displayWithCrit.base[i], formatMode)}</div>`)
      rows.push(`<div>Value (with crit, expected): ${format(displayWithCrit.final[i], formatMode)}</div>`)
      if (buffMult !== 1) rows.push(`<div>Buff multiplier currently applied: ${buffMult.toFixed(3)}x</div>`)
      if (!maxed) {
        nextLevelText = `Next level: range ${LEECH_RANGE_LABEL[level]} → ${LEECH_RANGE_LABEL[level + 1]}`
      }
    } else if (cell.type === 'buff' || cell.type === 'buffStacker') {
      const pct = BUFF_PCT_PER_LEVEL[level]
      const targetIdx = facingTargetIndex(selected!.x, selected!.y, cell.facing, state.width, state.height)
      const targetCell = targetIdx !== null ? state.cells[targetIdx] : null
      const targetIsBuffType = !!targetCell && (targetCell.type === 'buff' || targetCell.type === 'buffStacker' || targetCell.type === 'buffAll')
      const effective = resolveEffectiveBuffMultipliers(state)
      rows.push(`<div>Facing: ${FACING_LABEL[cell.facing]}</div>`)
      rows.push(`<div>Own boost: +${(pct * 100).toFixed(0)}%</div>`)
      if (cell.type === 'buffStacker' && targetIsBuffType) {
        const targetEffective = effective.get(targetIdx!)
        rows.push(`<div>Target: ${TYPE_LABEL[targetCell!.type]} - multiplying its own effective boost${targetEffective !== undefined ? ` (currently ×${targetEffective.toFixed(3)})` : ''}</div>`)
      } else if (targetCell && targetCell.type !== 'empty' && !targetIsBuffType) {
        rows.push(`<div>Target: ${TYPE_LABEL[targetCell.type]} - boosting its own final output by +${(pct * 100).toFixed(0)}%</div>`)
      } else if (targetCell && targetIsBuffType) {
        rows.push(`<div>Target: ${TYPE_LABEL[targetCell.type]} - a plain Buff can't boost another buff-type cell (only a Buff Stacker can); this is doing nothing right now.</div>`)
      } else {
        rows.push(`<div>Target: nothing there - this is doing nothing right now.</div>`)
      }
      rows.push(`<div>Note: boosts the target's own final output - a nearby Leech steals a share of that boosted output too.</div>`)
      if (!maxed) {
        const nextPct = BUFF_PCT_PER_LEVEL[level + 1]
        nextLevelText = `Next level: boost ${(pct * 100).toFixed(0)}% → ${(nextPct * 100).toFixed(0)}%`
      }
    } else if (cell.type === 'buffAll') {
      const pct = BUFF_PCT_PER_LEVEL[level]
      const effective = resolveEffectiveBuffMultipliers(state)
      const own = effective.get(i)
      rows.push(`<div>Own boost: +${(pct * 100).toFixed(0)}%, applied to every cell on the board</div>`)
      if (own !== undefined) rows.push(`<div>Currently applying: ×${own.toFixed(3)} (boosted further if a Buff Stacker targets this)</div>`)
      rows.push(`<div>Note: boosts every cell's own final output - a nearby Leech steals a share of everyone's now-boosted output too.</div>`)
    } else {
      // powerCoreGenerator - production is discrete (a proc every `period`
      // ticks, not a per-tick trickle), so the detail shows ticks-until-next
      // instead of a per-tick rate. Both period and amount scale with level.
      const period = powerCoreGeneratorPeriod(level)
      const amount = powerCoreGeneratorAmount(level)
      const ticksLeft = period - cell.coreProgress
      rows.push(`<div>Ticks until next core: ${ticksLeft} / ${period}</div>`)
      rows.push(`<div>Cores per proc: ${amount}${buffMult !== 1 ? ` × ${buffMult.toFixed(3)} (Buff) = ${(amount * buffMult).toFixed(3)}` : ''}</div>`)
      if (!maxed) {
        const nextPeriod = powerCoreGeneratorPeriod(level + 1)
        const nextAmount = powerCoreGeneratorAmount(level + 1)
        nextLevelText = `Next level: ${amount} core${amount === 1 ? '' : 's'} / ${period} ticks → ${nextAmount} core${nextAmount === 1 ? '' : 's'} / ${nextPeriod} ticks`
      }
    }

    const previewRow = nextLevelText ? `<div class="panel-next-level">${nextLevelText}</div>` : ''
    detailBody.innerHTML = rows.join('') + previewRow

    if (MAX_LEVEL[cell.type] === 0) {
      // The 4 evolved types never level further (deferred to a future
      // prestige system) - the Upgrade button reflects that instead of
      // showing a cost that can never be paid.
      upgradeToolbar.hidden = true
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Evolved - no further leveling'
    } else if (maxed) {
      upgradeToolbar.hidden = true
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Max level'
    } else {
      upgradeToolbar.hidden = false
      const icon = RESOURCE_ICON[currencyFor(cell.type as PlaceableType)]
      const count = resolveUpgradeCount(state, selected!.x, selected!.y)
      if (count <= 0) {
        // Only reachable in 'max' mode - a fixed quantity always resolves to
        // at least 1 level while not maxed, affordable or not.
        upgradeButton.disabled = true
        upgradeButton.textContent = 'Upgrade (not enough)'
      } else {
        const cost = cellBulkUpgradeCost(cell.type as PlaceableType, level, count)
        const balance = currencyFor(cell.type as PlaceableType) === 'energy' ? state.currency : state.powerCores
        upgradeButton.disabled = balance.lt(cost)
        upgradeButton.textContent = `Upgrade x${count} (${icon} ${format(cost, formatMode)})`
      }
    }

    // Always available regardless of level - refunds a fraction of what was
    // actually paid to place this cell, not what's been spent upgrading it
    // or evolving it (see economy.ts removeRefund/Cell.placementCost).
    removeButton.disabled = false
    removeButton.textContent = `Remove (+${format(removeRefund(state, selected!.x, selected!.y), formatMode)})`

    // Evolve section: only a maxed Basic or Buff shows this at all.
    const evolutionOptions = cell.type === 'basic' || cell.type === 'buff' ? (maxed ? EVOLUTION_OPTIONS[cell.type] : []) : []
    evolveSection.hidden = evolutionOptions.length === 0
    if (evolutionOptions.length > 0) {
      for (const [evolutionType, btn] of evolveButtonByType) {
        const relevant = evolutionOptions.includes(evolutionType)
        btn.hidden = !relevant
        if (!relevant) continue
        const cap = evolutionSlotCap(state, evolutionType)
        const count = countOfType(state, evolutionType)
        if (cap <= 0) {
          btn.disabled = true
          btn.textContent = 'Locked (buy a slot in the Power Cores tab)'
        } else if (count >= cap) {
          btn.disabled = true
          btn.textContent = `${EVOLUTION_LABEL[evolutionType]} - slots full (${count} / ${cap})`
        } else {
          const cost = evolutionConversionCost(state, evolutionType)
          btn.disabled = !canEvolve(state, selected!.x, selected!.y, evolutionType)
          btn.textContent = `Evolve into ${EVOLUTION_LABEL[evolutionType]} (${RESOURCE_ICON.powerCores} ${format(cost, formatMode)}, ${count} / ${cap} used)`
        }
      }
    }
  }

  return { update }
}
