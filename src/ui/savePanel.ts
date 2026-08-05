import type { GameState } from '../game/types'
import { exportSave, importSave, saveToLocalStorage } from '../game/save'

export interface SavePanelHandle {
  update(state: GameState): void
}

export function createSavePanel(container: HTMLElement, onImport: (state: GameState) => void): SavePanelHandle {
  container.classList.add('panel-section')

  const heading = document.createElement('h2')
  heading.textContent = 'Save'

  const status = document.createElement('div')
  status.className = 'save-status'

  const textarea = document.createElement('textarea')
  textarea.className = 'save-textarea'
  textarea.rows = 3
  textarea.spellcheck = false
  textarea.setAttribute('aria-label', 'Save data - export produces a string here, paste one here to import')
  textarea.placeholder = 'Export to get a save string. Paste one here and Import to load it.'

  const buttonRow = document.createElement('div')
  buttonRow.className = 'save-buttons'

  const exportButton = document.createElement('button')
  exportButton.type = 'button'
  exportButton.className = 'save-button'
  exportButton.textContent = 'Export'

  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'save-button'
  copyButton.textContent = 'Copy'

  const importButton = document.createElement('button')
  importButton.type = 'button'
  importButton.className = 'save-button'
  importButton.textContent = 'Import'

  const message = document.createElement('p')
  message.className = 'save-message'
  message.setAttribute('role', 'status') // announced to screen readers without stealing focus

  let currentState: GameState | null = null

  exportButton.addEventListener('click', () => {
    if (!currentState) return
    textarea.value = exportSave(currentState) // also stamps lastSaved (spec: exporting counts as a save)
    saveToLocalStorage(currentState)
    message.textContent = 'Exported below - copy it somewhere safe.'
    updateStatus()
  })

  copyButton.addEventListener('click', () => {
    textarea.select()
    navigator.clipboard
      ?.writeText(textarea.value)
      .then(() => {
        message.textContent = 'Copied to clipboard.'
      })
      .catch(() => {
        message.textContent = 'Could not reach the clipboard - text is selected, copy manually (Ctrl+C).'
      })
  })

  importButton.addEventListener('click', () => {
    try {
      const imported = importSave(textarea.value.trim())
      onImport(imported)
      message.textContent = 'Loaded.'
    } catch {
      message.textContent = "That save text isn't valid - nothing was changed."
    }
  })

  function updateStatus(): void {
    if (!currentState) {
      status.textContent = ''
      return
    }
    const seconds = Math.max(0, Math.floor((Date.now() - currentState.lastSaved) / 1000))
    if (seconds < 5) status.textContent = 'Saved just now.'
    else if (seconds < 60) status.textContent = `Last saved ${seconds}s ago.`
    else status.textContent = `Last saved ${Math.floor(seconds / 60)}m ago.`
  }

  buttonRow.append(exportButton, copyButton, importButton)
  container.append(heading, status, textarea, buttonRow, message)

  function update(state: GameState): void {
    currentState = state
    updateStatus()
  }

  return { update }
}
