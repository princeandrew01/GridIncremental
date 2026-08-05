export interface TabDef {
  id: string
  label: string
}

export interface TabShellHandle {
  /** The content container for this tab id - hand it to whatever builds that tab's content. */
  contentContainer(id: string): HTMLElement
}

/**
 * A vertical tab strip + one content area per tab, toggled by `display`.
 * Exactly one tab's content is visible at a time. No animation - respects
 * prefers-reduced-motion, already handled globally in style.css.
 */
export function createTabShell(container: HTMLElement, tabs: TabDef[], initialTabId: string = tabs[0].id): TabShellHandle {
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
  }

  for (const tab of tabs) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tab-button'
    btn.textContent = tab.label
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
  }
}
