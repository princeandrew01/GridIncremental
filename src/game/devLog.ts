// Player-facing changelog, shown in the Dev Log popover (ui/devLogPanel.ts).
// Deliberately short and written for players, not the internal build notes
// in _working/SESSION_LOG.md - add a new entry at the TOP of this array with
// each release.

export interface DevLogEntry {
  version: string
  date: string
  summary: string
  changes: string[]
}

export const DEV_LOG: DevLogEntry[] = [
  {
    version: 'Alpha 0.31',
    date: '2026-08-06',
    summary: 'Basic and Buff towers can now evolve, Leech steals what a cell actually produces instead of a pre-multiplier number, a reworked Power Core Generator, and a full layout/UI overhaul.',
    changes: [
      'Basic now levels up to 10 (was 5) as a pure private output multiplier - leveling no longer touches crit at all.',
      'New: evolve a maxed Basic into a Crit Generator (+30 percentage points crit chance, x100 crit amount) or a Basic Steady Tower (a flat x10 output multiplier). Evolving costs Power Cores and needs a slot bought in the Power Cores tab first; no further leveling once evolved.',
      'Buff V1 and Buff V2 are merged into one Buff type: 10 levels, 10%-100%, boosts the one cell it faces by that percentage. Targets Basic, Leech, or the Power Core Generator now, not just Basic.',
      'New: evolve a maxed Buff into a Buff Stacker (pointed at another Buff/Buff All, multiplies its effective boost instead of acting as its own separate buff - chains to any depth) or a Buff All (boosts every cell on the board at once, no facing needed). Same slot/Power Core cost pattern as the Basic evolutions.',
      "Leech now steals a share of what a nearby cell actually PRODUCES - level multiplier, evolution, and any Buff on it all included - instead of a pre-multiplier account-wide number. A Leech next to a buffed, maxed generator now sees the whole thing.",
      'Power Core Generator reworked: 10 levels (was 5), and both how often it procs AND how many cores each proc is worth scale together - 1 core / 10 ticks at level 0, up to 10 cores / 1 tick maxed. Placing one costs its own Energy fee (5,000,000 for the first, x10 per additional one already on the board); the separate Power Generator Count upgrade (Energy tab) only raises how many you can have, it no longer pays for them. Leveling an already-placed one up still costs Power Cores, its own curve (10, x10/level).',
      'Power Cores tab rebuilt: Grid Size plus 4 independent slot upgrades, one per evolution type, each capping how many of that evolved tower you can have on the board (Crit Generator/Basic Steady start at 1,000 Power Cores to unlock, Buff Stacker/Buff All at 10,000 - all four x10 per additional level). Power Cores now come exclusively from the Power Core Generator - the old exponent-award and Power Core Chance mechanics are gone.',
      'Placement cost now grows a flat 2x per copy for Basic/Leech/Buff (was 1.15x); starting prices and starting Energy bumped to match.',
      'New: every placeable type\'s build button shows "???" until you\'ve had enough to afford one at least once - a one-time reveal, never re-hidden after. The Power Core Generator\'s button instead shows "Locked" (no Power Generator Count bought yet) or "Max" (at your current cap) instead of disappearing.',
      'Grid cells now show real tower names instead of letter glyphs, and a crit now floats a number up from the cell and fades instead of a static corner badge. A Power Core Generator\'s cell shows its rate in plain English ("3 per 8 ticks") and correctly reflects a Buff boosting it.',
      'Layout overhaul: a new top bar (title, Dev Log/Help/Settings icons) and a new resources row (Energy and Power Cores, each with an expected-rate line underneath) sit above the board now, both in their own bordered box. The right-hand panel is now a vertical icon rail instead of a row of text tabs.',
      'New Help menu (the info icon in the top bar): every generator/buffer/evolution, every Energy upgrade, and every Power Core upgrade\'s description lives here now, along with how the controls work - none of that text clutters the tabs themselves anymore.',
      'Selecting a cell no longer replaces the Build tab or opens a popup - it adds a dedicated icon (colour-matched to that cell\'s type) to the bottom of the right-hand rail, showing its Upgrade/Remove/Evolve controls and stats. Clicking any other tab, or right-clicking, deselects it.',
      'Build tab redone as a scrollable list (matching Upgrades) with a colour swatch, name, and cost per row - descriptions moved to the new Help menu. The selected cell\'s detail view is reordered (name, then Upgrade/Remove/Evolve, then Stats) and both action buttons are now full-width and stacked so a long cost string can\'t shove them around.',
      'Upgrades and Power Cores tabs: every row now shows the effect it currently has at its level (not just the level number), and the old x1/x10/x100 buttons on every row are replaced by one x1/x10/x25/Max toggle pinned to the top of the tab. Every cost, wherever it\'s shown, now has a ⚡/🔵 icon so which currency it\'s priced in is obvious at a glance.',
      'The selected cell\'s own Upgrade button gets the same bulk-buy treatment now - a x1/x5/x10/Max toggle right above it buys that many levels of the placed generator at once, instead of one level per click.',
    ],
  },
  {
    version: 'Alpha 0.3',
    date: '2026-08-05',
    summary: 'A second resource - Power Cores - plus a rebalance pass and a batch of bug fixes.',
    changes: [
      'Currency is now called Energy.',
      'New resource: Power Cores. Earn one every time your energy total crosses a x10 milestone within the current run (100, 1,000, 10,000, ...) - track your best run in the Stats tab.',
      'New Power Cores tab: 9 upgrades bought with Power Cores instead of Energy, including a Power Core Reduction (lowers those milestones), Power Core Amount/Chance, and a new Power Core Generator you unlock and build on the grid.',
      'Five of those upgrades share a name with an existing Energy upgrade (Tick Speed, Basic Generator Value, Crit Chance, Crit Amount, Grid Size) and stack on top of it rather than replacing it.',
      "Rebalance: Buffers now boost a Basic by a percentage of its value instead of a flat amount, so they stay useful as your numbers grow instead of fading into irrelevance. Their detail view now shows the live rate and how often they fire.",
      'Rebalance: the default board starts at 4x4 instead of 3x3, and Grid Size upgrades now cap out at a 10x10 board instead of 13x13 - existing saves are adjusted automatically.',
      'Rebalance: Power Core upgrade costs now climb per level (like Energy upgrades already did) instead of staying flat, after flat pricing let a big Energy income trivialize the whole tab almost immediately.',
      "Basic and Leech's detail view no longer visibly jitters from crit/proc RNG - it now shows a stable value plus the expected value with crit factored in, instead of one live tick's random result.",
      'Bug fix: the Power Core Generator build button could stay clickable before it was actually unlocked.',
      "Bug fix: selecting a generator on the grid now always switches you to the Build tab, and switching to any other tab now deselects whatever was selected.",
      "Bug fix: Buff V1 no longer rotates on the very first click that selects it.",
      'Bug fix: upgrade costs and achievement progress now always respect your number format setting instead of sometimes showing a raw comma-grouped number.',
      'Bug fix: the side panel scrollbar no longer covers the text next to it.',
    ],
  },
  {
    version: 'Alpha 0.2',
    date: '2026-08-05',
    summary: 'Crits, a real Upgrades tab, and Buffers split into two types.',
    changes: [
      'New: Crit Chance and Crit Amount. Basic generators can now land a critical hit and produce a burst of extra value that tick.',
      "Basic generators no longer grow in value just by leveling up - leveling a Basic now raises its crit chance and crit amount instead. Buy the new Basic Generator Value and Generator Value % upgrades to grow raw value.",
      'Buff generators are now two types: Buff V1 (levels up to target more sides - 1, then 2 opposite, then all 4) and Buff V2 (buffs every Basic on the board at once, but starts expensive).',
      'New Upgrades tab: Tick Speed, Basic Generator Value, Generator Value %, Crit Chance, Crit Amount, and Removal Refund.',
      'Upgrade/Remove buttons now stay in a fixed spot instead of moving around depending on what you have selected.',
      'Added this Dev Log.',
    ],
  },
  {
    version: 'Alpha 0.1',
    date: '2026-08-04',
    summary: 'First playable version, deployed live.',
    changes: [
      'Place Basic, Leech, and Buff generators on a grid and start earning currency.',
      "Leveling a Leech widens its range - from its orthogonal neighbors, to a full ring around it, to the whole board.",
      'Save/load with offline progress calculated instantly, no matter how long you were away.',
      'Stats tab and a first set of Achievements to chase.',
    ],
  },
]
