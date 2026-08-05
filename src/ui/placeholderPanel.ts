/** "Coming soon" content for tabs that don't have a real implementation yet (Prestige, Gems, Upgrades). */
export function createPlaceholderPanel(container: HTMLElement, label: string): void {
  container.classList.add('panel-section', 'placeholder-panel')
  const p = document.createElement('p')
  p.className = 'placeholder-text'
  p.textContent = `${label} - coming soon.`
  container.appendChild(p)
}
