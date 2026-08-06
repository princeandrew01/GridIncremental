// All tuning values live here. No magic numbers anywhere else in the codebase.

import type { UpgradeId, UpgradeLevels, PowerCoreUpgradeId, PowerCoreUpgradeLevels } from './types'

// Shown in the settings popover's About section. Bump the version by hand as
// the game progresses.
export const APP_VERSION = 'Alpha 0.31'
export const APP_AUTHOR = 'Asingh'
export const INSPIRED_BY_NAME = 'Gridle'
export const INSPIRED_BY_URL = 'https://parsakaali.itch.io/gridle'

export const TICK_MS = 1000
// A new game starts small on purpose - the Grid Size upgrades below grow it
// back out, 1 per level, 3 levels per track (Energy + Power Core, 6 total):
// 4x4 -> 10x10 at both maxed (see MAX_GRID_SIZE). Was 3x3 -> 13x13 (5 levels
// per track) before this pass shrank both the default and the cap - existing
// saves self-heal to the new numbers on load (see economy.ts healGridSize).
export const GRID_W = 4
export const GRID_H = 4
// The hard cap both Grid Size tracks combine toward - GRID_W + (their maxed
// levels x GRID_SIZE_PER_LEVEL/PC_GRID_SIZE_PER_LEVEL). Kept as an explicit
// constant (asserted against the level maths in a test) rather than derived
// inline, so healGridSize has one unambiguous number to shrink oversized
// legacy boards down to.
export const MAX_GRID_SIZE = 10

// --- Levels: 0-based everywhere. Level 0 = freshly placed, no upgrades
// bought yet. Arrays below are indexed directly by level, no dead entry 0.
// The four evolved types cap at 0 - no leveling once evolved, for now (see
// _working/ALPHA_0.31_CHANGES.md "Deferred"). ---
export const MAX_LEVEL = {
  basic: 10,
  leech: 2,
  buff: 9,
  buffStacker: 0,
  buffAll: 0,
  basicCrit: 0,
  basicSteady: 0,
  powerCoreGenerator: 4,
} as const

// A Basic's `base` (level 0, no buffs, no upgrades) - the raw pre-level,
// pre-Buff, crit-inclusive figure (a display/diagnostic value - see
// engine.ts). Flat per-level growth was moved out of leveling entirely,
// into the Basic Generator Value upgrade below; leveling instead grows the
// private level multiplier (BASIC_MULT).
export const BASIC_BASE_VALUE = 1

// Multiplier applied to a Basic's `base` to get its OWN output (`final`).
// Index = level. A nearby Leech steals a share of this `final` value, not
// the pre-multiplier `base` (confirmed with the user: "leech should leech
// the output value not the base value"). Alpha 0.31: flat +1.5x/level after
// the first (was a much steeper curve topping out at 5 levels/78.75x when
// leveling also drove crit - now leveling is pure output, crit moved
// entirely to the Crit Tower evolution and the account-wide Crit Chance/
// Amount upgrades, see CRIT_TOWER_* below).
export const BASIC_MULT = [1, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5, 15]

// --- Crit mechanic ---
// A Basic's crit chance/amount are both a global base (raised by the Crit
// Chance / Crit Amount upgrades, account-wide). Alpha 0.31: leveling a
// Basic no longer touches crit at all - the only per-cell crit source now
// is evolving into a Crit Tower (see CRIT_TOWER_* below), a one-time,
// much bigger bump instead of a small one every level.
export const CRIT_BASE_CHANCE = 0.05 // 5% with no upgrades
export const CRIT_BASE_AMOUNT = 1.5 // 1.5x with no upgrades

// --- Crit Tower (Basic evolution) ---
// Additive to crit chance, multiplicative on crit amount - deliberately
// asymmetric (confirmed with the user): chance stays bounded reasonably
// (a probability), amount is meant to feel explosive since only up to 5 of
// these can ever exist (see POWER_CORE_UPGRADE_MAX_LEVEL.critTowerSlots).
export const CRIT_TOWER_CHANCE_BONUS = 0.3 // +30 percentage points, additive with base + the Crit Chance upgrade
export const CRIT_TOWER_AMOUNT_MULT = 100 // x100, multiplicative on top of base + the Crit Amount upgrade

// --- Basic Steady Tower (the other Basic evolution) ---
// Pure private output multiplier, on top of whatever level multiplier the
// cell already had when it evolved (always BASIC_MULT's max, 15x, since a
// Basic must be fully leveled before it can evolve).
export const STEADY_TOWER_MULT = 10

// Display label for a Leech's range at each level. Index = level.
export const LEECH_RANGE_LABEL = ['Orthogonal (4 cells)', 'Moore (8 cells)', 'Whole board']

// --- Buff (single unified type, replaces the old Buff V1/V2 split) ---
// Alpha 0.31: buffs are no longer a time-accumulating mechanic (no more
// "fires every N ticks" - see the removed BUFF_TICK_INTERVAL/buffAccum).
// A Buff is a live percentage multiplier on its target's own output
// (`final`) - a nearby Leech steals a share of that boosted output too,
// since Leech reads `final` now, not the pre-Buff `base` (this superseded
// an earlier version of this comment which said the opposite - see
// BASIC_MULT above and engine.ts recalculate()). 10 levels, 10% -> 100%,
// shared by the base Buff, a Buff Stacker acting as an ordinary buff, and
// Buff All (board-wide
// instead of 1-target) - one table, three consumers, see engine.ts
// resolveBuffMultipliers.
export const BUFF_PCT_PER_LEVEL = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

// powerCoreGenerator's placement has no price of its own - see
// economy.ts/upgrades.ts powerGeneratorCount, which both gates and pays for
// each one. BASE_COST below covers only the types placeCell actually charges
// for at placement time.
export const BASE_COST = { basic: 20, leech: 1000, buff: 2000 }
export const COST_GROWTH = 2.0 // placement cost = base * growth^(count already placed) - Basic/Leech/Buff only

// Per-type upgrade cost growth (cost to go from `level` to `level+1` = base *
// growth^level, where `base` is BASE_COST[type] for Basic/Leech/Buff, or
// POWER_CORE_GENERATOR_LEVEL_BASE_COST for the Power Core Generator, which
// has no BASE_COST entry of its own since its placement is free - see above).
// Leech's stays at the original 2.5 - "Leech stays the same as it is now".
// basic/buff are balance placeholders, tunable without touching any other
// logic - basic needs to support double the old level count (10, not 5) at
// a much gentler per-level payout (flat +1.5x, not a crit multiplier), buff
// is meant to be "deliberately expensive" per the design.
export const UPGRADE_COST_GROWTH = { basic: 3, leech: 2.5, buff: 4, powerCoreGenerator: 2 }

// The Power Core Generator's own per-cell level-up base cost (period 5->1
// across its 4 levels) - Power-Core-priced, doubling per level via
// UPGRADE_COST_GROWTH.powerCoreGenerator above (10 -> 20 -> 40 -> 80).
export const POWER_CORE_GENERATOR_LEVEL_BASE_COST = 10

// Removing a generator refunds this fraction of what was actually paid to
// place it (not counting any upgrades since - see Cell.placementCost). The
// Removal Refund upgrade raises this, up to 1 (100%) - see upgrades.ts. Only
// ever applies to Energy-priced placements (Basic/Leech/Buff) - the Power
// Core Generator refunds nothing on removal (see economy.ts removeRefund).
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
  gridSize: 3,
  powerGeneratorCount: 5,
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
// Exported so powerCoreUpgrades.ts's own cost table (below) can share the
// exact same two curve shapes and closed-form bulk-cost math, rather than a
// parallel type.
export type ExponentialCurve = { kind: 'exponential'; baseCost: number; growth: number }
export type QuadraticCurve = { kind: 'quadratic'; coefficient: number }
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
  // This upgrade's cost IS the Power Core Generator's placement cost, not a
  // separate gate on top of one - buying level N is simultaneously "affording
  // your Nth generator" (confirmed with the user). Level 1 = 1,000,000,
  // doubling every level after (1M -> 2M -> 4M -> 8M -> 16M).
  powerGeneratorCount: { kind: 'exponential', baseCost: 1_000_000, growth: 2 },
}

// --- Power Cores: a second resource with its own meta-progression menu
// (account-wide, purchased with power cores - see game/powerCoreUpgrades.ts).
// Alpha 0.31: produced exclusively by the Power Core Generator (no more
// exponent-threshold awards or Power Core Chance procs), and this tab is
// down to 5 upgrades - Grid Size (still combines additively with its energy
// counterpart, see game/upgrades.ts totalGridSizeLevel) plus 4 independent
// build-count-cap upgrades, one per evolution type. Every upgrade that used
// to combine with an Energy upgrade by name (Tick Speed/Basic Generator
// Value/Crit Chance/Crit Amount) is gone from this side - those stats are
// Energy-only now. ---

// Power Core Generator: production is discrete (a proc every `period`
// ticks, period = BASE - level), not continuous like a Basic - each
// generator's period depends on its own level, since every placed one is
// leveled independently. Alpha 0.31: period 5 -> 1 (was 10 -> 6) - the
// Power Core Amount upgrade that used to scale output per proc is gone, so
// every proc is worth exactly 1 core before any Buff multiplier.
export const POWER_CORE_GENERATOR_BASE_TICKS = 5
export const POWER_CORE_GENERATOR_TICKS_PER_LEVEL = 1 // 5 -> 1 tick across levels 0-4

export const PC_GRID_SIZE_PER_LEVEL = 1 // +1/level, additive with energy's Grid Size

export const POWER_CORE_UPGRADE_MAX_LEVEL: PowerCoreUpgradeLevels = {
  gridSize: 3,
  critTowerSlots: 5,
  basicSteadySlots: 5,
  buffStackerSlots: 5,
  buffAllSlots: 5,
}

// All 5 upgrades use the escalating exponential shape (see UPGRADE_COST
// above) - gridSize keeps its existing curve (the single biggest-ticket
// item in either tab, unchanged from Alpha 0.3). The 4 evolution slot
// upgrades are new: base 1,000, x10 per level (confirmed with the user -
// "of course it grows," tunable down later if it lands too steep) - 1,000
// -> 10,000 -> 100,000 -> 1,000,000 -> 10,000,000 across their 5 levels.
export const POWER_CORE_UPGRADE_COST: Record<PowerCoreUpgradeId, ExponentialCurve | QuadraticCurve> = {
  gridSize: { kind: 'exponential', baseCost: 200_000, growth: 10 },
  critTowerSlots: { kind: 'exponential', baseCost: 1_000, growth: 10 },
  basicSteadySlots: { kind: 'exponential', baseCost: 1_000, growth: 10 },
  buffStackerSlots: { kind: 'exponential', baseCost: 1_000, growth: 10 },
  buffAllSlots: { kind: 'exponential', baseCost: 1_000, growth: 10 },
}

// --- Evolution conversion (see game/economy.ts canEvolve/evolveCell) ---
// Converting a maxed plain Basic/Buff into its evolved form costs Power
// Cores, separately from the slot upgrade above that governs how many are
// allowed to exist at all. Doubles per additional evolved instance of that
// specific type, based on the CURRENT on-board count (removing one drops
// the next conversion back down - confirmed with the user) - not a table,
// computed in code: base * 2^count.
export const EVOLUTION_CONVERSION_BASE_COST = 5000

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
// Combined levels across every buff-type cell on the board (Buff, Buff
// Stacker, and Buff All alike - a single one only goes up to level 9,
// nowhere near enough range for 10 real tiers on its own). See stats.ts
// updateHighestValues(). Retuned for Alpha 0.31's 0-9 per-buff range (was
// 0-2/0-4 under the old Buff V1/V2 split) - tier 3 (9) lands on "exactly one
// maxed buff" as a natural early milestone, the rest scale up assuming
// several buffs stacking. A balance placeholder like everything else new
// this pass - not confirmed with the user, easy to retune.
export const ACHIEVEMENT_BUFF_LEVEL = [2, 5, 9, 18, 30, 45, 65, 90, 130, 180]
