import Decimal from 'break_infinity.js'

export type CellType = 'empty' | 'basic' | 'leech' | 'buffV1' | 'buffV2'

// Deviation from the original spec's "buff hits all 4 orthogonal neighbours":
// a Buff V1 targets 1 (level 0), 2 (level 1, opposite pair), or all 4 (level
// 2) cells depending on its own level - `facing` records the player's chosen
// side/axis, rotatable in place. Meaningless on buffV2 (always whole-board)
// and everything else.
export type Facing = 'up' | 'down' | 'left' | 'right'

// Account-wide upgrade levels, purchased from the Upgrades tab - distinct
// from a Cell's own `level`, which is per-placement. See game/upgrades.ts for
// what each one does and its cost curve; kept here (not upgrades.ts) so
// types.ts has no dependency on it and stays the foundational, dependency-
// free module every other game/* file can safely import.
export type UpgradeId =
  | 'tickSpeed'
  | 'basicValue'
  | 'generatorValuePct'
  | 'critChance'
  | 'critAmount'
  | 'removalRefund'
  | 'gridSize'

export type UpgradeLevels = Record<UpgradeId, number>

export function makeEmptyUpgradeLevels(): UpgradeLevels {
  return {
    tickSpeed: 0,
    basicValue: 0,
    generatorValuePct: 0,
    critChance: 0,
    critAmount: 0,
    removalRefund: 0,
    gridSize: 0,
  }
}

export interface Cell {
  type: CellType
  level: number // basic 0-5, leech 0-2, buffV1 0-2, buffV2 0-4; meaningless when type is 'empty'
  buffAccum: Decimal // basics only; accumulated buff bonus. Stored, not derived.
  facing: Facing // buffV1 only; meaningless otherwise
  // The cost actually paid to place this generator - stored per-cell since
  // placement cost escalates with how many of that type are already on the
  // board, so it can't be recomputed later. Powers the Remove refund
  // (economy.ts), which also reads the account-wide Removal Refund upgrade;
  // meaningless when type is 'empty'.
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
  upgrades: UpgradeLevels // account-wide, see game/upgrades.ts

  // --- Lifetime tracking, for the Stats/Achievements tabs. Stored, not
  // derived: history (playtime, past highs, past totals) can't be
  // recomputed from the current board alone. ---
  startedAt: number // epoch ms, set once at creation
  prestigeStartedAt: number // epoch ms; == startedAt until prestige exists
  activePlayMs: number // lifetime active-tab time (pauses when hidden); powers playtime achievements
  lifetimeCurrencyEarned: Decimal // cumulative all-time earnings; never decreases when currency is spent
  totalGeneratorsBuilt: number // lifetime placements
  totalUpgrades: number // lifetime cell level-ups (not account-wide upgrade purchases)
  highestValue: { basic: Decimal; leech: Decimal } // running max final-tick value ever reached, per type
  highestBuffLevel: number // highest level reached by either buff type - its own output is always 0, so "highest value" doesn't apply
  unlockedAchievements: string[] // achievement IDs already earned
}

/** Per-cell computed values for a single tick. Never stored, always recomputed. */
export interface TickResult {
  base: Decimal[]
  final: Decimal[]
  production: Decimal
  crits: boolean[] // whether each cell's base included a crit this evaluation - basics only, false elsewhere
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
    upgrades: makeEmptyUpgradeLevels(),
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

/**
 * Grows the board to at least (newWidth, newHeight) - every existing cell
 * keeps its exact (x, y) position and contents; new cells beyond the old
 * bounds start empty. Never shrinks: if the board is already at least this
 * big (e.g. an imported save from before the Grid Size upgrade existed, or
 * one built bigger via the debug grid-size selector), this is a no-op rather
 * than dropping cells - see upgrades.ts buyUpgrade(), the only real caller.
 */
export function resizeGrid(state: GameState, newWidth: number, newHeight: number): void {
  const width = Math.max(newWidth, state.width)
  const height = Math.max(newHeight, state.height)
  if (width === state.width && height === state.height) return

  const cells: Cell[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(x < state.width && y < state.height ? state.cells[cellIndex(x, y, state.width)] : emptyCell())
    }
  }
  state.width = width
  state.height = height
  state.cells = cells
}
