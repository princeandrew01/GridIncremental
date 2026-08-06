import type { GameState, TickResult } from '../game/types'
import { cellIndex } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import {
  placementCost,
  canAffordPlacement,
  isBuildable,
  upgradeCost,
  canUpgrade,
  isMaxLevel,
  removeRefund,
  currencyFor,
  countOfType,
  canEvolve,
  evolutionConversionCost,
  evolutionSlotCap,
} from '../game/economy'
import type { PlaceableType, EvolutionType } from '../game/economy'
import { MAX_LEVEL, LEECH_RANGE_LABEL, BUFF_PCT_PER_LEVEL, CRIT_TOWER_CHANCE_BONUS, CRIT_TOWER_AMOUNT_MULT, STEADY_TOWER_MULT, BASIC_MULT } from '../game/config'
import { critChanceFor, critAmountFor } from '../game/upgrades'
import { powerCoreGeneratorPeriod, facingTargetIndex, resolveBuffMultipliers, resolveEffectiveBuffMultipliers } from '../game/engine'
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

// One-line explanation shown at the top of a selected cell's detail view
// (and as a build-button tooltip, once discovered - see "???" handling
// below) - so the mechanics behind each type aren't only discoverable by
// reading raw numbers.
const TYPE_DESCRIPTION: Record<string, string> = {
  basic:
    "Produces energy every tick. This cell's own level (up to 10) and any Buff facing it are both private multipliers on its own output - and a nearby Leech steals a share of that FULL realized output, level/Buff included, not just the account-wide raw value. Maxed, it can evolve into a Crit Tower or a Basic Steady Tower.",
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
    'Produces exactly 1 power core on a delay instead of every tick - faster at higher levels. A Buff facing it boosts its output like any other producer.',
}

const EVOLUTION_LABEL: Record<EvolutionType, string> = {
  basicCrit: 'Crit Tower',
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
    showBuildDescriptions: boolean,
  ): void
}

function buildButtonGroup(
  container: HTMLElement,
  label: string,
  types: PlaceableType[],
  onSelectBuildType: (type: PlaceableType) => void,
  buttonByType: Map<PlaceableType, HTMLButtonElement>,
  nameByType: Map<PlaceableType, HTMLSpanElement>,
  descByType: Map<PlaceableType, HTMLSpanElement>,
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

    const info = document.createElement('span')
    info.className = 'build-info'
    const name = document.createElement('span')
    name.className = 'build-name'
    const desc = document.createElement('span')
    desc.className = 'build-desc'
    info.append(name, desc)

    const cost = document.createElement('span')
    cost.className = 'build-cost'

    btn.append(swatch, info, cost)
    buttons.appendChild(btn)
    buttonByType.set(type, btn)
    nameByType.set(type, name)
    descByType.set(type, desc)
    costByType.set(type, cost)
  }

  container.append(groupHeading, buttons)
}

/**
 * The Build tab. Shows one of two mutually-exclusive views, never both at
 * once: the build-buttons picker when nothing's selected, or the selected
 * cell's detail/Upgrade/Remove/Evolve UI when something is. They used to
 * stack (build buttons always visible, detail block appended below), which
 * pushed the tab's content well past the grid's own height and looked
 * unfinished; a separate panel elsewhere was tried next, but that broke the
 * flow - eyes had to jump away from where the build buttons already were.
 * Swapping in place keeps everything in the one spot the player's already
 * looking at.
 */
export function createPanel(
  container: HTMLElement,
  onSelectBuildType: (type: PlaceableType) => void,
  onUpgrade: () => void,
  onRemove: () => void,
  onEvolve: (evolutionType: EvolutionType) => void,
): PanelHandle {
  container.innerHTML = ''
  container.classList.add('build-tab')

  const buildSection = document.createElement('div')
  buildSection.className = 'panel-section'
  const buildHeading = document.createElement('h2')
  buildHeading.textContent = 'Build'

  const buttonByType = new Map<PlaceableType, HTMLButtonElement>()
  const nameByType = new Map<PlaceableType, HTMLSpanElement>()
  const descByType = new Map<PlaceableType, HTMLSpanElement>()
  const costByType = new Map<PlaceableType, HTMLSpanElement>()
  buildSection.appendChild(buildHeading)
  buildButtonGroup(buildSection, 'Generators', GENERATOR_TYPES, onSelectBuildType, buttonByType, nameByType, descByType, costByType)
  buildButtonGroup(buildSection, 'Buffers', BUFFER_TYPES, onSelectBuildType, buttonByType, nameByType, descByType, costByType)

  const hint = document.createElement('p')
  hint.className = 'panel-hint'
  hint.textContent =
    'Click an empty cell to place the selected type. Click a filled cell to inspect it, or click it again to deselect - ' +
    'click a Buff or Buff Stacker again to rotate what it targets instead. ' +
    'Right-click, or click anywhere off the grid, deselects both the build type and the inspected cell.'

  const detailSection = document.createElement('div')
  detailSection.className = 'panel-section'
  detailSection.hidden = true
  const detailName = document.createElement('h2')
  const detailDesc = document.createElement('p')
  detailDesc.className = 'panel-type-desc'

  const detailActions = document.createElement('div')
  detailActions.className = 'detail-actions'
  const upgradeButton = document.createElement('button')
  upgradeButton.type = 'button'
  upgradeButton.className = 'upgrade-button'
  upgradeButton.addEventListener('click', onUpgrade)
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

  detailSection.append(detailName, detailDesc, detailActions, evolveSection, statsHeading, detailBody)

  container.append(buildSection, hint, detailSection)

  function update(
    state: GameState,
    displayNoCrit: TickResult,
    displayWithCrit: TickResult,
    buildType: PlaceableType | null,
    selected: GridSelection | null,
    formatMode: NumberFormatMode,
    showBuildDescriptions: boolean,
  ): void {
    // Selecting a cell replaces the build picker entirely rather than
    // stacking below it - see the function-level comment above.
    const showingDetail = selected !== null && state.cells[cellIndex(selected.x, selected.y, state.width)].type !== 'empty'
    buildSection.hidden = showingDetail
    hint.hidden = showingDetail
    detailSection.hidden = !showingDetail

    if (!showingDetail) {
      for (const [type, btn] of buttonByType) {
        const buildable = isBuildable(state, type)
        btn.hidden = type === 'powerCoreGenerator' && !buildable
        const discovered = !!state.discoveredTypes[type]
        const cost = type === 'powerCoreGenerator' ? null : placementCost(state, type)
        const affordable = canAffordPlacement(state, type)
        nameByType.get(type)!.textContent = discovered ? TYPE_LABEL[type] : '???'
        // The description is either shown inline (the row) or, if the user
        // turned that off in Settings ("super long" per their own words),
        // moved into the hover tooltip instead - never fully lost, just
        // relocated. Undiscovered types show neither, in either mode.
        const showInline = discovered && showBuildDescriptions
        const descEl = descByType.get(type)!
        descEl.textContent = showInline ? TYPE_DESCRIPTION[type] : ''
        descEl.hidden = !showInline
        costByType.get(type)!.textContent = type === 'powerCoreGenerator' ? 'Free' : format(cost!, formatMode)
        btn.classList.toggle('build-button-active', type === buildType)
        btn.disabled = !affordable
        if (!discovered) {
          btn.title = 'Discovered once you can afford one.'
        } else {
          const currencyLabel = currencyFor(type) === 'powerCores' ? 'power cores' : 'energy'
          const affordNote = affordable ? '' : `Not enough ${currencyLabel}`
          btn.title = showBuildDescriptions ? affordNote : [TYPE_DESCRIPTION[type], affordNote].filter(Boolean).join(' - ')
        }
      }
      return
    }

    // selected is non-null and non-empty here (showingDetail guarantees both).
    const i = cellIndex(selected!.x, selected!.y, state.width)
    const cell = state.cells[i]
    if (cell.type === 'empty') return
    const level = cell.level
    const maxed = isMaxLevel(cell.type, level)

    detailName.textContent = TYPE_LABEL[cell.type]
    detailDesc.textContent = TYPE_DESCRIPTION[cell.type]

    const rows: string[] = [`<div>Level: ${level} / ${MAX_LEVEL[cell.type]}</div>`]
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
      rows.push(`<div>Crit chance: ${(chance * 100).toFixed(1)}%${isCritTower ? ` (includes +${CRIT_TOWER_CHANCE_BONUS * 100}pp Crit Tower bonus)` : ''}</div>`)
      rows.push(`<div>Crit amount: ${amount.toFixed(2)}x${isCritTower ? ` (includes x${CRIT_TOWER_AMOUNT_MULT} Crit Tower bonus)` : ''}</div>`)
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
      // instead of a per-tick rate.
      const period = powerCoreGeneratorPeriod(level)
      const ticksLeft = period - cell.coreProgress
      rows.push(`<div>Ticks until next core: ${ticksLeft} / ${period}</div>`)
      rows.push(`<div>Cores per proc: 1${buffMult !== 1 ? ` × ${buffMult.toFixed(3)} (Buff) = ${buffMult.toFixed(3)}` : ''}</div>`)
      if (!maxed) {
        const nextPeriod = powerCoreGeneratorPeriod(level + 1)
        nextLevelText = `Next level: ${period} ticks/core → ${nextPeriod} ticks/core`
      }
    }

    const previewRow = nextLevelText ? `<div class="panel-next-level">${nextLevelText}</div>` : ''
    detailBody.innerHTML = rows.join('') + previewRow

    if (MAX_LEVEL[cell.type] === 0) {
      // The 4 evolved types never level further (deferred to a future
      // prestige system) - the Upgrade button reflects that instead of
      // showing a cost that can never be paid.
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Evolved - no further leveling'
    } else if (maxed) {
      upgradeButton.disabled = true
      upgradeButton.textContent = 'Max level'
    } else {
      const cost = upgradeCost(cell.type as PlaceableType, level)
      upgradeButton.disabled = !canUpgrade(state, selected!.x, selected!.y)
      upgradeButton.textContent = `Upgrade (${format(cost, formatMode)})`
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
          btn.textContent = `Evolve into ${EVOLUTION_LABEL[evolutionType]} (${format(cost, formatMode)} power cores, ${count} / ${cap} used)`
        }
      }
    }
  }

  return { update }
}
