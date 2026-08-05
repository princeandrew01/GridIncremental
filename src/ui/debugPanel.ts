import { DEBUG_TICK_SPEED_MIN, DEBUG_TICK_SPEED_MAX, DEBUG_TICK_SPEED_STEP, GRID_SIZE_OPTIONS } from '../game/config'

/**
 * Testing-only controls: not part of the game itself, not saved anywhere.
 * Tick speed lets us feel out whether a "faster ticks" upgrade would be
 * worth adding for real. Grid size just resets the board at a new size -
 * there's no save system yet to carry a layout across a resize.
 */
export function createDebugPanel(
  container: HTMLElement,
  initialTickSpeed: number,
  initialGridSize: number,
  onTickSpeedChange: (multiplier: number) => void,
  onGridSizeChange: (size: number) => void,
): void {
  container.className = 'debug-panel'

  const heading = document.createElement('h2')
  heading.textContent = 'Debug (testing only)'

  // --- Tick speed ---
  const speedRow = document.createElement('div')
  speedRow.className = 'debug-row'

  const speedLabel = document.createElement('label')
  speedLabel.className = 'debug-label'
  speedLabel.textContent = 'Tick interval multiplier (1 = normal 1000ms/tick, 0.1 = 10x faster):'
  speedLabel.htmlFor = 'debug-tick-speed-slider'

  const slider = document.createElement('input')
  slider.id = 'debug-tick-speed-slider'
  slider.type = 'range'
  slider.min = String(DEBUG_TICK_SPEED_MIN)
  slider.max = String(DEBUG_TICK_SPEED_MAX)
  slider.step = String(DEBUG_TICK_SPEED_STEP)
  slider.value = String(initialTickSpeed)
  slider.className = 'debug-slider'

  const numberBox = document.createElement('input')
  numberBox.type = 'number'
  numberBox.min = String(DEBUG_TICK_SPEED_MIN)
  numberBox.max = String(DEBUG_TICK_SPEED_MAX)
  numberBox.step = String(DEBUG_TICK_SPEED_STEP)
  numberBox.value = String(initialTickSpeed)
  numberBox.className = 'debug-number'
  numberBox.setAttribute('aria-label', 'Tick interval multiplier, entered manually')

  function clampSpeed(v: number): number {
    if (Number.isNaN(v)) return DEBUG_TICK_SPEED_MAX
    return Math.min(DEBUG_TICK_SPEED_MAX, Math.max(DEBUG_TICK_SPEED_MIN, v))
  }

  slider.addEventListener('input', () => {
    const v = clampSpeed(parseFloat(slider.value))
    numberBox.value = String(v)
    onTickSpeedChange(v)
  })

  numberBox.addEventListener('change', () => {
    const v = clampSpeed(parseFloat(numberBox.value))
    numberBox.value = String(v)
    slider.value = String(v)
    onTickSpeedChange(v)
  })

  speedRow.append(slider, numberBox)

  // --- Grid size ---
  const sizeRow = document.createElement('div')
  sizeRow.className = 'debug-row'

  const sizeLabel = document.createElement('label')
  sizeLabel.className = 'debug-label'
  sizeLabel.textContent = 'Grid size (resets the board):'
  sizeLabel.htmlFor = 'debug-grid-size'

  const sizeSelect = document.createElement('select')
  sizeSelect.id = 'debug-grid-size'
  sizeSelect.className = 'debug-select'
  for (const size of GRID_SIZE_OPTIONS) {
    const option = document.createElement('option')
    option.value = String(size)
    option.textContent = `${size} x ${size}`
    if (size === initialGridSize) option.selected = true
    sizeSelect.appendChild(option)
  }
  sizeSelect.addEventListener('change', () => {
    onGridSizeChange(parseInt(sizeSelect.value, 10))
  })

  sizeRow.append(sizeSelect)

  container.append(heading, speedLabel, speedRow, sizeLabel, sizeRow)
}
