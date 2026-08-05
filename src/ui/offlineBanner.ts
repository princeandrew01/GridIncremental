/** A small dismissible banner for "you were away, here's what happened" feedback. */
export function showOfflineBanner(message: string): void {
  const banner = document.createElement('div')
  banner.className = 'offline-banner'
  banner.setAttribute('role', 'status')

  const text = document.createElement('span')
  text.textContent = message

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'offline-banner-close'
  closeButton.setAttribute('aria-label', 'Dismiss')
  closeButton.textContent = '×'
  closeButton.addEventListener('click', () => banner.remove())

  banner.append(text, closeButton)
  document.body.prepend(banner)
}
