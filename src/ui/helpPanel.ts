import type { CellType } from '../game/types'
import { UPGRADE_IDS, UPGRADE_LABEL, UPGRADE_DESCRIPTION } from '../game/upgrades'
import { POWER_CORE_UPGRADE_IDS, POWER_CORE_UPGRADE_LABEL, POWER_CORE_UPGRADE_DESCRIPTION } from '../game/powerCoreUpgrades'
import { TYPE_LABEL } from './grid'
import { TYPE_DESCRIPTION } from './panel'

// Every non-empty CellType, in a reading order that groups each family
// together (Basic + its 2 evolutions, Leech, Buff + its 2 evolutions, Power
// Core Generator) - not the same order the Build tab's picker uses (which
// only lists the 4 placeable types), since Help also covers the 4
// evolutions the picker never shows directly.
const ALL_CELL_TYPES: Exclude<CellType, 'empty'>[] = [
  'basic',
  'basicCrit',
  'basicSteady',
  'leech',
  'buff',
  'buffStacker',
  'buffAll',
  'powerCoreGenerator',
]

function makeTextSection(container: HTMLElement, heading: string, text: string): void {
  const section = document.createElement('section')
  section.className = 'help-section'
  const h = document.createElement('h3')
  h.textContent = heading
  const p = document.createElement('p')
  p.className = 'help-text'
  p.textContent = text
  section.append(h, p)
  container.appendChild(section)
}

function makeSection(container: HTMLElement, heading: string, rows: { name: string; description: string }[]): void {
  const section = document.createElement('section')
  section.className = 'help-section'
  const h = document.createElement('h3')
  h.textContent = heading
  section.appendChild(h)

  for (const { name, description } of rows) {
    const row = document.createElement('div')
    row.className = 'help-row'
    const nameEl = document.createElement('div')
    nameEl.className = 'help-row-name'
    nameEl.textContent = name
    const descEl = document.createElement('div')
    descEl.className = 'help-row-desc'
    descEl.textContent = description
    row.append(nameEl, descEl)
    section.appendChild(row)
  }

  container.appendChild(section)
}

/**
 * The Help overlay - a full modal (not a small anchored popover like
 * Settings/Dev Log use, since this holds a lot more text than either):
 * every generator/buffer/evolution, every Energy upgrade, and every Power
 * Core upgrade's description, all in one place. Everywhere else in the game
 * dropped its own inline description in favour of pointing here (see
 * panel.ts/upgradesPanel.ts/powerCoreUpgradesPanel.ts) - this is the single
 * source for all of it now, reusing the same description strings verbatim
 * rather than duplicating any prose.
 */
export function createHelpPanel(container: HTMLElement): void {
  container.classList.add('help-wrapper')

  const toggleButton = document.createElement('button')
  toggleButton.type = 'button'
  toggleButton.className = 'help-toggle'
  toggleButton.textContent = 'ℹ️'
  toggleButton.title = 'Help'
  toggleButton.setAttribute('aria-label', 'Help')

  const overlay = document.createElement('div')
  overlay.className = 'help-overlay'
  overlay.hidden = true

  const modal = document.createElement('div')
  modal.className = 'help-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-label', 'Help')

  const heading = document.createElement('h2')
  heading.textContent = 'Help'

  const body = document.createElement('div')
  body.className = 'help-body'

  makeTextSection(
    body,
    'Controls',
    'Click an empty cell to place the selected type. Click a filled cell to inspect it - a "Selected" icon appears at the ' +
      "bottom of the rail on the right, showing its Upgrade/Remove/Evolve controls and stats. Click a filled cell again to " +
      'deselect it - click a Buff or Buff Stacker again instead to rotate what it targets. Right-click, or click anywhere ' +
      'off the grid, deselects both the build type and the inspected cell.',
  )
  makeSection(
    body,
    'Generators & Buffers',
    ALL_CELL_TYPES.map((type) => ({ name: TYPE_LABEL[type], description: TYPE_DESCRIPTION[type] })),
  )
  makeSection(
    body,
    'Upgrades',
    UPGRADE_IDS.map((id) => ({ name: UPGRADE_LABEL[id], description: UPGRADE_DESCRIPTION[id] })),
  )
  makeSection(
    body,
    'Power Cores',
    POWER_CORE_UPGRADE_IDS.map((id) => ({ name: POWER_CORE_UPGRADE_LABEL[id], description: POWER_CORE_UPGRADE_DESCRIPTION[id] })),
  )

  modal.append(heading, body)
  overlay.appendChild(modal)

  function close(): void {
    overlay.hidden = true
  }
  function open(): void {
    overlay.hidden = false
  }

  toggleButton.addEventListener('click', (e) => {
    e.stopPropagation() // don't let the document-level "click away deselects" listener see this
    if (overlay.hidden) open()
    else close()
  })
  // No dedicated close button (removed - it ended up rendering far off to
  // the right of the screen, a positioning bug not worth chasing further
  // when backdrop-click/right-click/Escape already close it just fine).
  modal.addEventListener('click', (e) => e.stopPropagation())
  overlay.addEventListener('click', close) // clicking the backdrop (outside the modal box) closes it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close()
  })

  container.append(toggleButton, overlay)
}
