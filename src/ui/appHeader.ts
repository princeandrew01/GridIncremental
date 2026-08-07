export interface AppHeaderHandle {
  /** Append icon-toggle containers here (Dev Log, Help, Settings) - grouped together on the header's right side, opposite the title. */
  iconGroup: HTMLElement
}

/** The game's title bar: "Grid Incremental" on the left, a slot for icon toggles (Dev Log, Help, Settings - wired up by main.ts) on the right. */
export function createAppHeader(container: HTMLElement): AppHeaderHandle {
  container.classList.add('app-header')

  const title = document.createElement('h1')
  title.className = 'app-title'
  title.textContent = 'Grid Incremental'

  const iconGroup = document.createElement('div')
  iconGroup.className = 'app-header-icons'

  container.append(title, iconGroup)

  return { iconGroup }
}
