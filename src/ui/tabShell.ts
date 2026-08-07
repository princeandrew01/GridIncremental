export interface TabDef {
  id: string
  label: string
  /** Shown on the rail button itself (an icon glyph) - `label` still powers the tooltip/aria-label, since a bare icon alone isn't self-explanatory. */
  icon: string
}

export interface TabShellHandle {
  /** The content container for this tab id - hand it to whatever builds that tab's content. */
  contentContainer(id: string): HTMLElement
  /** Switches to this tab programmatically, same as clicking its button - fires onTabChange too. */
  activateTab(id: string): void
  /** Changes a rail button's icon/label after construction - for a tab whose identity depends on live state (e.g. main.ts's "selected cell" tab, which shows whatever type is currently selected). */
  setTabIcon(id: string, icon: string, label: string): void
  /** Shows/hides a rail button - for a tab that only makes sense some of the time (e.g. "selected cell", hidden whenever nothing's selected). Hiding the currently-active tab does NOT auto-switch away; the caller is responsible for that (see main.ts). */
  setTabHidden(id: string, hidden: boolean): void
}

/**
 * An icon rail (on the right edge of the right zone, see style.css
 * .tab-shell) + one content area per tab, the open one's content sitting to
 * the rail's left. Exactly one tab's content is visible at a time. No
 * animation - respects prefers-reduced-motion, already handled globally in
 * style.css.
 *
 * `onTabChange`, if given, fires on every activation (button click or
 * programmatic via activateTab) with the newly-active tab id - main.ts uses
 * this to deselect whatever's selected on the grid whenever the player
 * navigates away from the Build tab, and activateTab to jump *to* Build
 * automatically when a cell gets selected.
 */
export function createTabShell(
  container: HTMLElement,
  tabs: TabDef[],
  onTabChange?: (id: string) => void,
  initialTabId: string = tabs[0].id,
): TabShellHandle {
  container.classList.add('tab-shell')

  const strip = document.createElement('div')
  strip.className = 'tab-strip'
  strip.setAttribute('role', 'tablist')

  const contentArea = document.createElement('div')
  contentArea.className = 'tab-content-area'

  const buttons = new Map<string, HTMLButtonElement>()
  const contents = new Map<string, HTMLElement>()

  function activate(id: string): void {
    for (const [tabId, btn] of buttons) {
      const active = tabId === id
      btn.classList.toggle('tab-button-active', active)
      btn.setAttribute('aria-selected', String(active))
    }
    for (const [tabId, content] of contents) {
      content.hidden = tabId !== id
    }
    onTabChange?.(id)
  }

  for (const tab of tabs) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tab-button'
    btn.textContent = tab.icon
    btn.title = tab.label
    btn.setAttribute('aria-label', tab.label)
    btn.setAttribute('role', 'tab')
    btn.addEventListener('click', () => activate(tab.id))
    strip.appendChild(btn)
    buttons.set(tab.id, btn)

    const content = document.createElement('div')
    content.className = 'tab-content'
    contentArea.appendChild(content)
    contents.set(tab.id, content)
  }

  container.append(strip, contentArea)
  activate(initialTabId)

  return {
    contentContainer(id: string): HTMLElement {
      const el = contents.get(id)
      if (!el) throw new Error(`Unknown tab id: ${id}`)
      return el
    },
    activateTab: activate,
    setTabIcon(id: string, icon: string, label: string): void {
      const btn = buttons.get(id)
      if (!btn) throw new Error(`Unknown tab id: ${id}`)
      btn.textContent = icon
      btn.title = label
      btn.setAttribute('aria-label', label)
    },
    setTabHidden(id: string, hidden: boolean): void {
      const btn = buttons.get(id)
      if (!btn) throw new Error(`Unknown tab id: ${id}`)
      btn.hidden = hidden
    },
  }
}
