// All tuning values live here. No magic numbers anywhere else in the codebase.

// Shown in the settings popover's About section. Bump the version by hand as
// the game progresses.
export const APP_VERSION = 'Alpha 0.1'
export const APP_AUTHOR = 'Asingh'
export const INSPIRED_BY_NAME = 'Gridle'
export const INSPIRED_BY_URL = 'https://parsakaali.itch.io/gridle'

export const TICK_MS = 1000
export const GRID_W = 8
export const GRID_H = 8

// Square grid sizes offered by the debug panel's grid-size selector
// (testing only - see ui/debugPanel.ts). Changing size resets the board;
// there's no save system yet to preserve a layout across a resize.
export const GRID_SIZE_OPTIONS = [8, 10, 12, 14, 16, 18, 20]

// Debug-only tick speed multiplier range: effective tick length is
// TICK_MS * multiplier, so 1 = normal speed, 0.1 = 10x faster. For testing
// whether a "reduce tick interval" upgrade would be worth adding for real.
export const DEBUG_TICK_SPEED_MIN = 0.1
export const DEBUG_TICK_SPEED_MAX = 1
export const DEBUG_TICK_SPEED_STEP = 0.01

export const MAX_LEVEL = { basic: 10, leech: 3, buff: 5 } as const

// A Basic's `base` (level 1, no buffs) - this is the number Leeches read.
// Each level beyond 1 adds a flat +1 to this, on top of any buffAccum:
//   base = BASIC_BASE_VALUE + buffAccum + (level - 1)
export const BASIC_BASE_VALUE = 1

// Multiplier applied to a Basic's `base` to get its OWN output - never seen
// by Leeches, which only ever read the pre-multiplier `base` above. This is
// what keeps a leveled-up Basic's own production climbing fast without a
// nearby Leech farming that same multiplier by proxy.
// Step multipliers are 1.5, 2.0, 2.5 ... Index 0 unused (levels start at 1).
export const BASIC_MULT = [0, 1, 1.5, 3, 7.5, 22.5, 78.75, 315, 1417.5, 7087.5, 38981.25]

// Buff power by level. Index 0 is unused (levels start at 1).
export const BUFF_POWER = [0, 1, 2, 4, 8, 16]

// Display label for a Leech's range at each level. Index 0 unused.
export const LEECH_RANGE_LABEL = ['', 'Orthogonal (4 cells)', 'Moore (8 cells)', 'Whole board']

// Buffs fire (advance buffAccum) every N ticks.
export const BUFF_TICK_INTERVAL = 5

export const BASE_COST = { basic: 10, leech: 100, buff: 250 }
export const COST_GROWTH = 1.15 // cost = base * growth^(count already placed)
export const UPGRADE_COST_GROWTH = 2.5

// Removing a generator refunds this fraction of what was actually paid to
// place it (not counting any upgrades since - see Cell.placementCost).
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
// correct if TICK_MS ever changes.
export const MAX_OFFLINE_HOURS = 24
export const MAX_OFFLINE_TICKS = (MAX_OFFLINE_HOURS * 60 * 60 * 1000) / TICK_MS

// Achievement tier thresholds, one array per category (src/game/stats.ts).
// All balance decisions, not technical ones - trivially adjustable.
export const ACHIEVEMENT_PLAYTIME_HOURS = [4, 8, 16, 32, 64, 128, 256, 512, 1024]
export const ACHIEVEMENT_GENERATORS_BUILT = [1, 10, 25, 50, 100, 250, 500, 1000]
export const ACHIEVEMENT_TIMES_LEVELED = [1, 10, 25, 50, 100, 250, 500, 1000]
export const ACHIEVEMENT_CURRENCY_FARMED = [1e3, 1e4, 1e5, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21]
export const ACHIEVEMENT_HIGHEST_BASIC = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e9]
export const ACHIEVEMENT_HIGHEST_LEECH = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e9]
export const ACHIEVEMENT_BUFF_LEVEL = [2, 3, 4, 5] // MAX_LEVEL.buff is 5
