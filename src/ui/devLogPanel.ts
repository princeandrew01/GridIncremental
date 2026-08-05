import { DEV_LOG } from '../game/devLog'

/**
 * A "Dev Log" button that toggles a small popover listing what's changed,
 * release by release (see game/devLog.ts for the content). Static - nothing
 * to update per-frame - so this returns void, not a handle, same shape as
 * aboutSection.ts. Reuses the toggle/stopPropagation/document-click-closes
 * pattern from settingsPanel.ts.
 */
export function createDevLogPanel(container: HTMLElement): void {
  container.classList.add('devlog-wrapper')

  const toggleButton = document.createElement('button')
  toggleButton.type = 'button'
  toggleButton.className = 'devlog-toggle'
  toggleButton.textContent = 'Dev Log'

  const popover = document.createElement('div')
  popover.className = 'devlog-popover'
  popover.hidden = true

  const heading = document.createElement('h2')
  heading.textContent = 'Dev Log'
  popover.appendChild(heading)

  for (const entry of DEV_LOG) {
    const section = document.createElement('div')
    section.className = 'devlog-entry'

    const entryHeading = document.createElement('h3')
    entryHeading.textContent = `${entry.version} — ${entry.date}`

    const summary = document.createElement('p')
    summary.className = 'devlog-summary'
    summary.textContent = entry.summary

    const list = document.createElement('ul')
    list.className = 'devlog-changes'
    for (const change of entry.changes) {
      const li = document.createElement('li')
      li.textContent = change
      list.appendChild(li)
    }

    section.append(entryHeading, summary, list)
    popover.appendChild(section)
  }

  toggleButton.addEventListener('click', (e) => {
    e.stopPropagation() // don't let the document-level "click away deselects" listener see this
    popover.hidden = !popover.hidden
  })
  popover.addEventListener('click', (e) => e.stopPropagation())

  document.addEventListener('click', () => {
    popover.hidden = true
  })

  container.append(toggleButton, popover)
}
