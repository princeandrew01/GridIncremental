import type { Settings, ThemeMode } from '../game/settings'
import type { NumberFormatMode } from '../game/format'

const FORMAT_LABELS: Record<NumberFormatMode, string> = {
  scientific: 'Scientific (1.23e9)',
  engineering: 'Engineering (123.00e6)',
  suffix: 'Suffix (1.23B)',
}

const THEME_LABELS: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export interface SettingsPanelHandle {
  /** Append more popover content here (e.g. Save controls), below the format/volume controls. */
  contentContainer: HTMLElement
}

/**
 * A gear icon that toggles a small popover anchored just below it, with the
 * current settings. `onChange` is called (and the settings persisted)
 * whenever either control changes. `container` should sit inline wherever
 * the caller wants the icon to appear (e.g. next to the currency header) -
 * it becomes the popover's positioning anchor.
 */
export function createSettingsPanel(
  container: HTMLElement,
  initial: Settings,
  onChange: (settings: Settings) => void,
): SettingsPanelHandle {
  let current = { ...initial }

  container.classList.add('settings-wrapper')

  const toggleButton = document.createElement('button')
  toggleButton.type = 'button'
  toggleButton.className = 'settings-toggle'
  toggleButton.setAttribute('aria-label', 'Settings')
  toggleButton.textContent = '⚙'

  const popover = document.createElement('div')
  popover.className = 'settings-popover'
  popover.hidden = true

  const heading = document.createElement('h2')
  heading.textContent = 'Settings'

  const formatLabel = document.createElement('label')
  formatLabel.className = 'settings-label'
  formatLabel.textContent = 'Number format'
  formatLabel.htmlFor = 'settings-number-format'

  const formatSelect = document.createElement('select')
  formatSelect.id = 'settings-number-format'
  formatSelect.className = 'settings-select'
  for (const mode of Object.keys(FORMAT_LABELS) as NumberFormatMode[]) {
    const option = document.createElement('option')
    option.value = mode
    option.textContent = FORMAT_LABELS[mode]
    if (mode === current.numberFormat) option.selected = true
    formatSelect.appendChild(option)
  }
  formatSelect.addEventListener('change', () => {
    current = { ...current, numberFormat: formatSelect.value as NumberFormatMode }
    onChange(current)
  })

  const volumeLabel = document.createElement('label')
  volumeLabel.className = 'settings-label'
  volumeLabel.textContent = 'Volume (no audio yet)'
  volumeLabel.htmlFor = 'settings-volume'

  const volumeInput = document.createElement('input')
  volumeInput.id = 'settings-volume'
  volumeInput.type = 'range'
  volumeInput.min = '0'
  volumeInput.max = '100'
  volumeInput.step = '1'
  volumeInput.value = String(current.volume)
  volumeInput.className = 'settings-slider'
  volumeInput.addEventListener('input', () => {
    current = { ...current, volume: parseInt(volumeInput.value, 10) }
    onChange(current)
  })

  const themeLabel = document.createElement('label')
  themeLabel.className = 'settings-label'
  themeLabel.textContent = 'Theme'
  themeLabel.htmlFor = 'settings-theme'

  const themeSelect = document.createElement('select')
  themeSelect.id = 'settings-theme'
  themeSelect.className = 'settings-select'
  for (const mode of Object.keys(THEME_LABELS) as ThemeMode[]) {
    const option = document.createElement('option')
    option.value = mode
    option.textContent = THEME_LABELS[mode]
    if (mode === current.theme) option.selected = true
    themeSelect.appendChild(option)
  }
  themeSelect.addEventListener('change', () => {
    current = { ...current, theme: themeSelect.value as ThemeMode }
    onChange(current)
  })

  const descRow = document.createElement('label')
  descRow.className = 'settings-checkbox-row'
  const descCheckbox = document.createElement('input')
  descCheckbox.id = 'settings-show-build-descriptions'
  descCheckbox.type = 'checkbox'
  descCheckbox.checked = current.showBuildDescriptions
  descCheckbox.addEventListener('change', () => {
    current = { ...current, showBuildDescriptions: descCheckbox.checked }
    onChange(current)
  })
  const descRowLabel = document.createElement('span')
  descRowLabel.textContent = 'Show generator descriptions in Build tab'
  descRow.append(descCheckbox, descRowLabel)

  popover.append(heading, formatLabel, formatSelect, volumeLabel, volumeInput, themeLabel, themeSelect, descRow)

  toggleButton.addEventListener('click', (e) => {
    e.stopPropagation() // don't let the document-level "click away deselects" listener see this
    popover.hidden = !popover.hidden
  })
  popover.addEventListener('click', (e) => e.stopPropagation())

  document.addEventListener('click', () => {
    popover.hidden = true
  })

  container.append(toggleButton, popover)

  return { contentContainer: popover }
}
