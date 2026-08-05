import { APP_VERSION, APP_AUTHOR, INSPIRED_BY_NAME, INSPIRED_BY_URL } from '../game/config'

/** Static "About" info at the bottom of the settings popover: inspiration credit, author, version. */
export function createAboutSection(container: HTMLElement): void {
  container.classList.add('settings-about')

  const heading = document.createElement('h2')
  heading.textContent = 'About'

  const inspiredBy = document.createElement('p')
  inspiredBy.className = 'settings-about-line'
  const link = document.createElement('a')
  link.href = INSPIRED_BY_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = INSPIRED_BY_NAME
  inspiredBy.append('Inspired by ', link)

  const author = document.createElement('p')
  author.className = 'settings-about-line'
  author.textContent = `Made by ${APP_AUTHOR}`

  const version = document.createElement('p')
  version.className = 'settings-about-line'
  version.textContent = `Version: ${APP_VERSION}`

  container.append(heading, inspiredBy, author, version)
}
