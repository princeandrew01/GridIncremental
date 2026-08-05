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

  // <details>/<summary> per version - collapsible for free, no toggle-state
  // bookkeeping needed. The whole log was one long unbroken scroll before
  // this; only the most recent version opens by default, everything older
  // collapses so skimming past versions doesn't mean scrolling past all of
  // their full change lists too.
  DEV_LOG.forEach((entry, i) => {
    const section = document.createElement('details')
    section.className = 'devlog-entry'
    if (i === 0) section.open = true

    const entryHeading = document.createElement('summary')
    entryHeading.className = 'devlog-entry-summary'
    const versionLabel = document.createElement('span')
    versionLabel.className = 'devlog-version'
    versionLabel.textContent = `${entry.version} — ${entry.date}`
    const summaryLabel = document.createElement('span')
    summaryLabel.className = 'devlog-summary'
    summaryLabel.textContent = entry.summary
    entryHeading.append(versionLabel, summaryLabel)

    const list = document.createElement('ul')
    list.className = 'devlog-changes'
    for (const change of entry.changes) {
      const li = document.createElement('li')
      li.textContent = change
      list.appendChild(li)
    }

    section.append(entryHeading, list)
    popover.appendChild(section)
  })

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
