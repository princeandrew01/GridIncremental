// All tuning values live here. No magic numbers anywhere else in the codebase.

import type { UpgradeId, UpgradeLevels, PowerCoreUpgradeId, PowerCoreUpgradeLevels } from './types'

// Shown in the settings popover's About section. Bump the version by hand as
// the game progresses.
export const APP_VERSION = 'Alpha 0.3'
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
// bought yet. Arrays below are indexed directly by level, no dead entry 0. ---
export const MAX_LEVEL = { basic: 5, leech: 2, buffV1: 2, buffV2: 4, powerCoreGenerator: 4 } as const

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
// Buff power scales with the account-wide value Buffs target (see
// upgrades.ts buffScalingBaseValue: a Basic's base value before buffAccum,
// i.e. BASIC_BASE_VALUE + Basic Generator Value bonus, times Generator
// Value %) rather than a hardcoded flat number - a flat +1 every firing
// becomes proportionally meaningless once that base is pushed into the
// millions by other upgrades, which is exactly what made buffs feel
// pointless later on. Floored at MIN_BUFF_POWER_PER_FIRING so a firing is
// never worse than the original flat-1 behaviour was, early on when the
// scaling base is still small.
export const BUFF_V1_PCT_PER_FIRING = 0.005 // 0.5% of the scaling base, per firing, per targeted side - level only buys coverage, not rate
export const BUFF_V2_PCT_PER_FIRING = [0.005, 0.01, 0.02, 0.04, 0.08] // index = level; 0.5% -> 8% of the scaling base, per firing, applied to every Basic
export const MIN_BUFF_POWER_PER_FIRING = 1

// powerCoreGenerator's cost is denominated in power cores, not energy - see
// economy.ts currencyFor(). Kept modest since power cores are slow to earn,
// especially early (the whole tab is gated behind unlockPowerCoreGenerator
// anyway - see powerCoreUpgrades.ts).
export const BASE_COST = { basic: 10, leech: 100, buffV1: 250, buffV2: 5000, powerCoreGenerator: 5 }
export const COST_GROWTH = 1.15 // placement cost = base * growth^(count already placed)

// Per-type upgrade cost growth (cost to go from `level` to `level+1` = base *
// growth^level). Leech's stays at the original 2.5 - "Leech stays the same as
// it is now". Basic's is deliberately steep: 5 levels buys up to a 32x crit
// multiplier, so the climb has to hurt.
export const UPGRADE_COST_GROWTH = { basic: 15, leech: 2.5, buffV1: 4, buffV2: 6, powerCoreGenerator: 3 }

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
  gridSize: 3,
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
}

// --- Power Cores: a second resource with its own meta-progression menu
// (account-wide, purchased with power cores - see game/powerCoreUpgrades.ts).
// Five of its nine upgrades (tickSpeed/basicValue/critChance/critAmount/
// gridSize) mirror an existing Energy upgrade by name but are fully
// independent counters that STACK with the energy version - see
// game/upgrades.ts for exactly how each one combines. ---

// Power Core Generator: production is discrete (a proc every `period`
// ticks, period = BASE - level), not continuous like a Basic - each
// generator's period depends on its own level, since every placed one is
// leveled independently (confirmed with the user, not a shared timer the
// way Buffs use one global BUFF_TICK_INTERVAL).
export const POWER_CORE_GENERATOR_BASE_TICKS = 10
export const POWER_CORE_GENERATOR_TICKS_PER_LEVEL = 1 // 10 -> 6 ticks across levels 0-4

// A generator's own level only sets its speed (above) - the AMOUNT it (and
// every other power-core source) produces per proc is entirely driven by
// the shared Power Core Amount upgrade below.
export const POWER_CORE_AMOUNT_BASE = 1
export const POWER_CORE_AMOUNT_PER_LEVEL = 1 // 1 -> 100 cores/proc across levels 0-99

// Power Core Chance: a Basic or Leech's chance to ALSO produce a power core
// on a tick it produces energy - purely upgrade-driven (no per-cell-level
// term the way energy crit has), and each cell rolls independently (not
// inherited through `base` the way crit is - see engine.ts rollPowerCoreProcs).
export const POWER_CORE_CHANCE_BASE = 0
export const POWER_CORE_CHANCE_PER_LEVEL = 0.005 // +0.5%/level, max 12.5% at level 25

// Reduces every 10^n energy threshold that awards a power core (see
// stats.ts checkPowerCoreExponents), e.g. 100 -> 99 at level 1, -> 75 at
// level 25 (25% off, uniformly across every threshold).
export const POWER_CORE_REDUCTION_PER_LEVEL = 0.01 // max 25% at level 25

// --- Combined stacking for the 5 upgrades power cores share a name with -
// each COMBINES with its energy counterpart per a different rule, confirmed
// with the user per-stat (see game/upgrades.ts for the actual formulas):
// tickSpeed and critAmount stack MULTIPLICATIVELY; basicValue, critChance,
// and gridSize stack ADDITIVELY. ---
export const PC_TICK_SPEED_PCT_PER_LEVEL = 0.01 // -1%/level, multiplicative on top of energy's tick speed
export const PC_BASIC_VALUE_PER_LEVEL = 1 // +1/level, additive with energy's Basic Generator Value
export const PC_CRIT_CHANCE_PER_LEVEL = 0.01 // +1%/level, additive with energy's Crit Chance
export const PC_CRIT_AMOUNT_PCT_PER_LEVEL = 0.1 // +10%/level, multiplicative on top of energy's Crit Amount
export const PC_GRID_SIZE_PER_LEVEL = 1 // +1/level, additive with energy's Grid Size

export const POWER_CORE_UPGRADE_MAX_LEVEL: PowerCoreUpgradeLevels = {
  powerCoreReduction: 25,
  powerCoreAmount: 99,
  powerCoreChance: 25,
  unlockPowerCoreGenerator: 1, // one-shot unlock, not a leveled stat - see powerCoreUpgrades.ts
  tickSpeed: 25,
  basicValue: 999_999,
  critChance: 25,
  critAmount: 25,
  gridSize: 3,
}

// Power-core upgrades originally used FLAT fixed pricing (same cost every
// level). Reworked to an escalating curve instead - the same two shapes
// Energy's own upgrades use (see UPGRADE_COST above) - after two flat bumps
// in a row still weren't enough: flat pricing is structurally the wrong
// shape here, since power core INCOME itself keeps growing as energy grows
// (exponent-threshold awards compound the same way energy does), so any
// fixed flat price eventually becomes trivial again once income scales past
// it - confirmed by the user sitting on 250k+ power cores "without doing
// much." An escalating curve keeps pace automatically instead of needing
// another manual bump every time income jumps.
//
// Most upgrades (max level 25) use exponential growth=1.5, tuned so 250k
// power cores buys roughly 3/4 of the levels, not all of them - real
// progress, not an instant max. powerCoreAmount (max 99 - the single
// strongest lever, since it multiplies every power-core source at once) and
// basicValue (max 999,999, mirrors Energy's own quadratic-curve basicValue)
// both use the quadratic shape instead, the same way Energy's own
// long-tail/bulk-buy upgrades do - see upgrades.ts bulkUpgradeCost() for the
// closed-form math this relies on (powerCoreUpgrades.ts's own pcBulkUpgradeCost
// duplicates it for this table). gridSize (max 3, the single biggest-ticket
// item in either tab) matches Energy's own gridSize curve's order of
// magnitude on purpose - both are the one upgrade meant to be a multi-
// million-power-core commitment. unlockPowerCoreGenerator only ever buys its
// one level, so growth is moot there - baseCost is the whole price.
export const POWER_CORE_UPGRADE_COST: Record<PowerCoreUpgradeId, ExponentialCurve | QuadraticCurve> = {
  unlockPowerCoreGenerator: { kind: 'exponential', baseCost: 500, growth: 2 },
  powerCoreReduction: { kind: 'exponential', baseCost: 50, growth: 1.5 },
  powerCoreChance: { kind: 'exponential', baseCost: 80, growth: 1.5 },
  tickSpeed: { kind: 'exponential', baseCost: 100, growth: 1.5 },
  critChance: { kind: 'exponential', baseCost: 80, growth: 1.5 },
  critAmount: { kind: 'exponential', baseCost: 120, growth: 1.5 },
  powerCoreAmount: { kind: 'quadratic', coefficient: 15 },
  basicValue: { kind: 'quadratic', coefficient: 25 },
  gridSize: { kind: 'exponential', baseCost: 200_000, growth: 10 },
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
