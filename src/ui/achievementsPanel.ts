import Decimal from 'break_infinity.js'
import type { GameState } from '../game/types'
import { format } from '../game/format'
import type { NumberFormatMode } from '../game/format'
import { ACHIEVEMENT_CATEGORIES } from '../game/stats'

export interface AchievementsPanelHandle {
  update(state: GameState, formatMode: NumberFormatMode): void
}

interface CategoryEls {
  stars: HTMLElement[]
  starsRow: HTMLElement
  progress: HTMLElement
}

// Ties the highest_basic/highest_leech/buff_level icons to the same colours
// their type already uses everywhere else on the board (grid cells, build
// buttons - see grid.ts's cell-<type> classes) - the other categories aren't
// about a generator type, so they stay a plain neutral glyph.
const ICON_TYPE_CLASS: Record<string, string> = {
  highest_basic: 'cell-basic',
  highest_leech: 'cell-leech',
  buff_level: 'cell-buffV1',
}

/**
 * One row per category: a single icon, a 10-star bar showing how many tiers
 * are unlocked, and how close the next one is - replaces the old per-tier
 * checklist, which read as a long list rather than an at-a-glance summary.
 */
export function createAchievementsPanel(container: HTMLElement): AchievementsPanelHandle {
  container.classList.add('panel-section', 'achievements-panel')

  const heading = document.createElement('h2')
  heading.textContent = 'Achievements'
  container.appendChild(heading)

  const categoryEls: CategoryEls[] = ACHIEVEMENT_CATEGORIES.map((category) => {
    const row = document.createElement('div')
    row.className = 'achievement-row'

    const icon = document.createElement('span')
    icon.className = 'achievement-icon'
    if (category.id in ICON_TYPE_CLASS) icon.classList.add(ICON_TYPE_CLASS[category.id])
    icon.textContent = category.icon
    icon.setAttribute('aria-hidden', 'true')

    const info = document.createElement('div')
    info.className = 'achievement-info'

    const name = document.createElement('div')
    name.className = 'achievement-name'
    name.textContent = category.name

    const starsRow = document.createElement('div')
    starsRow.className = 'achievement-stars'
    const stars = category.tiers.map(() => {
      const star = document.createElement('span')
      star.className = 'achievement-star'
      star.textContent = '★'
      star.setAttribute('aria-hidden', 'true')
      starsRow.appendChild(star)
      return star
    })

    const progress = document.createElement('div')
    progress.className = 'achievement-progress'

    info.append(name, starsRow, progress)
    row.append(icon, info)
    container.appendChild(row)

    return { stars, starsRow, progress }
  })

  function update(state: GameState, formatMode: NumberFormatMode): void {
    const unlocked = new Set(state.unlockedAchievements)
    ACHIEVEMENT_CATEGORIES.forEach((category, ci) => {
      const els = categoryEls[ci]
      const current = category.currentValue(state)

      let unlockedCount = 0
      let nextTier = null
      for (const t of category.tiers) {
        if (unlocked.has(t.id)) unlockedCount++
        else if (!nextTier) nextTier = t
      }

      els.stars.forEach((star, i) => star.classList.toggle('achievement-star-filled', i < unlockedCount))
      els.starsRow.setAttribute('aria-label', `${unlockedCount} of ${category.tiers.length} unlocked`)

      els.progress.textContent = nextTier
        ? `${format(current, formatMode)} / ${format(new Decimal(nextTier.threshold), formatMode)}`
        : 'All unlocked!'
    })
  }

  return { update }
}
