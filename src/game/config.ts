// All tuning values live here. No magic numbers anywhere else in the codebase.

import type { UpgradeId, UpgradeLevels } from './types'

// Shown in the settings popover's About section. Bump the version by hand as
// the game progresses.
export const APP_VERSION = 'Alpha 0.2'
export const APP_AUTHOR = 'Asingh'
export const INSPIRED_BY_NAME = 'Gridle'
export const INSPIRED_BY_URL = 'https://parsakaali.itch.io/gridle'

export const TICK_MS = 1000
// A new game starts small on purpose - the Grid Size upgrade below grows it
// back out, 1 per level, 5 levels: 3x3 -> 8x8 (the old fixed default).
export const GRID_W = 3
export const GRID_H = 3

// --- Levels: 0-based everywhere. Level 0 = freshly placed, no upgrades
// bought yet. Arrays below are indexed directly by level, no dead entry 0. ---
export const MAX_LEVEL = { basic: 5, leech: 2, buffV1: 2, buffV2: 4 } as const

// A Basic's `base` (level 0, no buffs, no upgrades) - this is the number
// Leeches read (crit included - see engine.ts). Flat per-level growth was
// moved out of leveling entirely, into the Basic Generator Value upgrade
// below; leveling now only grows crit chance/amount (see CRIT_* below).
export const BASIC_BASE_VALUE = 1

// Multiplier applied to a Basic's `base` to get its OWN output - never seen
// by Leeches, which only ever read the pre-multiplier `base`. Index = level.
export const BASIC_MULT = [1, 1.5, 3, 7.5, 22.5, 78.75]

// --- Crit mechanic ---
// A Basic's crit chance/amount are both a global base (raised by the
// Crit Chance / Crit Amount upgrades, account-wide) plus a per-cell bonus
// from that Basic's own level. The two level-driven bonuses are deliberately
// different shapes: chance grows *linearly* (+1%/level, modest - it's a
// probability), amount grows by *doubling* (up to 32x at max level - it's
// meant to feel explosive, balanced by how expensive leveling Basic becomes).
// Crit is resolved once per Basic per tick, baked into `base` before a Leech
// ever reads it (deliberate: unlike BASIC_MULT, crit IS visible to Leeches -
// see engine.ts recalculate()).
export const CRIT_BASE_CHANCE = 0.05 // 5% with no upgrades, level 0 basic
export const CRIT_BASE_AMOUNT = 1.5 // 1.5x with no upgrades, level 0 basic
export const BASIC_CRIT_CHANCE_PER_LEVEL = 0.01 // +1% per Basic level (max +5% at level 5)
export const BASIC_CRIT_AMOUNT_MULT = [1, 2, 4, 8, 16, 32] // multiplies CRIT_BASE_AMOUNT; index = level

// Display label for a Leech's range at each level. Index = level.
export const LEECH_RANGE_LABEL = ['Orthogonal (4 cells)', 'Moore (8 cells)', 'Whole board']

// Buffs fire (advance buffAccum) every N ticks.
export const BUFF_TICK_INTERVAL = 5

// --- Buff V1 (directional) vs Buff V2 (whole board) ---
// V1's levels buy coverage, not power: level 0 hits the single faced cell,
// level 1 also hits the opposite side, level 2 hits all 4 sides - power per
// hit never changes. V2 always hits every Basic on the board; its levels buy
// power instead, since coverage is already maximal from level 0.
export const BUFF_V1_POWER = 1
export const BUFF_V2_POWER = [1, 2, 4, 8, 16] // index = level

export const BASE_COST = { basic: 10, leech: 100, buffV1: 250, buffV2: 5000 }
export const COST_GROWTH = 1.15 // placement cost = base * growth^(count already placed)

// Per-type upgrade cost growth (cost to go from `level` to `level+1` = base *
// growth^level). Leech's stays at the original 2.5 - "Leech stays the same as
// it is now". Basic's is deliberately steep: 5 levels buys up to a 32x crit
// multiplier, so the climb has to hurt.
export const UPGRADE_COST_GROWTH = { basic: 15, leech: 2.5, buffV1: 4, buffV2: 6 }

// Removing a generator refunds this fraction of what was actually paid to
// place it (not counting any upgrades since - see Cell.placementCost). The
// Removal Refund upgrade raises this, up to 1 (100%) - see upgrades.ts.
export const REMOVE_REFUND_FRACTION = 0.5

// Not in the spec: with costs added in Phase 3 and no way to earn currency
// before a first generator exists, a fresh game needs a bootstrap. Set to
// exactly one Basic's cost so a new player can place exactly one generator
// to start the loop. This is a balance decision, not an engine one - it is
// applied at new-game creation in main.ts, not in makeGameState().
export const STARTING_CURRENCY = BASE_COST.basic

// Cap on the tick-catchup loop in the frame accumulator; beyond this, use the
// offline closed-form path instead of simulating tick by tick.
export const MAX_CATCHUP_TICKS = 1000

// How much time away counts toward offline progress. A balance decision
// (spec §6), not a technical one - the closed-form math in offline.ts has
// no trouble with any N, however large. Expressed in ticks so it stays
// correct regardless of the effective tick length (the Tick Speed upgrade
// changes that per-player) - see maxOfflineTicks() below.
export const MAX_OFFLINE_HOURS = 24
export function maxOfflineTicks(tickMs: number): number {
  return (MAX_OFFLINE_HOURS * 60 * 60 * 1000) / tickMs
}
export const MAX_OFFLINE_TICKS = maxOfflineTicks(TICK_MS) // convenience for the default (no-upgrade) tick length

// Single-roll flavour on top of the closed-form expected-value offline crit
// math (see offline.ts): the final offline total is nudged by a uniform
// random factor in [1 - OFFLINE_CRIT_VARIANCE, 1 + OFFLINE_CRIT_VARIANCE], so
// two absences of the same length don't earn the exact same amount.
export const OFFLINE_CRIT_VARIANCE = 0.1

// --- Upgrades tab (account-wide, purchased with currency - see game/upgrades.ts) ---

export const UPGRADE_MAX_LEVEL: UpgradeLevels = {
  tickSpeed: 25,
  basicValue: 999_999,
  generatorValuePct: 25,
  critChance: 25,
  critAmount: 10,
  removalRefund: 10,
  gridSize: 5,
}

export const TICK_SPEED_MS_PER_LEVEL = 10 // -0.01s per level, 1.00s -> 0.75s at level 25
export const BASIC_VALUE_PER_LEVEL = 1 // flat +1 to every Basic's base per level
export const GENERATOR_VALUE_PCT_PER_LEVEL = 0.05 // +5% per level, max +125% at level 25
export const CRIT_CHANCE_UPGRADE_PER_LEVEL = 0.01 // +1% per level
export const CRIT_AMOUNT_UPGRADE_PER_LEVEL = 0.1 // +0.1x per level, 1.5x -> 2.5x at level 10
export const REMOVAL_REFUND_PER_LEVEL = 0.05 // +5% per level, 50% -> 100% at level 10
export const GRID_SIZE_PER_LEVEL = 1 // +1 to both width and height per level, 3x3 -> 8x8 at level 5

// Cost to go from `level` to `level+1`. Exponential: base * growth^level.
// basicValue (infinite, bought in bulk) is quadratic instead:
// coefficient * (level+1)^2 - see upgrades.ts bulkUpgradeCost() for the
// closed-form sums used to buy many levels at once without a loop.
type ExponentialCurve = { kind: 'exponential'; baseCost: number; growth: number }
type QuadraticCurve = { kind: 'quadratic'; coefficient: number }
export const UPGRADE_COST: Record<UpgradeId, ExponentialCurve | QuadraticCurve> = {
  tickSpeed: { kind: 'exponential', baseCost: 500, growth: 2.0 },
  basicValue: { kind: 'quadratic', coefficient: 50 },
  generatorValuePct: { kind: 'exponential', baseCost: 1000, growth: 1.8 },
  critChance: { kind: 'exponential', baseCost: 2000, growth: 1.8 },
  critAmount: { kind: 'exponential', baseCost: 5000, growth: 3.0 },
  removalRefund: { kind: 'exponential', baseCost: 1000, growth: 2.0 },
  // Only 5 levels, but each is a huge functional unlock (more of every other
  // upgrade's effect, more room for generators) - priced to match the other
  // upgrades' total cost to max out, not their per-level cost.
  gridSize: { kind: 'exponential', baseCost: 100_000, growth: 15 },
}

// Achievement tier thresholds, one array per category (src/game/stats.ts).
// Every category has exactly 10 tiers - the Achievements tab shows one
// 10-star row per category (see ui/achievementsPanel.ts), so the count needs
// to be uniform across all of them. All balance decisions, not technical
// ones - trivially adjustable, as long as each array stays at 10 entries.
export const ACHIEVEMENT_PLAYTIME_HOURS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
export const ACHIEVEMENT_GENERATORS_BUILT = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500]
export const ACHIEVEMENT_TIMES_LEVELED = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500]
export const ACHIEVEMENT_CURRENCY_FARMED = [1e3, 1e4, 1e5, 1e6, 1e7, 1e9, 1e12, 1e15, 1e18, 1e21]
export const ACHIEVEMENT_HIGHEST_BASIC = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e9, 1e12, 1e15, 1e18]
export const ACHIEVEMENT_HIGHEST_LEECH = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e9, 1e12, 1e15, 1e18]
// Combined levels across every Buff (V1 + V2) currently on the board, not a
// single buff's own level - a lone buff only goes up to level 2 or 4, nowhere
// near enough range for 10 real tiers. See stats.ts updateHighestValues().
export const ACHIEVEMENT_BUFF_LEVEL = [1, 2, 4, 6, 10, 15, 20, 30, 50, 75]
