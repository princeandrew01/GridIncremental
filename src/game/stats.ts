import Decimal from 'break_infinity.js'
import type { GameState, TickResult } from './types'
import {
  ACHIEVEMENT_PLAYTIME_HOURS,
  ACHIEVEMENT_GENERATORS_BUILT,
  ACHIEVEMENT_TIMES_LEVELED,
  ACHIEVEMENT_CURRENCY_FARMED,
  ACHIEVEMENT_HIGHEST_BASIC,
  ACHIEVEMENT_HIGHEST_LEECH,
  ACHIEVEMENT_BUFF_LEVEL,
} from './config'

/**
 * Scans the board's current final values and bumps the running "highest
 * ever" trackers if exceeded. Safe to call after any recalculation (a real
 * tick or an offline catch-up) rather than every intermediate step: with no
 * removal mechanic driving these three down between calls, the end state
 * after a jump is never less than any point along the way.
 *
 * highestBuffLevel tracks the highest COMBINED level across every Buff (V1 +
 * V2) on the board at any one snapshot, not any single buff's own level - a
 * lone buff only reaches level 2 or 4, nowhere near enough range for the
 * Achievements tab's 10-tier requirement (see config.ts). Removing a buff can
 * lower the live sum, but that's fine: like highestValue below, this only
 * ever ratchets up, and checkAchievements() only ever adds unlocks, never
 * revokes them.
 */
export function updateHighestValues(state: GameState, result: TickResult): void {
  let buffLevelSum = 0
  for (let i = 0; i < state.cells.length; i++) {
    const cell = state.cells[i]
    if (cell.type === 'basic') {
      if (result.final[i].gt(state.highestValue.basic)) state.highestValue.basic = result.final[i]
    } else if (cell.type === 'leech') {
      if (result.final[i].gt(state.highestValue.leech)) state.highestValue.leech = result.final[i]
    } else if (cell.type === 'buffV1' || cell.type === 'buffV2') {
      buffLevelSum += cell.level
    }
  }
  if (buffLevelSum > state.highestBuffLevel) state.highestBuffLevel = buffLevelSum
}

export interface AchievementTier {
  id: string
  threshold: number
  label: string
}

export interface AchievementCategory {
  id: string
  name: string
  /** A single glyph representing the category in the Achievements tab - see ui/achievementsPanel.ts. */
  icon: string
  /** Always a Decimal, even for plain-number stats, so tier comparisons and
   *  display formatting are uniform regardless of which stat backs it. */
  currentValue: (state: GameState) => Decimal
  tiers: AchievementTier[]
}

function tier(categoryId: string, threshold: number, unitLabel: string): AchievementTier {
  return { id: `${categoryId}_${threshold}`, threshold, label: `${threshold.toLocaleString()} ${unitLabel}` }
}

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  {
    id: 'playtime',
    name: 'Play Time',
    icon: '⏱',
    currentValue: (state) => new Decimal(state.activePlayMs / (60 * 60 * 1000)), // ms -> hours
    tiers: ACHIEVEMENT_PLAYTIME_HOURS.map((h) => tier('playtime', h, 'hours')),
  },
  {
    id: 'generators_built',
    name: 'Generators Built',
    icon: '⚙',
    currentValue: (state) => new Decimal(state.totalGeneratorsBuilt),
    tiers: ACHIEVEMENT_GENERATORS_BUILT.map((n) => tier('generators_built', n, 'built')),
  },
  {
    id: 'times_leveled',
    name: 'Times Leveled',
    icon: '📈',
    currentValue: (state) => new Decimal(state.totalUpgrades),
    tiers: ACHIEVEMENT_TIMES_LEVELED.map((n) => tier('times_leveled', n, 'upgrades')),
  },
  {
    id: 'currency_farmed',
    name: 'Currency Farmed',
    icon: '💰',
    currentValue: (state) => state.lifetimeCurrencyEarned,
    tiers: ACHIEVEMENT_CURRENCY_FARMED.map((n) => tier('currency_farmed', n, 'earned')),
  },
  {
    id: 'highest_basic',
    name: 'Highest Basic Value',
    icon: 'B',
    currentValue: (state) => state.highestValue.basic,
    tiers: ACHIEVEMENT_HIGHEST_BASIC.map((n) => tier('highest_basic', n, 'value')),
  },
  {
    id: 'highest_leech',
    name: 'Highest Leech Value',
    icon: 'L',
    currentValue: (state) => state.highestValue.leech,
    tiers: ACHIEVEMENT_HIGHEST_LEECH.map((n) => tier('highest_leech', n, 'value')),
  },
  {
    id: 'buff_level',
    name: 'Buff Levels',
    icon: 'F',
    currentValue: (state) => new Decimal(state.highestBuffLevel),
    tiers: ACHIEVEMENT_BUFF_LEVEL.map((n) => tier('buff_level', n, 'combined levels')),
  },
]

/**
 * Checks every tier in every category against the current state, unlocking
 * (and returning) any newly-crossed ones. Idempotent - already-unlocked
 * tiers are skipped, and calling this repeatedly with no new progress
 * returns an empty array every time.
 */
export function checkAchievements(state: GameState): string[] {
  const unlockedSet = new Set(state.unlockedAchievements)
  const newlyUnlocked: string[] = []

  for (const category of ACHIEVEMENT_CATEGORIES) {
    const current = category.currentValue(state)
    for (const t of category.tiers) {
      if (unlockedSet.has(t.id)) continue
      if (current.gte(t.threshold)) {
        unlockedSet.add(t.id)
        newlyUnlocked.push(t.id)
      }
    }
  }

  if (newlyUnlocked.length > 0) {
    state.unlockedAchievements = Array.from(unlockedSet)
  }
  return newlyUnlocked
}
