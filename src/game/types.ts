import Decimal from 'break_infinity.js'

export type CellType = 'empty' | 'basic' | 'leech' | 'buff'

// Deviation from the original spec's "buff hits all 4 orthogonal neighbours":
// a Buff now targets exactly one orthogonal cell, chosen by the player and
// rotatable in place. `facing` records which one. Meaningless except on buffs.
export type Facing = 'up' | 'down' | 'left' | 'right'

export interface Cell {
  type: CellType
  level: number // basic 1-10, leech 1-3, buff 1-5; meaningless (0) when type is 'empty'
  buffAccum: Decimal // basics only; accumulated buff bonus. Stored, not derived.
  facing: Facing // buffs only; meaningless otherwise
  // The cost actually paid to place this generator - stored per-cell since
  // placement cost escalates with how many of that type are already on the
  // board, so it can't be recomputed later. Powers the Remove refund
  // (economy.ts REMOVE_REFUND_FRACTION); meaningless when type is 'empty'.
  placementCost: Decimal
}

export interface GameState {
  version: number
  width: number
  height: number
  cells: Cell[] // flat array, index = y * width + x
  currency: Decimal
  tickCount: number // total logical ticks elapsed since game start
  lastSaved: number // epoch ms

  // --- Lifetime tracking, for the Stats/Achievements tabs. Stored, not
  // derived: history (playtime, past highs, past totals) can't be
  // recomputed from the current board alone. ---
  startedAt: number // epoch ms, set once at creation
  prestigeStartedAt: number // epoch ms; == startedAt until prestige exists
  activePlayMs: number // lifetime active-tab time (pauses when hidden); powers playtime achievements
  lifetimeCurrencyEarned: Decimal // cumulative all-time earnings; never decreases when currency is spent
  totalGeneratorsBuilt: number // lifetime placements
  totalUpgrades: number // lifetime upgrades
  highestValue: { basic: Decimal; leech: Decimal } // running max final-tick value ever reached, per type
  highestBuffLevel: number // Buff's own track - its own output is always 0, so "highest value" doesn't apply
  unlockedAchievements: string[] // achievement IDs already earned
}

/** Per-cell computed values for a single tick. Never stored, always recomputed. */
export interface TickResult {
  base: Decimal[]
  final: Decimal[]
  production: Decimal
}

export function emptyCell(): Cell {
  return { type: 'empty', level: 0, buffAccum: new Decimal(0), facing: 'up', placementCost: new Decimal(0) }
}

export function makeGameState(width: number, height: number): GameState {
  const cells: Cell[] = []
  for (let i = 0; i < width * height; i++) cells.push(emptyCell())
  const now = Date.now()
  return {
    version: 1,
    width,
    height,
    cells,
    currency: new Decimal(0),
    tickCount: 0,
    lastSaved: now,
    startedAt: now,
    prestigeStartedAt: now,
    activePlayMs: 0,
    lifetimeCurrencyEarned: new Decimal(0),
    totalGeneratorsBuilt: 0,
    totalUpgrades: 0,
    highestValue: { basic: new Decimal(0), leech: new Decimal(0) },
    highestBuffLevel: 0,
    unlockedAchievements: [],
  }
}

export function cellIndex(x: number, y: number, width: number): number {
  return y * width + x
}
