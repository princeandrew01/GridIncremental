import type { GameState } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { ACHIEVEMENT_CATEGORIES } from '../game/stats'

export interface AchievementsPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

interface TierEls {
  li: HTMLElement
  checkbox: HTMLElement
  progress: HTMLElement
}

export function createAchievementsPanel(container: HTMLElement): AchievementsPanelHandle {
  container.classList.add('panel-section', 'achievements-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Achievements'
  container.appendChild(heading)

  const categoryTierEls: TierEls[][] = ACHIEVEMENT_CATEGORIES.map((category) => {
    const section = document.createElement('div')
    section.className = 'achievement-category'
    const catHeading = document.createElement('h3')
    catHeading.textContent = category.name
    const list = document.createElement('ul')
    list.className = 'achievement-tier-list'
    section.append(catHeading, list)
    container.appendChild(section)

    return category.tiers.map((t): TierEls => {
      const li = document.createElement('li')
      li.className = 'achievement-tier'
      const checkbox = document.createElement('span')
      checkbox.className = 'achievement-check'
      checkbox.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span')
      label.className = 'achievement-label'
      label.textContent = t.label
      const progress = document.createElement('span')
      progress.className = 'achievement-progress'
      li.append(checkbox, label, progress)
      list.appendChild(li)
      return { li, checkbox, progress }
    })
  })

  function update(state: GameState, formatMode: NumberFormatMode): void {
    const unlocked = new Set(state.unlockedAchievements)
    ACHIEVEMENT_CATEGORIES.forEach((category, ci) => {
      const current = category.currentValue(state)
      let nextShown = false
      category.tiers.forEach((t, ti) => {
        const els = categoryTierEls[ci][ti]
        const isUnlocked = unlocked.has(t.id)
        els.li.classList.toggle('achievement-unlocked', isUnlocked)
        els.checkbox.textContent = isUnlocked ? '✓' : ''
        // Only the next unmet tier in each category shows live progress -
        // later locked tiers stay quiet rather than cluttering the list.
        if (!isUnlocked && !nextShown) {
          els.progress.textContent = `${format(current, formatMode)} / ${t.threshold.toLocaleString()}`
          nextShown = true
        } else {
          els.progress.textContent = ''
        }
      })
    })
  }

  return { update }
}
