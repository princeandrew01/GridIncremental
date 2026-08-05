import { createDevLogPanel } from './devLogPanel'

/** The game's title bar: "Grid Incremental" plus the Dev Log popover toggle, at the very top of the page. */
export function createAppHeader(container: HTMLElement): void {
  container.classList.add('app-header')

  const title = document.createElement('h1')
  title.className = 'app-title'
  title.textContent = 'Grid Incremental'

  const devLogContainer = document.createElement('div')
  createDevLogPanel(devLogContainer)

  container.append(title, devLogContainer)
}
