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
